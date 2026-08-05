/**
 * /api/get-test-questions — Edge-cached question delivery
 *
 * Reads the active test's questions from Firebase RTDB once, then Vercel's
 * Edge caches the response globally for 1 hour. All subsequent requests are
 * served from the CDN with 0 additional database reads.
 *
 * Cache strategy:
 *   s-maxage=3600          → Vercel Edge CDN holds the response for 1 hour
 *   stale-while-revalidate=86400 → Serves stale while revalidating in background
 *
 * The cache is busted automatically after 1 hour, or you can add a manual
 * revalidation tag via Vercel's dashboard if the test changes mid-session.
 */

import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';

export const dynamic = 'force-static';
export const revalidate = 3600; // 1 hour ISR

export async function GET() {
  try {
    const db = getAdminDb();

    // Step 1: Read the current test state
    const stateSnap = await db.ref('testState').once('value');
    const state = stateSnap.val();

    if (!state || state.status !== 'active' || !state.activeTestId) {
      return NextResponse.json(
        { error: 'No active test.' },
        {
          status: 404,
          headers: {
            // Don't cache "no active test" responses
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    const testId: string = state.activeTestId;

    // Step 2: Read the test data
    const testSnap = await db.ref(`tests/${testId}`).once('value');
    if (!testSnap.exists()) {
      return NextResponse.json(
        { error: 'Test not found.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const raw = testSnap.val();

    // Normalise RTDB numbered-object arrays back to real JS arrays
    const toArr = <T,>(v: unknown): T[] => {
      if (!v) return [];
      if (Array.isArray(v)) return v as T[];
      if (typeof v === 'object') return Object.values(v as Record<string, T>);
      return [];
    };

    const sections = toArr<{ id: string; name: string; timeLimit: number; questions: unknown }>(
      raw.sections
    ).map((s) => ({
      ...s,
      questions: toArr(s.questions),
    }));

    const payload = { testId, title: raw.title, sections };

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        // Vercel Edge will cache this globally; stale-while-revalidate keeps
        // the CDN warm even after s-maxage expires.
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[get-test-questions] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
