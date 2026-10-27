import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebaseAdmin';
import { isAdmin, encodeEmail } from '@/lib/adminUtils';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { testId, uid, roundStatus, idToken } = (await req.json()) as {
      testId?: string;
      uid?: string;
      roundStatus?: string;
      idToken?: string;
    };

    if (!testId || !uid || !roundStatus) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: testId, uid, or roundStatus' },
        { status: 400 }
      );
    }

    const validStatuses = ['Pending', 'Qualified', 'Eliminated', 'Waitlisted'];
    if (!validStatuses.includes(roundStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid roundStatus: ${roundStatus}. Expected one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    let callerEmail = 'unknown';

    // Verify authentication if idToken provided
    if (idToken) {
      let decoded;
      try {
        decoded = await getAdminAuth().verifyIdToken(idToken);
        callerEmail = decoded.email?.toLowerCase() || 'unknown';
      } catch {
        return NextResponse.json({ success: false, error: 'Invalid or expired authentication token' }, { status: 401 });
      }

      const isSr = isAdmin(callerEmail);
      if (!isSr) {
        // Check if Admin L1 in personnel
        const pSnap = await db.ref(`personnel/${encodeEmail(callerEmail)}`).once('value');
        const pData = pSnap.val();
        if (!pData || pData.role !== 'Admin L1') {
          return NextResponse.json(
            { success: false, error: 'Access denied: Requires Admin L1 or Admin Sr. privilege' },
            { status: 403 }
          );
        }
      }
    }

    // Update RTDB results path
    await db.ref(`results/${testId}/${uid}`).update({
      roundStatus,
      statusUpdatedAt: Date.now(),
      statusUpdatedBy: callerEmail,
    });

    return NextResponse.json({ success: true, roundStatus });
  } catch (err: any) {
    console.error('Error updating round status:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Server error while updating round status' },
      { status: 500 }
    );
  }
}
