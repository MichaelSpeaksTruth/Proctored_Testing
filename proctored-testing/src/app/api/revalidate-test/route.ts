import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getAdminAuth } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { idToken?: string };
    const { idToken } = body;

    if (!idToken) {
      return NextResponse.json({ success: false, error: 'Missing ID token' }, { status: 400 });
    }

    // Verify token
    let decodedToken;
    try {
      decodedToken = await getAdminAuth().verifyIdToken(idToken);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid ID token' }, { status: 401 });
    }

    // Check admin email
    const email = decodedToken.email;
    const isAdmin = email === process.env.NEXT_PUBLIC_ADMIN_1 || email === process.env.NEXT_PUBLIC_ADMIN_2;

    if (!isAdmin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }

    // Purge the edge cache for the questions API
    revalidatePath('/api/get-test-questions');

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[revalidate-test] Error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
