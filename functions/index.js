const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();
db = admin.firestore();

FieldValue = require('firebase-admin').firestore.FieldValue;

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

function cmp(A, B) {
	return B[0] - A[0];
}

function deleteCollection(collectionRef, batchSize) {
    var query = collectionRef.orderBy('__name__').limit(batchSize);
  
    return new Promise((resolve, reject) => {
      deleteQueryBatch(db, query, batchSize, resolve, reject);
    });
}
  
function deleteQueryBatch(db, query, batchSize, resolve, reject) {
    query.get()
        .then((snapshot) => {
          // When there are no documents left, we are done
            if (snapshot.size === 0) {
                return 0;
            }
  
            // Delete documents in a batch
            var batch = db.batch();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
  
            return batch.commit().then(() => {
                return snapshot.size;
            });
        }).then((numDeleted) => {
            if (numDeleted === 0) {
                resolve()
                return
        }
  
        // Recurse on the next process tick, to avoid
        // exploding the stack.
        process.nextTick(() => {
            deleteQueryBatch(db, query, batchSize, resolve, reject);
        });
        return
    })
    .catch(reject);
}

function findSumAndAverage(users) {
    console.log("in findAverage");
    sum = 0;
    count = 0 //items.size;
    users.forEach(user => {
        expenses = user.data().expenses;
        if (expenses) {
            sum += expenses;
        }
        count += 1
    });
    console.log("sum " + sum);
    console.log("count " + count);
    if (count > 0) {
        return [sum, sum / count];
    }
    else {
        return false;
    }
}

function findDiffs(users, avg, event_id, diffs){

    // diffs = [];
    console.log("findDiffs", users)
    promises = []
    users.forEach(user => {
        expenses = user.data().expenses;
        user_id = user.id;
        console.log(user_id, expenses);
        if (expenses !== null && user_id && (avg - expenses !== 0)) {
            promises.push(diffs.push([avg - expenses, user_id]))
        }
    });
    return Promise.all(promises).then(() => {
        diffs.sort(cmp)
        console.log("findDiffs: " + diffs);
        setTransactions(diffs, event_id)
        return 
    })
}

function payExact(diffs, user){
    console.log("look for exact match to " + user)
    for (let u of diffs) {
        console.log(u + "|" + user)
        if (u && (u[1] !== user[1]) && (u[0] + user[0]) === 0){
            console.log("found " + u);
            index = diffs.indexOf(u);
            diffs.splice(index, 1);
            index = diffs.indexOf(user);
            diffs.splice(index, 1);

            if (user[0] > 0){
                action = {"from": user[1], "to": u[1], "amount": user[0]};
            }
            else {
                action = {"from": u[1], "to": user[1], "amount": user[0]};
            }

            return action;
        }
    }
    return false;
}

function pay(diffs) {
    pay_from = diffs[0];
    pay_to = diffs[diffs.length - 1];
    if (pay_from[0] > Math.abs(pay_to[0])){
        action = {"from": pay_from[1].username, "to": pay_to[1].username, "amount": Math.abs(pay_to[0])};
        diffs[0][0] -= Math.abs(pay_to[0]);
        diffs.splice(diffs.length - 1, 1);
        pay_all = false;
    } else {
        action = {"from": pay_from[1].username, "to": pay_to[1].username, "amount": pay_from[0]};
        diffs[diffs.length - 1][0] -= pay_from[0];
        diffs.splice(0, 1);
        pay_all = true;
    }
    console.log(action)
    console.log(diffs)
    return [action, pay_all];

}

function setTransactions(diffs, event_id) {
    require_transactions = db.collection('events/' + event_id + '/require_transactions/')
    deleteCollection(require_transactions, 10)
    
    transactions = []
    for (let u of diffs) {
        if (!u || u[0] < 0) {
            break;
        }
        action = payExact(diffs, u);
        if (action) {
            transactions.push(require_transactions.doc().set(action))
        }
    }

    console.log("after " + diffs);
    while (diffs.length > 1) {
        diffs.sort(cmp)
        res = pay(diffs);
        console.log(res)
        transactions.push(res[0]);

        if (diffs.length <= 1){
            break;
        }

        if (res[1]) {
            action = payExact(diffs, diffs[diffs.length - 1]);
        } else {
            action = payExact(diffs, diffs[0]);
        }
        if (action) {
            transactions.push(require_transactions.doc().set(action))
        }
    }
    console.log("transactions: " + transactions);
    // require_transactions.update(transactions)
    return Promise.all(transactions)
}

