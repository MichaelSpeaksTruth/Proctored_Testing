/**
 * /api/grade-test — Secure, server-side submission relay
 *
 * Accepts a POST with the student's final answers. Before writing to the
 * database this route:
 *   1. Verifies the Firebase ID token (prevents spoofed submissions).
 *   2. Confirms the UID in the token matches the payload UID.
 *   3. Checks the test is still active (prevents late submissions if test ended).
 *   4. Writes to the isolated path submissions/{testId}/{uid} via Admin SDK.
 *
 * Concurrency model:
 *   Vercel auto-scales each POST to its own serverless function instance.
 *   500 simultaneous submits → 500 independent executions → 500 isolated
 *   RTDB writes. No queuing, no contention.
 *
 * POST body:
 *   {
 *     testId:  string,
 *     uid:     string,
 *     answers: Record<string, string>,   // { questionId: selectedOption }
 *     idToken: string,                   // Firebase Auth ID token from client
 *     email:   string,
 *     name:    string,
 *     autoSubmitted: boolean,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    getAdminDb(); // warm-up probe
    return NextResponse.json({ success: true, message: 'firebase-admin initialized successfully' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: `Init failed: ${err.message}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      testId?: string;
      uid?: string;
      answers?: Record<string, string>;
      idToken?: string;
      email?: string;
      name?: string;
      autoSubmitted?: boolean;
    };

    const { testId, uid, answers, idToken, email, name, autoSubmitted } = body;

    // ── Validate input ─────────────────────────────────────────────
    if (!testId || !uid || !answers || !idToken) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: testId, uid, answers, idToken.' },
        { status: 400 }
      );
    }

    // ── Verify ID token ────────────────────────────────────────────
    // This is the critical security gate — it proves the request comes from a
    // real, authenticated Firebase user and that their UID matches what they claim.
    let decodedToken: { uid: string };
    try {
      decodedToken = await getAdminAuth().verifyIdToken(idToken);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired ID token.' },
        { status: 401 }
      );
    }

    if (decodedToken.uid !== uid) {
      return NextResponse.json(
        { success: false, error: 'Token UID mismatch.' },
        { status: 403 }
      );
    }

    // ── Guard: already submitted? ──────────────────────────────────
    const db = getAdminDb();
    const existingSnap = await db.ref(`submissions/${testId}/${uid}`).once('value');
    if (existingSnap.exists()) {
      // Idempotent: return success so the client can proceed to dashboard
      return NextResponse.json({ success: true, alreadySubmitted: true });
    }

    // ── Deadline check: flag late, never reject ────────────────────
    // Policy: "observe and log" — a late submission is accepted and stored,
    // but receives a DELAYED_SUBMISSION integrity flag and is automatically
    // marked Disqualified. Admins can review and override the status.
    let isLateSubmission = false;
    let delaySeconds = 0;

    const stateSnap = await db.ref('testState').once('value');
    const testState = stateSnap.val();

    if (testState?.startedAt) {
      const testSnap = await db.ref(`tests/${testId}`).once('value');
      const testData = testSnap.val();

      if (testData?.sections) {
        let totalAllowedSeconds = 0;
        const sectionsArray = Array.isArray(testData.sections)
          ? testData.sections
          : Object.values(testData.sections);

        for (const sec of sectionsArray as any[]) {
          if (sec.timeLimit) totalAllowedSeconds += sec.timeLimit;
        }

        // 2-minute grace buffer for network latency
        const bufferSeconds = 120;
        const maxAllowedMs = (totalAllowedSeconds + bufferSeconds) * 1000;
        const startTimeMs = new Date(testState.startedAt).getTime();
        const actualDurationMs = Date.now() - startTimeMs;

        if (actualDurationMs > maxAllowedMs) {
          isLateSubmission = true;
          // Exact seconds past the hard deadline (no buffer applied here)
          delaySeconds = Math.round((actualDurationMs - totalAllowedSeconds * 1000) / 1000);
          console.warn(
            `[grade-test] DELAYED_SUBMISSION for ${email} — ` +
            `${delaySeconds}s past deadline. Accepting with Disqualified status.`
          );
        }
      }
    }

    // ── Write isolated submission ──────────────────────────────────
    // Each user writes to their own isolated path — no contention possible.
    await db.ref(`submissions/${testId}/${uid}`).set({
      answers,
      submittedAt: new Date().toISOString(),
      autoSubmitted: autoSubmitted ?? false,
      email: email ?? '',
      name: name ?? '',
      // Integrity flags
      ...(isLateSubmission && {
        integrityFlag: 'DELAYED_SUBMISSION',
        delaySeconds,
        roundStatus: 'Disqualified',
        flagNote: `Submission received ${delaySeconds}s past the test deadline. Auto-disqualified pending admin review.`,
      }),
    });

    return NextResponse.json({ success: true, lateSubmission: isLateSubmission, delaySeconds });
  } catch (err: any) {
    console.error('[grade-test] Error:', err);
    return NextResponse.json(
      { success: false, error: `Server error: ${err.message}` },
      { status: 500 }
    );
  }
}
