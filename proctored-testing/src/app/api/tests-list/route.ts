import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getAdminDb();
    
    // Using shallow fetch via REST API to avoid downloading entire tests
    // Unfortunately, we cannot easily use shallow with admin SDK directly without REST.
    // So we'll just download it on the server. Server has 10Gbps connection usually, so it's very fast compared to client.
    const testsSnap = await db.ref('tests').once('value');
    const val = testsSnap.val();
    if (!val) {
      return NextResponse.json([]);
    }

    const testOptions = Object.keys(val).map(key => ({
      id: key,
      title: val[key].title || key,
    }));

    return NextResponse.json(testOptions);
  } catch (error) {
    console.error('Error fetching tests list:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