exports.calculatePay = functions.firestore.document('/events/{eventID}/users/{user}').onUpdate((user, context) => {
    const data = user.after
    const event_id = context.params.eventID;

    const promises = [];
    const transactions = [];
    const usersRef = db.collection('events/' + event_id + '/users/')
    return usersRef.get().then(snapshot => {

        res = findSumAndAverage(snapshot);

        if (res) {
            console.log("res:", res);
            sum = res[0];
            avg = res[1];
            promises.push(db.doc('events/' + event_id).set({'totalexpenses': sum, 'average': avg}, {merge: true}));
        } else {
            console.log("Didn't find average");
            return;
        }

        console.log(sum, avg);
        return;

    }).then(() => {
        return Promise.all(promises);
    }).catch(err => {
        console.log('Error getting documents', err);
    });
    // return require_transactions.set(promises)
  //return Promise.all(promises);
});

exports.calculateTransactions = functions.https.onCall((data, context) => {
    const event_id = data.eventId;
    console.log("Event ID: " + event_id);
    const promises = [];

    const usersRef = db.collection('events/' + event_id + '/users/')
    return usersRef.get().then(snapshot => {

        avg = findSumAndAverage(snapshot)[1];

        if (avg) {
            console.log("avg:", avg);
        } else {
            console.log("Didn't find average");
            return;
        }

        diffs = [];
        promises.push(findDiffs(snapshot, avg, event_id, diffs));
        return;



    }).then(() => {
        return Promise.all(promises);
    }).catch(err => {
        console.log('Error getting documents', err);
    });
    // return require_transactions.set(promises)
  //return Promise.all(promises);
});

function getExpenses(event_id, expenses) {
    const itemsRef = db.collection('events/' + event_id + '/items/')
    console.log(event_id, itemsRef)
    return itemsRef.get().then(snapshot => {
        console.log("snapshot" , snapshot)
        return snapshot.forEach(item => {
            val = item.data()
            console.log("val", val)
            price = val.price;
            uid = val.assignTo
            console.log(uid, price)
            if (uid !== undefined && uid !== null) {
                // uid = user.uid
                if (!(uid in expenses)) {
                    expenses[uid] = price;
                } else {
                    expenses[uid] += price;
                }
            }
        });
        
    }).catch(err => {
        console.log('Error getting documents', err);
    });
}

function setExpenses(event_id, expenses){
    const userRef = db.collection('events/' + event_id + '/users/')
    return userRef.get().then(snapshot => {
        return snapshot.forEach(doc => {
            id = doc.id
            if (id in expenses) {
                exp = expenses[id]
            } else {
                exp = 0
            }
            console.log("set " + exp + " to " + id)
            doc.ref.set({"expenses": exp}, {merge: true})
        });
    }).catch(err => {
        console.log('Error getting documents', err);
    });
}

exports.calculateExpenses = functions.firestore.document('/events/{eventID}/items/{item}').onWrite((item, context) => {

    const event_id = context.params.eventID;
    expenses = []
    return getExpenses(event_id, expenses).then(() => {
        console.log(expenses)
        return setExpenses(event_id, expenses)
    });
});

exports.addUserToEvent = functions.firestore.document('/events/{eventID}/users/{userID}').onCreate((user, context) => {
    // const val = user.val();
	// console.log(val);
	// const ref = user.ref;
    const event_id = context.params.eventID;
    const user_id = context.params.userID;
    console.log(event_id, "->", user_id);
    // detailsRef = ref.parent.parent.child('details');
    const promises = [];

    const eventRef = db.doc('events/' + event_id)
    userPath = "users." + user_id
    addUser = {[userPath]: true}
    promises.push(eventRef.update(addUser).then( () => {
        return console.log("Transaction successfully committed!")
    }).catch( (error) => {
        console.log("Transaction failed: ", error)
    }))

    const userRef = db.doc('users/' + user_id)
    eventPath = 'events.' + event_id
    addEvent = {[eventPath]: true}
    promises.push(userRef.update(addEvent).then( () => {
        return console.log("Transaction successfully committed!")
    }).catch( (error) => {
        console.log("Transaction failed: ", error)
    }))

    return Promise.all(promises);
});

exports.deleteUserfromEvent = functions.firestore.document('/events/{eventID}/users/{userID}').onDelete((user, context) => {
    // const val = user.val();
	// console.log(val);
	// const ref = user.ref;
    const event_id = context.params.eventID;
    const user_id = context.params.userID;
    console.log(event_id, "->", user_id);

    const promises = [];

    const eventRef = db.doc('events/' + event_id)
    userPath = "users." + user_id
    deleteUser = {[userPath]: FieldValue.delete()}
    promises.push(eventRef.update(deleteUser).then( () => {
        return console.log("Transaction successfully committed!")
    }).catch( (error) => {
        console.log("Transaction failed: ", error)
    }))

    const userRef = db.doc('users/' + user_id)
    eventPath = 'events.' + event_id
    deleteEvent = {[eventPath]: FieldValue.delete()}
    promises.push(userRef.update(deleteEvent).then( () => {
        return console.log("Transaction successfully committed!")
    }).catch( (error) => {
        console.log("Transaction failed: ", error)
    }))

    return Promise.all(promises);
});
