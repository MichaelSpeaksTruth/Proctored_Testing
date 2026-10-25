import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { idToken } = (await req.json()) as { idToken?: string };
    if (!idToken) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
    }

    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(idToken);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
    }

    const email = decoded.email?.toLowerCase();
    if (!email) {
      return NextResponse.json({ success: false, error: 'No email found' }, { status: 403 });
    }

    const db = getAdminDb();

    // Check if Supreme Admin (Admin Sr.)
    const isSrAdmin =
      email === process.env.NEXT_PUBLIC_ADMIN_1?.toLowerCase() ||
      email === process.env.NEXT_PUBLIC_ADMIN_2?.toLowerCase();

    if (!isSrAdmin) {
      // Check if Admin L1 in personnel
      const encodeEmail = (e: string) => e.replace(/\./g, ',');
      const personnelSnap = await db.ref(`personnel/${encodeEmail(email)}`).once('value');
      const personnel = personnelSnap.val();
      if (!personnel || personnel.role !== 'Admin L1') {
        return NextResponse.json(
          { success: false, error: 'Access denied: Requires Admin L1 or Admin Sr.' },
          { status: 403 }
        );
      }
    }

    const snap = await db.ref('participants').once('value');
    const val = snap.val() || {};
    const decodeEmail = (e: string) => e.replace(/,/g, '.');

    const participants = Object.keys(val).map(key => ({
      email: decodeEmail(key),
      ...(val[key] as { allowed: boolean; name?: string; tests?: Record<string, boolean> }),
    }));

    return NextResponse.json({ success: true, participants });
  } catch (err: unknown) {
    console.error('Error in participants-view API:', err);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
