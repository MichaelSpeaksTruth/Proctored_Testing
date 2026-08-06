/**
 * firebaseAdmin.ts
 *
 * Server-side Firebase Admin SDK singleton (firebase-admin v11, CJS-compatible).
 * Used exclusively by API routes — never imported by client components.
 *
 * Requires the env var FIREBASE_SERVICE_ACCOUNT_KEY to be set to the full
 * JSON string of a Firebase service account with RTDB read/write access.
 *
 * How to get the key:
 *   Firebase Console → Project Settings → Service Accounts → Generate new private key
 *   Then in Vercel env vars set:
 *     FIREBASE_SERVICE_ACCOUNT_KEY = (paste the entire JSON file contents)
 */

import * as admin from 'firebase-admin';

let _initialized = false;

function getAdminApp(): admin.app.App {
  if (_initialized && admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  // Reuse existing app across hot-reloads in Next.js dev mode
  if (admin.apps.length > 0) {
    _initialized = true;
    return admin.apps[0]!;
  }

  let serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set. ' +
      'Add it to Vercel env vars as the raw JSON string from your Firebase service account.'
    );
  }

  // Vercel sometimes wraps JSON env vars in extra quotes
  if (serviceAccountKey.startsWith('"') && serviceAccountKey.endsWith('"')) {
    serviceAccountKey = serviceAccountKey.slice(1, -1);
  }

  let serviceAccount: admin.ServiceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountKey);
    // Normalize private_key newlines (Vercel may double-escape them)
    if ((serviceAccount as any).private_key) {
      (serviceAccount as any).private_key = (serviceAccount as any).private_key.replace(/\\n/g, '\n');
    }
  } catch (err: any) {
    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY: ' + err.message);
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });

  _initialized = true;
  return admin.apps[0]!;
}

export function getAdminDb(): admin.database.Database {
  return getAdminApp().database();
}

export function getAdminAuth(): admin.auth.Auth {
  return getAdminApp().auth();
}
