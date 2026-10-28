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

    // If no live exam is running, return idle state
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

    // 5. Fetch registered participants directory
    const participantsSnap = await db.ref('participants').once('value');
    const participantsVal = participantsSnap.val() || {};
    const decodeEmail = (k: string) => k.replace(/,/g, '.');

    // Index participants by email and by UID for fast lookups
    const uidToParticipant = new Map<string, any>();
    const emailToParticipant = new Map<string, any>();

    for (const [key, pData] of Object.entries<any>(participantsVal)) {
      if (!pData) continue;
      const pEmail = (pData.email || decodeEmail(key)).trim().toLowerCase();
      emailToParticipant.set(pEmail, pData);
      if (pData.uid) {
        uidToParticipant.set(pData.uid, pData);
      }
    }

    // Also check test-specific registered participants
    const testParticipants = testData.participants || {};

    // 6. Fetch submissions for this test
    const submissionsSnap = await db.ref(`submissions/${activeTestId}`).once('value');
    const submissionsVal = submissionsSnap.val() || {};

    // 7. Fetch proctoring flags for all users
    const flagsSnap = await db.ref('proctoringFlags').once('value');
    const allFlags = flagsSnap.val() || {};

    // ── GATHER ALL RELEVANT UIDS FOR BATCH RESOLUTION ─────────
    const allUids = new Set<string>();

    for (const subUid of Object.keys(submissionsVal)) {
      if (subUid) allUids.add(subUid);
    }
    for (const fUid of Object.keys(allFlags)) {
      const userFlagNode = allFlags[fUid];
      // Check if candidate has flags for this active test
      if (userFlagNode?.[activeTestId] || userFlagNode?.flags) {
        allUids.add(fUid);
      }
    }
    for (const [pUid, pVal] of Object.entries<any>(testParticipants)) {
      if (pVal && pVal.TermsAgreeRecord) {
        allUids.add(pUid);
      }
    }

    // Query Firebase Admin Auth in chunks of 100 to retrieve display names and emails
    const authUsersMap = new Map<string, { email: string; displayName?: string }>();
    const uidArray = Array.from(allUids);

    for (let i = 0; i < uidArray.length; i += 100) {
      const chunk = uidArray.slice(i, i + 100).map(uid => ({ uid }));
      try {
        const authResult = await getAdminAuth().getUsers(chunk);
        for (const u of authResult.users) {
          authUsersMap.set(u.uid, {
            email: (u.email || '').toLowerCase(),
            displayName: u.displayName || undefined,
          });
        }
      } catch (authErr) {
        console.warn('Batch auth user lookup note:', authErr);
      }
    }

    // Helper: Resolve best name, email, and roll number for any UID
    const resolveIdentity = (uid: string, fallbackEmail = '', fallbackName = '') => {
      let resolvedEmail = fallbackEmail.toLowerCase();
      let resolvedName = fallbackName;
      let resolvedRoll = '';

      // 1. Check RTDB participants table by UID
      const fromUidPart = uidToParticipant.get(uid);
      if (fromUidPart) {
        if (fromUidPart.email) resolvedEmail = fromUidPart.email.toLowerCase();
        if (fromUidPart.name) resolvedName = fromUidPart.name;
        resolvedRoll = fromUidPart.rollNumber || fromUidPart.roll || '';
      }

      // 2. Check Firebase Admin Auth
      const authUser = authUsersMap.get(uid);
      if (authUser) {
        if (!resolvedEmail && authUser.email) resolvedEmail = authUser.email;
        if (!resolvedName && authUser.displayName) resolvedName = authUser.displayName;
      }

      // 3. Check RTDB participants table by email
      if (resolvedEmail) {
        const fromEmailPart = emailToParticipant.get(resolvedEmail);
        if (fromEmailPart) {
          if (fromEmailPart.name) resolvedName = fromEmailPart.name;
          if (!resolvedRoll) resolvedRoll = fromEmailPart.rollNumber || fromEmailPart.roll || '';
        }
      }

      // 4. Fallback if name is still missing
      if (!resolvedName && resolvedEmail) {
        const prefix = resolvedEmail.split('@')[0];
        // Clean up common formats e.g. "kartikey.bora" -> "Kartikey Bora"
        resolvedName = prefix
          .replace(/[._-]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
      }

      if (!resolvedName) {
        resolvedName = `Candidate (${uid.substring(0, 6)})`;
      }

      return {
        email: resolvedEmail || `candidate_${uid.substring(0, 6)}`,
        name: resolvedName,
        roll: resolvedRoll,
      };
    };

    // Candidate dictionary keyed by UID (or email if UID unknown)
    const candidateMap = new Map<string, {
      uid: string;
      email: string;
      name: string;
      roll: string;
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

    // A. Add registered participants assigned to this test
    for (const [key, pData] of Object.entries<any>(participantsVal)) {
      if (!pData) continue;
      const pEmail = (pData.email || decodeEmail(key)).toLowerCase();
      const isAssigned = pData.allowed !== false && (
        !pData.tests ||
        Object.keys(pData.tests).length === 0 ||
        pData.tests[activeTestId] === true
      );

      if (isAssigned) {
        const pUid = pData.uid || '';
        const mapKey = pUid || pEmail;
        candidateMap.set(mapKey, {
          uid: pUid,
          email: pEmail,
          name: pData.name || pEmail.split('@')[0],
          roll: pData.rollNumber || pData.roll || '',
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

    // B. Link submissions
    for (const [subUid, sub] of Object.entries<any>(submissionsVal)) {
      const subEmail = (sub?.email || '').toLowerCase();
      let record = candidateMap.get(subUid);

      if (!record && subEmail) {
        record = candidateMap.get(subEmail);
      }

      const ident = resolveIdentity(subUid, subEmail, sub?.name);

      if (!record) {
        record = {
          uid: subUid,
          email: ident.email,
          name: ident.name,
          roll: ident.roll,
          status: 'submitted',
          startedAt: null,
          submittedAt: sub?.submittedAt || null,
          lastSeen: sub?.submittedAt || null,
          flagCount: 0,
          highFlags: 0,
          mediumFlags: 0,
          lowFlags: 0,
          latestEvent: null,
          latestSnapshot: null,
          flags: [],
        };
        candidateMap.set(subUid, record);
      } else {
        record.uid = subUid;
        record.status = 'submitted';
        record.submittedAt = sub?.submittedAt || record.submittedAt;
        if (ident.name) record.name = ident.name;
        if (ident.email) record.email = ident.email;
        if (ident.roll) record.roll = ident.roll;
        if (sub?.submittedAt && (!record.lastSeen || sub.submittedAt > record.lastSeen)) {
          record.lastSeen = sub.submittedAt;
        }
      }
    }

    // C. Inspect terms agreements in test participants
    for (const [pUid, pVal] of Object.entries<any>(testParticipants)) {
      if (pVal && pVal.TermsAgreeRecord) {
        const parts = String(pVal.TermsAgreeRecord).split(',');
        const agreedTime = parts[1] || null;

        let record = candidateMap.get(pUid);
        if (!record) {
          const ident = resolveIdentity(pUid);
          record = candidateMap.get(ident.email);
        }

        if (!record) {
          const ident = resolveIdentity(pUid);
          record = {
            uid: pUid,
            email: ident.email,
            name: ident.name,
            roll: ident.roll,
            status: 'active',
            startedAt: agreedTime,
            submittedAt: null,
            lastSeen: agreedTime,
            flagCount: 0,
            highFlags: 0,
            mediumFlags: 0,
            lowFlags: 0,
            latestEvent: null,
            latestSnapshot: null,
            flags: [],
          };
          candidateMap.set(pUid, record);
        } else {
          record.uid = pUid;
          if (record.status !== 'submitted') {
            record.status = 'active';
          }
          if (agreedTime && (!record.startedAt || agreedTime < record.startedAt)) {
            record.startedAt = agreedTime;
          }
          if (agreedTime && (!record.lastSeen || agreedTime > record.lastSeen)) {
            record.lastSeen = agreedTime;
          }
        }
      }
    }

    // D. Scan proctoringFlags for active exam infractions & captured proof frames
    for (const [fUid, fData] of Object.entries<any>(allFlags)) {
      // Check flags under specific test or top-level flags
      const testFlagsObj = fData?.[activeTestId]?.flags || fData?.flags;
      if (!testFlagsObj) continue;

      const flagEntries = Object.entries<any>(testFlagsObj);
      if (flagEntries.length === 0) continue;

      const ident = resolveIdentity(fUid);

      let student = candidateMap.get(fUid);
      if (!student && ident.email) {
        student = candidateMap.get(ident.email);
      }

      if (!student) {
        student = {
          uid: fUid,
          email: ident.email,
          name: ident.name,
          roll: ident.roll,
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
        candidateMap.set(fUid, student);
      } else {
        student.uid = fUid;
        if (ident.name && student.name.startsWith('Candidate (')) student.name = ident.name;
        if (ident.email && student.email.startsWith('candidate_')) student.email = ident.email;
        if (ident.roll) student.roll = ident.roll;
      }

      if (student.status !== 'submitted') {
        student.status = 'active';
      }

      // Process and normalize flags
      // IMPORTANT: In RTDB, snapshots are stored as evidenceSnapshot (or snapshot)
      // Timestamps are stored as startTime (or timestamp / createdAt)
      // Durations are stored as durationInSeconds (or duration)
      const sortedFlags = flagEntries.map(([fKey, flagVal]) => {
        const rawSnapshot = flagVal.evidenceSnapshot || flagVal.snapshot || flagVal.evidence || flagVal.proof || null;
        const rawTime = flagVal.startTime || flagVal.timestamp || flagVal.createdAt || flagVal.endTime || new Date().toISOString();
        const rawDuration = flagVal.durationInSeconds ?? flagVal.duration ?? 0;

        return {
          id: fKey,
          event: flagVal.event || 'Infraction',
          severity: (flagVal.severity || 'medium').toLowerCase(),
          timestamp: rawTime,
          duration: rawDuration,
          snapshot: rawSnapshot,
          detection: flagVal.detection || null,
        };
      }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      student.flags = sortedFlags;
      student.flagCount = sortedFlags.length;
      student.highFlags = sortedFlags.filter(f => f.severity === 'high').length;
      student.mediumFlags = sortedFlags.filter(f => f.severity === 'medium').length;
      student.lowFlags = sortedFlags.filter(f => f.severity === 'low').length;

      if (sortedFlags.length > 0) {
        student.latestEvent = sortedFlags[0].event;

        // Find the most recent flag that contains a captured proof snapshot
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

    // Sort: Active candidates with infractions first, then active, then submitted, then not started
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
