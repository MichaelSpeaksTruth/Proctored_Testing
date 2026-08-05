/**
 * firebaseAdmin.ts
 *
 * Server-side Firebase Admin SDK singleton (modular API, firebase-admin v12+).
 * Used exclusively by API routes — never imported by client components.
 *
 * Requires the env var FIREBASE_SERVICE_ACCOUNT_KEY to be set to the full
 * JSON string of a Firebase service account with RTDB read/write access.
 *
 * How to get the key:
 *   Firebase Console → Project Settings → Service Accounts → Generate new private key
 *   Then in .env.local set:
 *     FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":...}'
 */

import { initializeApp, getApps, cert, App, ServiceAccount } from 'firebase-admin/app';
import { getDatabase, Database } from 'firebase-admin/database';
import { getAuth, Auth } from 'firebase-admin/auth';

let _app: App | undefined;

function getAdminApp(): App {
  if (_app) return _app;

  // Reuse existing app across hot-reloads in Next.js dev mode
  const existing = getApps();
  if (existing.length > 0) {
    _app = existing[0];
    return _app;
  }

  let serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set. ' +
      'Add it to .env.local as a JSON string from your Firebase service account.'
    );
  }

  // Vercel sometimes wraps JSON env vars in extra quotes or double-escapes newlines
  if (serviceAccountKey.startsWith('"') && serviceAccountKey.endsWith('"')) {
    serviceAccountKey = serviceAccountKey.slice(1, -1);
  }
  // If the private key newlines were not escaped properly in the JSON string
  serviceAccountKey = serviceAccountKey.replace(/\\n/g, '\\n'); // Ensure it stays escaped for JSON.parse

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountKey);
    // In case the private key still has escaped newlines after parsing
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } catch (err: any) {
    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY: ' + err.message);
  }

  _app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });

  return _app;
}

export function getAdminDb(): Database {
  return getDatabase(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
