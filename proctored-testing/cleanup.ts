import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

let serviceAccountStr = '';
let dbUrl = '';

for (const line of envContent.split('\n')) {
  if (line.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY=')) {
    serviceAccountStr = line.substring('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim();
  } else if (line.startsWith('NEXT_PUBLIC_FIREBASE_DATABASE_URL=')) {
    dbUrl = line.substring('NEXT_PUBLIC_FIREBASE_DATABASE_URL='.length).trim();
  }
}

// Remove any wrapping quotes if present
if (serviceAccountStr.startsWith("'") && serviceAccountStr.endsWith("'")) {
  serviceAccountStr = serviceAccountStr.slice(1, -1);
}

const serviceAccount = JSON.parse(serviceAccountStr);
if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: dbUrl,
});

const db = admin.database();

async function cleanup() {
  console.log('Starting cleanup of test takers data...');
  try {
    await db.ref('submissions').remove();
    console.log('Cleared submissions');

    await db.ref('proctoringFlags').remove();
    console.log('Cleared proctoringFlags (including pictures)');

    await db.ref('results').remove();
    console.log('Cleared results');

    await db.ref('participants').remove();
    console.log('Cleared participants');

    console.log('Cleanup completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

cleanup();
