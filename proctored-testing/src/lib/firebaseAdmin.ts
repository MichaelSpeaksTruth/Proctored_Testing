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

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set. ' +
      'Add it to .env.local as a JSON string from your Firebase service account.'
    );
  }

  const serviceAccount = JSON.parse(serviceAccountKey) as ServiceAccount;

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
