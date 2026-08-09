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

async function checkDB() {
  console.log('Checking database for any remaining pictures...');
  try {
    const snapshot = await db.ref('proctoringFlags').once('value');
    const flagsData = snapshot.val();
    
    if (!flagsData) {
      console.log('No proctoringFlags found in the database. It is clean.');
      process.exit(0);
    }
    
    let pictureCount = 0;
    
    // Traverse the JSON tree to look for 'snapshotBase64' keys
    function traverse(obj: any) {
      if (typeof obj === 'object' && obj !== null) {
        if ('snapshotBase64' in obj) {
          pictureCount++;
        }
        for (const key in obj) {
          traverse(obj[key]);
        }
      }
    }
    
    traverse(flagsData);
    
    if (pictureCount === 0) {
      console.log('Successfully verified: No pictures (snapshotBase64) found in proctoringFlags.');
    } else {
      console.log(`WARNING: Found ${pictureCount} picture(s) still in the database.`);
    }
    process.exit(0);
  } catch (error) {
    console.error('Error during check:', error);
    process.exit(1);
  }
}

checkDB();
