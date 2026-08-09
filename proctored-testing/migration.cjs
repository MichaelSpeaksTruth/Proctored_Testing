const admin = require('firebase-admin');
const fs = require('fs');

// Load .env.local manually
const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  if (line && line.includes('=')) {
    const [k, ...rest] = line.split('=');
    env[k.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
});

const serviceAccountKey = env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountKey) {
  throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_KEY");
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(serviceAccountKey)),
  databaseURL: env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
});

const db = admin.database();

async function migrate() {
  const trialTestId = '-OzG7ny4NGBMbaC4u3bT'; // From the screenshot
  console.log(`Migrating participants into test ID: ${trialTestId}`);

  const snap = await db.ref('participants').once('value');
  const val = snap.val();
  
  if (!val) {
    console.log("No participants found.");
    process.exit(0);
  }

  const updates = {};
  for (const key of Object.keys(val)) {
    const p = val[key];
    // Add the tests map to each participant
    updates[`participants/${key}/tests`] = {
      ...(p.tests || {}),
      [trialTestId]: true
    };
  }

  await db.ref().update(updates);
  console.log(`Successfully migrated ${Object.keys(updates).length} participants!`);
  process.exit(0);
}

migrate().catch(console.error);
