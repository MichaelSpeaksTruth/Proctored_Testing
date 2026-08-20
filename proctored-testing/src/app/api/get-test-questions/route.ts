/**
 * /api/get-test-questions — Edge-cached question delivery
 *
 * Reads the active test's questions from Firebase RTDB live on every request.
 * Caching has been intentionally disabled (no-store, revalidate=0) to ensure
 * that any changes or added questions show up instantaneously for students.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0; // Disable ISR completely to ensure instant updates

export async function GET(req: NextRequest) {
  try {
    const db = getAdminDb();

    const url = new URL(req.url);
    let testId = url.searchParams.get('testId');

    // Step 1: Read the current test state
    const stateSnap = await db.ref('testState').once('value');
    const state = stateSnap.val();

    if (!testId) {
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
      testId = state.activeTestId;
    }

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
        // Fetch questions live directly from Firebase without caching
        'Cache-Control': 'no-store',
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
