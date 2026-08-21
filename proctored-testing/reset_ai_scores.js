const fs = require('fs');
const admin = require('firebase-admin');

// 1. Load env vars manually from .env.local
const envFile = fs.readFileSync('.env.local', 'utf8');
const envLines = envFile.split('\n');
for (const line of envLines) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

// 2. Initialize Firebase Admin
let serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (serviceAccountKey.startsWith('"') && serviceAccountKey.endsWith('"')) {
  serviceAccountKey = serviceAccountKey.slice(1, -1);
}

let serviceAccount = JSON.parse(serviceAccountKey);
if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
});

const db = admin.database();

async function resetAiScores() {
  console.log('Fetching results...');
  const resultsRef = db.ref('results');
  const snapshot = await resultsRef.once('value');
  const val = snapshot.val();
  
  if (!val) {
    console.log('No results found.');
    return;
  }

  const updates = {};
  let count = 0;

  for (const testId of Object.keys(val)) {
    const testResults = val[testId];
    for (const uid of Object.keys(testResults)) {
      if (testResults[uid].aiSeverity || testResults[uid].aiSummary) {
        updates[`${testId}/${uid}/aiSeverity`] = null;
        updates[`${testId}/${uid}/aiSummary`] = null;
        count++;
      }
    }
  }

  if (count === 0) {
    console.log('No AI scores to reset.');
  } else {
    console.log(`Resetting AI scores for ${count} students...`);
    await resultsRef.update(updates);
    console.log('Successfully reset AI scores.');
  }
  process.exit(0);
}

resetAiScores().catch(e => {
  console.error(e);
  process.exit(1);
});
