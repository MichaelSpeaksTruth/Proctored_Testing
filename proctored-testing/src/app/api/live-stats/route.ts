import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { idToken, testId: requestedTestId } = (await req.json()) as {
      idToken?: string;
      testId?: string;
    };

    if (!idToken) {
      return NextResponse.json({ success: false, error: 'Missing authentication token' }, { status: 400 });
    }

    // 1. Verify user token via Firebase Admin Auth
    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(idToken);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
    }

    const email = decoded.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ success: false, error: 'User email not found in token' }, { status: 403 });
    }

    const db = getAdminDb();

    // 2. Strict Role Check: Admin Sr., Admin L1, or Spectator
    const admin1 = process.env.NEXT_PUBLIC_ADMIN_1?.trim().toLowerCase();
    const admin2 = process.env.NEXT_PUBLIC_ADMIN_2?.trim().toLowerCase();
    const isSrAdmin = email === admin1 || email === admin2;

    let userRole = isSrAdmin ? 'Admin Sr.' : '';

    if (!isSrAdmin) {
      const encodeEmail = (e: string) => e.replace(/\./g, ',');
      const personnelSnap = await db.ref(`personnel/${encodeEmail(email)}`).once('value');
      const personnel = personnelSnap.val();

      if (personnel && (personnel.role === 'Admin L1' || personnel.role === "Spectator's View")) {
        userRole = personnel.role;
      } else {
        return NextResponse.json(
          { success: false, error: 'Access denied: Requires Admin Sr., Admin L1, or Spectator role.' },
          { status: 403 }
        );
      }
    }

    // 3. Check Live Exam Status from testState
    const stateSnap = await db.ref('testState').once('value');
    const testState = stateSnap.val() || {};

    const activeTestId = testState.activeTestId || requestedTestId;
    const isLive = testState.status === 'active' && Boolean(activeTestId);

    // If no live exam is running and no specific live state exists, return safe idle state
    if (!isLive) {
      return NextResponse.json({
        success: true,
        live: false,
        message: 'No live exam currently in progress.',
        testState: {
          status: testState.status || 'idle',
          activeTestId: testState.activeTestId || null,
          startedAt: testState.startedAt || null,
        },
      });
    }

    // 4. Fetch test details
    const testSnap = await db.ref(`tests/${activeTestId}`).once('value');
    const testData = testSnap.val() || {};
    const testTitle = testData.title || 'Live Examination';

    // 5. Fetch registered participants
    const participantsSnap = await db.ref('participants').once('value');
    const participantsVal = participantsSnap.val() || {};
    const decodeEmail = (k: string) => k.replace(/,/g, '.');

    // Also check test-specific registered participants
    const testParticipants = testData.participants || {};

    // 6. Fetch submissions for this test
    const submissionsSnap = await db.ref(`submissions/${activeTestId}`).once('value');
    const submissionsVal = submissionsSnap.val() || {};

    // 7. Fetch proctoring flags
    const flagsSnap = await db.ref('proctoringFlags').once('value');
    const allFlags = flagsSnap.val() || {};

    // Map all known candidates: build a unified dictionary by email and UID
    const candidateMap = new Map<string, {
      uid: string;
      email: string;
      name: string;
      status: 'active' | 'submitted' | 'not_started';
      startedAt: string | null;
      submittedAt: string | null;
      lastSeen: string | null;
      flagCount: number;
      highFlags: number;
      mediumFlags: number;
      lowFlags: number;
      latestEvent: string | null;
      latestSnapshot: string | null;
      flags: Array<{
        id: string;
        event: string;
        severity: string;
        timestamp: string | number;
        duration?: number;
        snapshot?: string;
        detection?: any;
      }>;
    }>();

    // A. Add participants registered for this test
    for (const [key, pData] of Object.entries<any>(participantsVal)) {
      const pEmail = decodeEmail(key).toLowerCase();
      // Check if participant is allowed and assigned to this test (or assigned globally)
      const isAssigned = pData.allowed !== false && (
        !pData.tests ||
        Object.keys(pData.tests).length === 0 ||
        pData.tests[activeTestId] === true
      );

      if (isAssigned) {
        candidateMap.set(pEmail, {
          uid: pData.uid || '',
          email: pEmail,
          name: pData.name || pEmail.split('@')[0],
          status: 'not_started',
          startedAt: null,
          submittedAt: null,
          lastSeen: null,
          flagCount: 0,
          highFlags: 0,
          mediumFlags: 0,
          lowFlags: 0,
          latestEvent: null,
          latestSnapshot: null,
          flags: [],
        });
      }
    }

    // B. Check submissions to mark submitted candidates & add any submitted UIDs
    for (const [subUid, sub] of Object.entries<any>(submissionsVal)) {
      const subEmail = (sub.email || '').toLowerCase();
      let record = subEmail ? candidateMap.get(subEmail) : null;

      if (!record) {
        // Find by UID if email not found
        for (const r of candidateMap.values()) {
          if (r.uid === subUid) {
            record = r;
            break;
          }
        }
      }

      if (!record) {
        // Create new record for this submitted student
        record = {
          uid: subUid,
          email: subEmail || `student_${subUid.substring(0, 6)}@exam.local`,
          name: sub.name || subEmail.split('@')[0] || 'Candidate',
          status: 'submitted',
          startedAt: null,
          submittedAt: sub.submittedAt || null,
          lastSeen: sub.submittedAt || null,
          flagCount: 0,
          highFlags: 0,
          mediumFlags: 0,
          lowFlags: 0,
          latestEvent: null,
          latestSnapshot: null,
          flags: [],
        };
        candidateMap.set(record.email, record);
      } else {
        record.uid = subUid;
        record.status = 'submitted';
        record.submittedAt = sub.submittedAt || null;
        if (sub.name) record.name = sub.name;
      }
    }

    // C. Inspect terms agreements in test object (testData.participants)
    for (const [pUid, pVal] of Object.entries<any>(testParticipants)) {
      if (pVal && pVal.TermsAgreeRecord) {
        const parts = String(pVal.TermsAgreeRecord).split(',');
        const agreedTime = parts[1] || null;

        // Match record by uid
        for (const r of candidateMap.values()) {
          if (r.uid === pUid) {
            if (r.status !== 'submitted') {
              r.status = 'active';
            }
            if (agreedTime && (!r.startedAt || agreedTime < r.startedAt)) {
              r.startedAt = agreedTime;
            }
            if (agreedTime && (!r.lastSeen || agreedTime > r.lastSeen)) {
              r.lastSeen = agreedTime;
            }
            break;
          }
        }
      }
    }

    // D. Scan proctoringFlags for active exam infractions & real-time presence
    for (const [fUid, fData] of Object.entries<any>(allFlags)) {
      const testFlagsObj = fData?.[activeTestId]?.flags || fData?.flags;
      if (!testFlagsObj) continue;

      const flagEntries = Object.entries<any>(testFlagsObj);
      if (flagEntries.length === 0) continue;

      // Match student record
      let student = Array.from(candidateMap.values()).find(c => c.uid === fUid);
      if (!student) {
        // Check if student email is stored in flag data or create provisional entry
        student = {
          uid: fUid,
          email: `candidate_${fUid.substring(0, 6)}`,
          name: `Candidate (${fUid.substring(0, 6)})`,
          status: 'active',
          startedAt: null,
          submittedAt: null,
          lastSeen: null,
          flagCount: 0,
          highFlags: 0,
          mediumFlags: 0,
          lowFlags: 0,
          latestEvent: null,
          latestSnapshot: null,
          flags: [],
        };
        candidateMap.set(student.email, student);
      }

      if (student.status !== 'submitted') {
        student.status = 'active';
      }

      // Process flags
      const sortedFlags = flagEntries.map(([fKey, flagVal]) => ({
        id: fKey,
        event: flagVal.event || 'Infraction',
        severity: flagVal.severity || 'medium',
        timestamp: flagVal.timestamp || flagVal.createdAt || new Date().toISOString(),
        duration: flagVal.duration,
        snapshot: flagVal.snapshot,
        detection: flagVal.detection,
      })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      student.flags = sortedFlags;
      student.flagCount = sortedFlags.length;
      student.highFlags = sortedFlags.filter(f => f.severity === 'high').length;
      student.mediumFlags = sortedFlags.filter(f => f.severity === 'medium').length;
      student.lowFlags = sortedFlags.filter(f => f.severity === 'low').length;

      if (sortedFlags.length > 0) {
        student.latestEvent = sortedFlags[0].event;
        const flagWithSnapshot = sortedFlags.find(f => f.snapshot);
        if (flagWithSnapshot) {
          student.latestSnapshot = flagWithSnapshot.snapshot || null;
        }

        const latestFlagTime = String(sortedFlags[0].timestamp);
        if (!student.lastSeen || latestFlagTime > student.lastSeen) {
          student.lastSeen = latestFlagTime;
        }
      }
    }

    const candidateList = Array.from(candidateMap.values());

    // Sort: Active candidates with high flags first, then other active, then submitted, then not started
    candidateList.sort((a, b) => {
      const statusWeight = (s: string) => (s === 'active' ? 3 : s === 'submitted' ? 2 : 1);
      const diff = statusWeight(b.status) - statusWeight(a.status);
      if (diff !== 0) return diff;
      return b.highFlags * 3 + b.mediumFlags - (a.highFlags * 3 + a.mediumFlags);
    });

    const totalActive = candidateList.filter(c => c.status === 'active').length;
    const totalSubmitted = candidateList.filter(c => c.status === 'submitted').length;
    const totalNotStarted = candidateList.filter(c => c.status === 'not_started').length;
    const totalFlagged = candidateList.filter(c => c.flagCount > 0).length;

    return NextResponse.json({
      success: true,
      live: true,
      userRole,
      test: {
        id: activeTestId,
        title: testTitle,
        startedAt: testState.startedAt || null,
        scheduledStart: testState.scheduledStart || null,
      },
      stats: {
        total: candidateList.length,
        active: totalActive,
        submitted: totalSubmitted,
        notStarted: totalNotStarted,
        flagged: totalFlagged,
      },
      candidates: candidateList,
    });
  } catch (err: any) {
    console.error('Error in /api/live-stats:', err);
    return NextResponse.json({ success: false, error: err.message || 'Server error' }, { status: 500 });
  }
}
