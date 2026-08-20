const fs = require('fs');
const admin = require('firebase-admin');

const envFile = fs.readFileSync('.env.local', 'utf8');
const match = envFile.match(/^FIREBASE_SERVICE_ACCOUNT_KEY=(.*)/m);
if (!match) {
  console.log('No service account key found.');
  process.exit(1);
}
const serviceAccount = JSON.parse(match[1]);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://proctored-testing-platform-default-rtdb.asia-southeast1.firebasedatabase.app/'
});

const db = admin.database();
db.ref('tests').once('value').then(snap => {
  console.log('Tests in Database:');
  const val = snap.val();
  if (val) {
    Object.keys(val).forEach(k => console.log(k, '-', val[k].title));
  } else {
    console.log('No tests found.');
  }
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
