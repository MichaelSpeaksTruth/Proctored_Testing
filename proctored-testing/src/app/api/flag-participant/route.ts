import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      idToken?: string;
      email?: string;
      name?: string;
      action?: 'flag' | 'unflag';
      category?: string;
      reason?: string;
    };

    const { idToken, email, name, action = 'flag', category = 'Integrity Flag', reason = '' } = body;

    if (!idToken || !email) {
      return NextResponse.json({ success: false, error: 'Missing required parameters' }, { status: 400 });
    }

    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(idToken);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid authentication token' }, { status: 401 });
    }

    const callerEmail = decoded.email?.toLowerCase();
    if (!callerEmail) {
      return NextResponse.json({ success: false, error: 'No caller email found' }, { status: 403 });
    }

    // Verify Admin Sr.
    const isSrAdmin =
      callerEmail === process.env.NEXT_PUBLIC_ADMIN_1?.toLowerCase() ||
      callerEmail === process.env.NEXT_PUBLIC_ADMIN_2?.toLowerCase();

    const db = getAdminDb();

    if (!isSrAdmin) {
      // Check if Admin L1
      const encodeEmail = (e: string) => e.replace(/\./g, ',');
      const pSnap = await db.ref(`personnel/${encodeEmail(callerEmail)}`).once('value');
      const pVal = pSnap.val();
      if (!pVal || pVal.role !== 'Admin L1') {
        return NextResponse.json(
          { success: false, error: 'Access denied: Requires Admin Sr. or Admin L1' },
          { status: 403 }
        );
      }
    }

    const encodeEmail = (e: string) => e.replace(/\./g, ',');
    const key = encodeEmail(email.trim().toLowerCase());
    const partRef = db.ref(`participants/${key}`);
    const existingSnap = await partRef.once('value');
    const existing = existingSnap.val() || {};

    const nowIso = new Date().toISOString();
    const callerName = decoded.name || callerEmail.split('@')[0];
    const actorRole = isSrAdmin ? 'Admin Sr.' : 'Admin L1';

    if (action === 'flag') {
      await partRef.update({
        flagged: true,
        flagCategory: category.trim(),
        flagReason: reason.trim(),
        flaggedAt: nowIso,
        flaggedBy: callerEmail,
      });

      // Also propagate integrity flag into results if candidate has results
      if (existing.uid) {
        const resultsSnap = await db.ref('results').once('value');
        const allResults = resultsSnap.val() || {};
        const updates: Record<string, any> = {};
        for (const testId in allResults) {
          if (allResults[testId]?.[existing.uid]) {
            updates[`results/${testId}/${existing.uid}/integrityFlag`] = true;
            updates[`results/${testId}/${existing.uid}/flagNote`] = reason.trim() || category.trim();
          }
        }
        if (Object.keys(updates).length > 0) {
          await db.ref().update(updates);
        }
      }

      // Log audit event
      const logRef = db.ref('audit_logs').push();
      await logRef.set({
        id: logRef.key,
        action: 'FLAG_PARTICIPANT',
        actionLabel: 'Flagged Participant',
        actorEmail: callerEmail,
        actorName: `${callerName} (${actorRole})`,
        actorRole,
        targetTitle: `${existing.name || name || email} (${category})`,
        details: {
          participantEmail: email.trim().toLowerCase(),
          participantName: existing.name || name || '',
          flagCategory: category.trim(),
          flagReason: reason.trim(),
          flaggedBy: callerEmail,
        },
        timestamp: nowIso,
      });
    } else {
      // Unflag
      await partRef.update({
        flagged: false,
        flagCategory: null,
        flagReason: null,
        unflaggedAt: nowIso,
        unflaggedBy: callerEmail,
      });

      if (existing.uid) {
        const resultsSnap = await db.ref('results').once('value');
        const allResults = resultsSnap.val() || {};
        const updates: Record<string, any> = {};
        for (const testId in allResults) {
          if (allResults[testId]?.[existing.uid]) {
            updates[`results/${testId}/${existing.uid}/integrityFlag`] = false;
            updates[`results/${testId}/${existing.uid}/flagNote`] = null;
          }
        }
        if (Object.keys(updates).length > 0) {
          await db.ref().update(updates);
        }
      }

      const logRef = db.ref('audit_logs').push();
      await logRef.set({
        id: logRef.key,
        action: 'UNFLAG_PARTICIPANT',
        actionLabel: 'Removed Participant Flag',
        actorEmail: callerEmail,
        actorName: `${callerName} (${actorRole})`,
        actorRole,
        targetTitle: `${existing.name || name || email}`,
        details: {
          participantEmail: email.trim().toLowerCase(),
          participantName: existing.name || name || '',
          unflaggedBy: callerEmail,
        },
        timestamp: nowIso,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Error in flag-participant route:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
