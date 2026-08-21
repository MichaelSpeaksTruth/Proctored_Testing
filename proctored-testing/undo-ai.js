const admin = require('firebase-admin');

async function main() {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    console.error("Missing FIREBASE_SERVICE_ACCOUNT_KEY");
    process.exit(1);
  }

  const serviceAccount = JSON.parse(serviceAccountKey);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
  });

  const db = admin.database();

  console.log("Fetching tests...");
  const testsSnap = await db.ref('tests').once('value');
  const tests = testsSnap.val();

  let targetTestId = null;
  for (const [id, data] of Object.entries(tests || {})) {
    console.log(`Found test: ${id} - Title: ${data.title}`);
    if (data.title && data.title.toLowerCase().includes('aerosoc recruitment test')) {
      targetTestId = id;
    }
  }

  if (!targetTestId) {
    console.error("Could not find test with title 'aerosoc recruitment test'");
    // Fallback: check if the id itself matches
    if (tests['aerosoc-recruitment-test']) {
        targetTestId = 'aerosoc-recruitment-test';
    } else {
        process.exit(1);
    }
  }

  console.log(`Target Test ID: ${targetTestId}`);

  const resultsRef = db.ref(`results/${targetTestId}`);
  const resultsSnap = await resultsRef.once('value');
  const results = resultsSnap.val();

  if (!results) {
    console.log("No results found for this test.");
    process.exit(0);
  }

  const updates = {};
  let count = 0;

  for (const uid of Object.keys(results)) {
    if (results[uid].aiSeverity || results[uid].aiSummary) {
      updates[`${uid}/aiSeverity`] = null;
      updates[`${uid}/aiSummary`] = null;
      count++;
    }
  }

  if (count > 0) {
    console.log(`Undoing AI review for ${count} candidates...`);
    await resultsRef.update(updates);
    console.log("Done!");
  } else {
    console.log("No AI reviews found to undo.");
  }

  process.exit(0);
}

main().catch(console.error);
