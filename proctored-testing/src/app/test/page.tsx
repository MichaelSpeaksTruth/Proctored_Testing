'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, onValue, get } from 'firebase/database';
import StudentGuard from '@/components/StudentGuard';
import ProctoringMonitor, { MonitorStatus } from '@/components/ProctoringMonitor';
import PreTestCalibration from '@/components/PreTestCalibration';
import WebcamFeed from '@/components/WebcamFeed';
import CountdownTimer from '@/components/CountdownTimer';
import QuestionPanel, { Question } from '@/components/QuestionPanel';
import { Lock, Camera, Monitor, CheckCircle2, XCircle, RotateCcw, X, ShieldAlert, ArrowDown, Maximize } from 'lucide-react';
import { ProctoringEvent, DurationFlag } from '@/lib/proctoring';
import { useTestState } from '@/lib/useTestState';

interface Section {
  id: string;
  name: string;
  timeLimit: number;
  questions: Question[];
}

interface TestData {
  title: string;
  sections: Section[];
}



function TestContent() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [testData, setTestData] = useState<TestData | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  // ── Offline-resilient answer state (synced to localStorage) ────
  const { answers, setAnswer, clearPersistedState, wasRestored } = useTestState(testId, uid);
  const [showRestoredBanner, setShowRestoredBanner] = useState(false);
  const [locked, setLocked] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [testFetchError, setTestFetchError] = useState(false);
  const [violation, setViolation] = useState<string | null>(null);
  const wakeLockRef = useRef<any>(null);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  // Student's personal exam start time (stored in localStorage to survive reloads)
  const [studentExamStartedAt, setStudentExamStartedAt] = useState<string | null>(null);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hardwareStatus, setHardwareStatus] = useState<MonitorStatus>({ faceDetected: false, cameraCovered: false, micWorking: false });
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [isAligned, setIsAligned] = useState(false);
  const [calibrationComplete, setCalibrationComplete] = useState(false);
  const violationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Enterprise Proctoring State ──
  const [lives, setLives] = useState(5);
  const [proctoringAgreementAccepted, setProctoringAgreementAccepted] = useState(false);
  const [isShouldersMisaligned, setIsShouldersMisaligned] = useState(false);
  const [penaltyBoxEndTime, setPenaltyBoxEndTime] = useState<number | null>(null);
  const [reEntryFullscreenLock, setReEntryFullscreenLock] = useState(false);
  const [criticalViolationMsg, setCriticalViolationMsg] = useState<string | null>(null);
  const lastIncidentTimeRef = useRef<number>(0);

  // Escalate specific warnings to critical penalties if they persist
  const activeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Penalty Box Countdown Loop ──
  const [penaltyRemaining, setPenaltyRemaining] = useState(0);
  useEffect(() => {
    if (!penaltyBoxEndTime) {
      setPenaltyRemaining(0);
      return;
    }
    const interval = setInterval(() => {
      const remain = Math.max(0, Math.ceil((penaltyBoxEndTime - Date.now()) / 1000));
      setPenaltyRemaining(remain);
      if (remain === 0) setPenaltyBoxEndTime(null);
    }, 200);
    return () => clearInterval(interval);
  }, [penaltyBoxEndTime]);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMobileDevice(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    }
  }, []);

  // ── Auth ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
    });
    return () => unsub();
  }, []);

  // ── Load active test (edge-cached via /api/get-test-questions) ──
  // The first request hits Firebase Admin once; Vercel Edge caches the
  // response globally for 1 hour. Every subsequent load costs 0 DB reads.
  useEffect(() => {
    // Still listen for test status changes (ended / locked)
    const stateRef = ref(rtdb, 'testState');
    const unsub = onValue(stateRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      if (data.status === 'ended') {
        setLocked(true);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const selectedTestId = localStorage.getItem('pt_selected_test');
    const url = selectedTestId ? `/api/get-test-questions?testId=${selectedTestId}` : '/api/get-test-questions';
    
    // Fetch questions from the edge-cached API route
    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          setTestFetchError(true);
          return;
        }
        const payload = await res.json() as { testId: string; title: string; sections: Section[] };
        setTestId(payload.testId);
        setTestData({ title: payload.title, sections: payload.sections });
        setTestFetchError(false);
      })
      .catch(() => {
        // Network failure during question load
        setTestFetchError(true);
      });
  }, []);

  // ── Show restoration banner when answers are hydrated from localStorage ──
  useEffect(() => {
    if (wasRestored) {
      setShowRestoredBanner(true);
      const t = setTimeout(() => setShowRestoredBanner(false), 4000);
      return () => clearTimeout(t);
    }
  }, [wasRestored]);

  // ── Check if already submitted & Sync Flags ────────────────
  useEffect(() => {
    if (uid && testId) {
      get(ref(rtdb, `submissions/${testId}/${uid}`)).then(snap => {
        if (snap.exists()) {
          setSubmitted(true);
          router.replace('/student-dashboard');
        }
      });

      // Check for admin reset via the new 'resets' node or fallback to proctoring flags
      get(ref(rtdb, `resets/${testId}/${uid}`)).then(resetSnap => {
        const resetTime = resetSnap.val();
        const startKey = `pt_exam_start_${testId}_${uid}`;
        const startTimeStr = localStorage.getItem(startKey);
        const startTime = startTimeStr ? new Date(startTimeStr).getTime() : 0;
        
        let shouldReset = false;
        if (resetTime && resetTime > startTime) {
          shouldReset = true;
        }

        get(ref(rtdb, `proctoringFlags/${uid}/${testId}/flags`)).then(flagSnap => {
          const flagsData = flagSnap.val();
          if (!flagsData) {
            const storedLives = localStorage.getItem(`pt_lives_${testId}_${uid}`);
            if (storedLives && parseInt(storedLives, 10) < 5) {
               shouldReset = true;
            }
          }

          // In case the timer is completely stuck in the past, and they have no submission, 
          // we can also auto-reset them if they request it, but admin reset is safer.

          if (shouldReset) {
            console.log('Admin reset detected. Clearing local state.');
            setLives(5);
            localStorage.removeItem(`pt_lives_${testId}_${uid}`);
            localStorage.removeItem(`pt_exam_start_${testId}_${uid}`);
            localStorage.removeItem(`pt_section_end_${testId}_${uid}`);
            localStorage.removeItem(`pt_section_times_${testId}_${uid}`);
            clearPersistedState(); // Clear answers from useTestState
            setStudentExamStartedAt(null);
          }
        });
      });
    }
  }, [uid, testId, router]);

  // ── Restore student exam start time and lives from localStorage on reload ──
  // This ensures the timer and lives continue from where it left off after a reload.
  useEffect(() => {
    if (!testId || !uid) return;
    const lsKey = `pt_exam_start_${testId}_${uid}`;
    const stored = localStorage.getItem(lsKey);
    if (stored) {
      setStudentExamStartedAt(stored);
    }

    const livesKey = `pt_lives_${testId}_${uid}`;
    const storedLives = localStorage.getItem(livesKey);
    if (storedLives) {
      const parsed = parseInt(storedLives, 10);
      if (!isNaN(parsed)) setLives(parsed);
    }
  }, [testId, uid]);

  // Persist lives to localStorage whenever they change
  useEffect(() => {
    if (!testId || !uid) return;
    const livesKey = `pt_lives_${testId}_${uid}`;
    localStorage.setItem(livesKey, lives.toString());
  }, [lives, testId, uid]);

  // ── Enforce fullscreen ────────────────────────────────────────
  const enterFullscreenAndStart = useCallback(() => {
    if (!isMobileDevice && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error);
    }
    // Android fix (Bug A7): Request Screen Wake Lock so the display doesn't
    // turn off mid-exam (causing a visibilitychange TAB_SWITCHED false violation).
    if ('wakeLock' in navigator) {
      (navigator as any).wakeLock.request('screen')
        .then((lock: any) => { wakeLockRef.current = lock; })
        .catch(() => { /* Wake lock not supported / denied — non-critical */ });
    }
    // Record the student's personal exam start time so the timer
    // survives page reloads without resetting to the full duration.
    // Key is per-test-per-user to avoid collisions.
    const lsKey = `pt_exam_start_${testId}_${uid}`;
    let startTime = localStorage.getItem(lsKey);
    if (!startTime) {
      startTime = new Date().toISOString();
      localStorage.setItem(lsKey, startTime);
    }
    setStudentExamStartedAt(startTime);
    setExamStarted(true);
  }, [isMobileDevice, testId, uid]);

  // ── Request camera + mic permissions ─────────────────────────
  // NotReadableError means the hardware is still held by a previous page load.
  // We retry up to 3 times with a 1.5s delay to let the OS release the device.
  const requestPermissions = async () => {
    setRequestingPermissions(true);
    setPermError(null);

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          // Android fix (Bug A1): specify facingMode to force the front camera.
          // Performance fix: clamp resolution to 640x480 max to save CPU/RAM on AI
          video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: true,
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
        setPermissionsGranted(true);
        setRequestingPermissions(false);
        return; // success
      } catch (err: any) {
        console.error(`Permission attempt ${attempt}/${MAX_RETRIES}:`, err);

        if (err.name === 'NotReadableError' && attempt < MAX_RETRIES) {
          // Camera is still held by a previous page load — wait and retry
          setPermError(`Camera hardware busy, retrying... (attempt ${attempt}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }

        // Final failure or non-retryable error
        setPermError(
          err.name === 'NotReadableError'
            ? 'Camera is being used by another application. Please close any other video apps and try again.'
            : err.name === 'NotAllowedError'
            ? (isMobileDevice
                ? 'Permission denied. Please go to your browser Settings → Site Settings → Camera & Microphone, find this site, and allow access. Then reload the page.'
                : 'Permission denied. Please click the camera icon in the browser address bar and set both Camera and Microphone to Allow, then try again.')
            : err.name === 'NotFoundError'
            ? 'No camera or microphone found. Please ensure your device has a working camera and microphone.'
            : `Device error (${err.name}): ${err.message}`
        );
        break;
      }
    }

    setRequestingPermissions(false);
  };

  const handleViolationStart = useCallback((event: ProctoringEvent) => {
    const messages: Record<ProctoringEvent, string> = {
      NO_FACE:            `No face detected in frame`,
      MULTIPLE_FACES:     `Multiple faces detected`,
      TAB_SWITCHED:       `Tab switching detected`,
      LEFT_FULLSCREEN:    `Exited fullscreen`,
      LOUD_AUDIO:         `Loud audio detected`,
      CAMERA_COVERED:     `Camera covered`,
      MIC_MUTED:          `Microphone muted`,
      PHONE_DETECTED:     `Mobile device detected`,
      GAZE_AWAY:          `Looking away from screen`,
      HEAD_PITCH_DOWN:    `Looking down detected`,
      DUCKING_DOWN:       `Face out of frame boundaries`,
      SHOULDERS_OUT_OF_FRAME: `Camera alignment required`,
    };

    // 1. Handle dynamic shoulder alignment (does not deduct lives, just blurs until fixed)
    if (event === 'SHOULDERS_OUT_OF_FRAME') {
      setIsShouldersMisaligned(true);
      return;
    }

    // 2. Atomic Offense Deduplication (Tab Switch & Fullscreen Exit)
    let isCritical = false;
    let deductLife = false;

    if (event === 'TAB_SWITCHED' || event === 'LEFT_FULLSCREEN') {
      const now = Date.now();
      // If both fire within 1500ms, only count as 1 offense
      if (now - lastIncidentTimeRef.current > 1500) {
        deductLife = true;
        isCritical = true;
        setCriticalViolationMsg(`Window unfocused or exited fullscreen`);
      }
      lastIncidentTimeRef.current = now;
      if (event === 'LEFT_FULLSCREEN' && !isMobileDevice) {
        setReEntryFullscreenLock(true);
      }
    } else if (event === 'MULTIPLE_FACES' || event === 'NO_FACE' || event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN') {
      deductLife = true;
      // We will suppress the UI for these below, but they still deduct a life
    }

    if (deductLife) {
      setLives(l => Math.max(0, l - 1));
    }

    // Completely suppress UI feedback for these events (no toast, no penalty box)
    if (event === 'HEAD_PITCH_DOWN' || event === 'DUCKING_DOWN' || event === 'NO_FACE' || event === 'MULTIPLE_FACES') {
      return;
    }

    if (isCritical) {
      setPenaltyBoxEndTime(Date.now() + 5000); // 5-second mandatory blur
    } else {
      // Show normal non-critical toast warning
      setViolation(messages[event] || 'Proctoring violation detected');
      if (violationTimeoutRef.current) clearTimeout(violationTimeoutRef.current);
      violationTimeoutRef.current = setTimeout(() => setViolation(null), 3500);
    }
  }, [isMobileDevice]);

  const handleViolationClear = useCallback((event: ProctoringEvent) => {
    if (event === 'SHOULDERS_OUT_OF_FRAME') {
      setIsShouldersMisaligned(false);
    }
    
    // Clear escalation timer if user corrected the behavior before the grace period ended
    if (activeTimersRef.current[event]) {
      clearTimeout(activeTimersRef.current[event]);
      delete activeTimersRef.current[event];
    }
  }, []);

  const handleViolation = useCallback((flag: DurationFlag) => {
    // This fires when the violation ends and is logged to the DB.
    // We already showed the banner on start, but we can update it with duration if needed.
  }, []);



  // ── Submit ────────────────────────────────────────────────
  // Sends answers to the server-side /api/grade-test relay instead of
  // writing directly from the client. The API verifies the user's ID token
  // before writing, preventing any spoofed or replayed submissions.
  const handleSubmit = useCallback(
    async (autoSubmit = false) => {
      if (submitted || !uid || !testId) return;
      setSubmitted(true);
      // Release Screen Wake Lock on submit
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      try {
        // Get a fresh Firebase ID token to authenticate the server request.
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error('Could not retrieve ID token.');

        const res = await fetch('/api/grade-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            testId,
            uid,
            answers,
            idToken,
            email: auth.currentUser?.email ?? '',
            name: auth.currentUser?.displayName ?? '',
            autoSubmitted: autoSubmit,
          }),
        });

        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
          throw new Error(error);
        }

        // Clear localStorage only after confirmed server write
        clearPersistedState();
        // Also clear local timing and proctoring state so a future test session starts fresh
        try { 
          localStorage.removeItem(`pt_exam_start_${testId}_${uid}`);
          localStorage.removeItem(`pt_lives_${testId}_${uid}`);
          localStorage.removeItem(`pt_section_times_${testId}_${uid}`);
        } catch { /* ignore */ }
        if (document.fullscreenElement) document.exitFullscreen();
        router.replace('/student-dashboard');
      } catch (err) {
        console.error('Submit failed:', err);
        setSubmitted(false);
      }
    },
    [submitted, uid, testId, answers, clearPersistedState, router]
  );

  // Cleanup media stream on unmount
  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  const currentSection = testData?.sections[currentSectionIdx];
  const currentQuestion = currentSection?.questions[currentQuestionIdx];
  const totalSections = testData?.sections.length || 0;
  const totalQuestions = currentSection?.questions.length || 0;

  // ── Block exam cheating shortcuts (copy, right-click, print) ──────────
  useEffect(() => {
    if (!examStarted) return;
    const blockCopy = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        ['c', 'C', 'a', 'A', 's', 'S', 'p', 'P', 'u', 'U'].includes(e.key)
      ) {
        e.preventDefault();
      }
    };
    const blockContext = (e: MouseEvent) => e.preventDefault();
    const blockPrint = () => window.print = () => {};
    document.addEventListener('keydown', blockCopy);
    document.addEventListener('contextmenu', blockContext);
    blockPrint();
    return () => {
      document.removeEventListener('keydown', blockCopy);
      document.removeEventListener('contextmenu', blockContext);
    };
  }, [examStarted]);

  // ── Admin force-end lock screen ────────────────────────────
  if (locked && !submitted) {
    handleSubmit(true);
    return (
      <div className="lock-overlay">
        <div style={{ marginBottom: 'var(--space-md)' }}>
          <Lock size={48} color="var(--accent-red)" />
        </div>
        <h2>Examination Ended</h2>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', maxWidth: 400 }}>
          The test has been locked (either by the administrator or due to repeated proctoring violations). Your answers have been auto-submitted. Please wait
          for further instructions.
        </p>
        <div className="spinner" />
      </div>
    );
  }

  // ── Permission gate ─────────────────────────────────────────
  if (!permissionsGranted) {
    return (
      <main
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-xl)',
        }}
      >
        <div className="card" style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <Camera size={40} color="var(--text-primary)" />
          </div>
          <h2 style={{ marginBottom: 'var(--space-sm)' }}>Camera & Microphone Required</h2>
          <p style={{ marginBottom: 'var(--space-xl)' }}>
            This proctored examination requires access to your camera and microphone.
          </p>
          {permError && (
            <div className="alert alert-danger" style={{ marginBottom: 'var(--space-lg)' }}>
              {permError}
            </div>
          )}
          <button
            id="grant-permissions-btn"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={requestPermissions}
            disabled={requestingPermissions}
          >
            {requestingPermissions ? (
              <><div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> Requesting...</>
            ) : (
              'Grant Permissions'
            )}
          </button>
        </div>
      </main>
    );
  }

  // ── Start Exam Gate (Preflight Check) ────────────────────────
  if (permissionsGranted && !examStarted) {
    const allGood = hardwareStatus.faceDetected && !hardwareStatus.cameraCovered && hardwareStatus.micWorking;
    
    return (
      <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-xl)' }}>
        <div className="card" style={{ maxWidth: 480, width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
            <Monitor size={40} color="var(--text-primary)" />
          </div>
          <h2 style={{ textAlign: 'center', marginBottom: 'var(--space-sm)' }}>Hardware Verification</h2>
          <p style={{ textAlign: 'center', marginBottom: 'var(--space-lg)', color: 'var(--text-muted)' }}>
            Please ensure your face is visible and your microphone is working before starting the exam.
          </p>

          <div style={{ background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-sm)' }}>
              <span>Face Detected</span>
              {hardwareStatus.faceDetected ? <CheckCircle2 size={20} color="var(--accent-green)" /> : <XCircle size={20} color="var(--accent-red)" />}
            </div>
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-sm)' }}>
              <span>Camera Uncovered</span>
              {!hardwareStatus.cameraCovered ? <CheckCircle2 size={20} color="var(--accent-green)" /> : <XCircle size={20} color="var(--accent-red)" />}
            </div>
            <div className="flex justify-between items-center">
              <span>Microphone Working</span>
              {hardwareStatus.micWorking ? <CheckCircle2 size={20} color="var(--accent-green)" /> : <XCircle size={20} color="var(--accent-red)" />}
            </div>
            {!hardwareStatus.micWorking && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
                * Try speaking or making some noise. If your microphone is physically muted, please unmute it.
              </p>
            )}
          </div>

          <PreTestCalibration 
            isAligned={isAligned} 
            isHardwareReady={allGood} 
            onCalibrationComplete={() => setCalibrationComplete(true)} 
          />

          <button
            className="btn btn-success btn-lg"
            style={{ width: '100%', justifyContent: 'center', marginTop: 'var(--space-md)' }}
            onClick={enterFullscreenAndStart}
            disabled={!allGood || !calibrationComplete}
          >
            {allGood ? (calibrationComplete ? (isMobileDevice ? 'Start Exam' : 'Start Exam & Enter Fullscreen') : 'Hold still to calibrate...') : 'Waiting for hardware...'}
          </button>
        </div>
        
        {uid && (
          <ProctoringMonitor
            uid={uid}
            calibrationMode
            onStatusChange={setHardwareStatus}
            videoRef={videoRef}
            overlayCanvasRef={overlayCanvasRef}
            onAlignmentUpdate={setIsAligned}
            stream={stream}
            isMobile={isMobileDevice}
          />
        )}
        <div style={{ position: 'fixed', opacity: 0.01, pointerEvents: 'none', zIndex: -1, width: 10, height: 10, overflow: 'hidden' }}>
           <div style={{ position: 'relative' }}>
             <WebcamFeed ref={videoRef} stream={stream} />
             <canvas ref={overlayCanvasRef} style={{ position: 'absolute', inset: 0 }} />
           </div>
        </div>
      </main>
    );
  }

  // ── Main test interface ───────────────────────────────────
  return (
    <main className="exam-secure-zone" style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>

      {/* Restoration banner — slides in when progress is recovered from localStorage */}
      {showRestoredBanner && (
        <div
          style={{
            position: 'fixed',
            bottom: 'var(--space-lg)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'rgba(45,106,79,0.95)',
            border: '1px solid rgba(82,183,136,0.4)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: '0.875rem',
            color: '#d8f3dc',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            animation: 'fadeSlideUp 0.3s ease',
            whiteSpace: 'nowrap',
          }}
        >
          <RotateCcw size={15} />
          Progress restored — your previous answers have been recovered.
        </div>
      )}

      {/* Top bar */}
      <div className="test-topbar">
        <div className="brand">
          <div>
            <div className="brand-name" style={{ fontSize: '0.9375rem' }}>AeroSoc</div>
            <div className="brand-sub">BIT Mesra</div>
          </div>
        </div>

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 2 }}>
            {currentSection?.name}
          </div>
          {currentSection && (
             proctoringAgreementAccepted ? (
               <CountdownTimer
                 key={currentSection.id}
                 durationSeconds={(() => {
                   if (!testId || !uid) return currentSection.timeLimit;
                   const storageKey = `pt_section_end_${testId}_${uid}`;
                   try {
                     const stored = localStorage.getItem(storageKey);
                     const parsed = stored ? JSON.parse(stored) : {};
                     if (parsed[currentSectionIdx]) {
                       const endTime = parsed[currentSectionIdx];
                       const now = Date.now();
                       return Math.max(1, Math.ceil((endTime - now) / 1000));
                     } else {
                       parsed[currentSectionIdx] = Date.now() + currentSection.timeLimit * 1000;
                       localStorage.setItem(storageKey, JSON.stringify(parsed));
                       return currentSection.timeLimit;
                     }
                   } catch { /* */ }
                   return currentSection.timeLimit;
                 })()}
                 label=""
                 isStopped={submitted}
                 onExpire={() => {
                   if (currentSectionIdx < totalSections - 1) {
                     setCurrentSectionIdx((i) => i + 1);
                     setCurrentQuestionIdx(0);
                   } else {
                     handleSubmit(true);
                   }
                 }}
               />
             ) : (
               <div className="timer">--:--:--</div>
             )
          )}
        </div>

        <button
          id="submit-btn"
          className="btn btn-danger btn-sm"
          onClick={() => handleSubmit(false)}
          disabled={submitted}
        >
          {submitted ? 'Submitting...' : 'Submit'}
        </button>
      </div>

      {/* Section tabs */}
      {totalSections > 1 && (
        <div className="section-tabs-bar">
          {testData!.sections.map((sec, idx) => (
            <button
              key={sec.id}
              id={`section-tab-${idx}`}
              onClick={() => { setCurrentSectionIdx(idx); setCurrentQuestionIdx(0); }}
              style={{
                padding: '8px 16px',
                background: idx === currentSectionIdx ? 'var(--bg-card)' : 'transparent',
                border: `1px solid ${idx === currentSectionIdx ? 'var(--border-light)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                color: idx === currentSectionIdx ? 'var(--text-primary)' : 'var(--text-muted)',
                fontFamily: 'var(--font-sans)',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 150ms ease',
              }}
            >
              {sec.name}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="test-body" style={{ filter: (!proctoringAgreementAccepted || reEntryFullscreenLock || isShouldersMisaligned || penaltyRemaining > 0) ? 'blur(16px)' : 'none', transition: 'filter 0.3s ease' }}>
        {/* Question panel first on mobile */}
        <div className="test-question-area">
          {currentQuestion ? (
            <>
              <QuestionPanel
                question={currentQuestion}
                questionIndex={currentQuestionIdx}
                totalQuestions={totalQuestions}
                answer={answers[currentQuestion.id] || ''}
                onChange={(val) => setAnswer(currentQuestion.id, val)}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-md)' }}>
                <button
                  id="prev-question"
                  className="btn btn-outline"
                  disabled={currentQuestionIdx === 0}
                  onClick={() => setCurrentQuestionIdx((i) => i - 1)}
                >
                  ← Prev
                </button>
                {currentQuestionIdx < totalQuestions - 1 ? (
                  <button
                    id="next-question"
                    className="btn btn-primary"
                    onClick={() => setCurrentQuestionIdx((i) => i + 1)}
                  >
                    Next →
                  </button>
                ) : (
                  currentSectionIdx < totalSections - 1 ? (
                    <button
                      id="next-section"
                      className="btn btn-primary"
                      onClick={() => { setCurrentSectionIdx((i) => i + 1); setCurrentQuestionIdx(0); }}
                    >
                      Next Section →
                    </button>
                  ) : (
                    <button
                      id="final-submit"
                      className="btn btn-success"
                      onClick={() => handleSubmit(false)}
                      disabled={submitted}
                    >
                       Finish & Submit
                    </button>
                  )
                )}
              </div>
            </>
          ) : testFetchError ? (
            <div className="loading-center">
              <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                <p style={{ color: 'var(--accent-red-light)', marginBottom: 'var(--space-md)', fontSize: '0.9375rem' }}>
                  Failed to load questions. Please check your connection.
                </p>
                <button
                  className="btn btn-outline"
                  onClick={() => {
                    setTestFetchError(false);
                    const selectedTestId = localStorage.getItem('pt_selected_test');
                    const url = selectedTestId ? `/api/get-test-questions?testId=${selectedTestId}` : '/api/get-test-questions';
                    fetch(url)
                      .then(async (res) => {
                        if (!res.ok) { setTestFetchError(true); return; }
                        const payload = await res.json() as { testId: string; title: string; sections: Section[] };
                        setTestId(payload.testId);
                        setTestData({ title: payload.title, sections: payload.sections });
                        setTestFetchError(false);
                      })
                      .catch(() => setTestFetchError(true));
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <div className="loading-center"><div className="spinner" /></div>
          )}
        </div>

        {/* Question navigator sidebar */}
        <div className="test-navigator card card-sm">
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
            Questions
          </div>
          <div className="q-nav-grid">
            {currentSection?.questions.map((q, idx) => {
              const isAnswered = !!answers[q.id];
              const isCurrent = idx === currentQuestionIdx;
              const cls = [
                'q-nav-btn',
                isCurrent ? 'q-nav-current' : '',
                isAnswered ? 'q-nav-answered' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={q.id}
                  id={`q-nav-${idx}`}
                  className={cls}
                  onClick={() => setCurrentQuestionIdx(idx)}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          <div className="divider" />

          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Answered</span>
              <span style={{ color: '#52b788', fontFamily: 'var(--font-mono)' }}>
                {Object.keys(answers).filter(k => currentSection?.questions.some(q => q.id === k)).length}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Remaining</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {totalQuestions - Object.keys(answers).filter(k => currentSection?.questions.some(q => q.id === k)).length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Proctoring Agreement Overlay ── */}
      {!proctoringAgreementAccepted && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(5, 5, 8, 0.75)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-md)',
        }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid rgba(255, 42, 79, 0.2)',
            borderRadius: 16,
            padding: 'clamp(20px, 5vw, 40px)',
            width: '100%',
            maxWidth: 480,
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 40px rgba(155, 34, 38, 0.1)',
            textAlign: 'center',
          }}>
            <ShieldAlert size={48} color="#9b2226" style={{ marginBottom: 16 }} />
            <h2 style={{ color: '#c0c0c0', marginBottom: 16, fontSize: 'clamp(1.1rem, 4vw, 1.5rem)', letterSpacing: '0.02em' }}>Proctoring Agreement</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9375rem', lineHeight: 1.6 }}>
              This exam uses an advanced monitoring system. Suspicious behavior will be continuously logged and flagged for administrative review. Please ensure you remain in fullscreen, stay visible in the camera, and minimize background noise.
            </p>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => setProctoringAgreementAccepted(true)}
              style={{ width: '100%', background: '#1a1a1a', color: '#c0c0c0', border: '1px solid #333' }}
            >
              Agree & Proceed
            </button>
          </div>
        </div>
      )}

      {/* ── Enforcement Overlays ── */}
      {reEntryFullscreenLock && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5, 5, 10, 0.9)', backdropFilter: 'blur(20px)', padding: 'var(--space-md)' }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid rgba(255, 42, 79, 0.3)',
            borderRadius: 16,
            padding: 'clamp(24px, 5vw, 48px)',
            width: '100%',
            maxWidth: 480,
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 40px rgba(255, 42, 79, 0.1)',
            textAlign: 'center',
          }}>
            <Maximize size={48} color="#ff2a4f" style={{ marginBottom: 20, opacity: 0.9 }} />
            <h2 style={{ color: '#f5f5f5', marginBottom: 16, fontSize: 'clamp(1.1rem, 4vw, 1.5rem)', letterSpacing: '0.02em' }}>Fullscreen Required</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32, fontSize: '0.9375rem', lineHeight: 1.6 }}>
              {isMobileDevice
                ? 'You switched away from the exam. Please return and continue your exam.'
                : 'You have exited fullscreen mode or switched away from the exam window. To maintain the integrity of this exam, you must remain in fullscreen at all times.'}
            </p>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => {
                if (!isMobileDevice) {
                  document.documentElement.requestFullscreen().catch(console.error);
                }
                setReEntryFullscreenLock(false);
              }}
              style={{ width: '100%', background: '#ff2a4f', color: '#fff', border: 'none', fontWeight: 600, letterSpacing: '0.05em' }}
            >
              {isMobileDevice ? 'Return to Exam' : 'Resume Fullscreen'}
            </button>
          </div>
        </div>
      )}

      {isShouldersMisaligned && !reEntryFullscreenLock && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5, 5, 10, 0.9)', backdropFilter: 'blur(20px)', padding: 'var(--space-md)', overflowY: 'auto' }}>
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <Monitor size={24} color="#e63946" />
              <h2 style={{ color: '#e63946', margin: 0, fontSize: 'clamp(0.9rem, 4vw, 1.25rem)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Camera Alignment Required</h2>
            </div>
            
            {/* Animated Laptop Lid Icon */}
            <div style={{
              width: 80, height: 60, margin: '20px auto', display: 'flex', flexDirection: 'column', alignItems: 'center'
            }}>
              <div style={{
                width: 60, height: 40, border: '2px solid rgba(255, 255, 255, 0.9)', borderRadius: '4px 4px 0 0',
                borderBottom: 'none', transformOrigin: 'bottom center',
                animation: 'lid-tilt 2s infinite ease-in-out',
                background: 'rgba(255, 255, 255, 0.05)'
              }} />
              <div style={{
                width: 80, height: 4, background: 'rgba(255, 255, 255, 0.9)', borderRadius: 2
              }} />
            </div>

            <p style={{ color: 'var(--text-muted)', marginBottom: 20, maxWidth: 400, fontSize: '0.9375rem', lineHeight: 1.6, padding: '0 var(--space-sm)' }}>
              Adjust your screen angle until your torso is visible within the alignment frame.
            </p>

            {/* Camera preview — responsive, no fixed pixel dimensions */}
            <div className="shoulder-cam-container" style={{ position: 'relative', width: '100%', maxWidth: 480, background: '#000', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', aspectRatio: '4 / 3' }}>
              <WebcamFeed stream={stream} embedded={true} sharedVideoRef={videoRef} />
              
              {/* Premium HUD Target Frame */}
              <div style={{ position: 'absolute', top: '15%', bottom: '35%', left: '20%', right: '20%', pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: 24, height: 24, borderTop: '2px solid rgba(255,255,255,0.7)', borderLeft: '2px solid rgba(255,255,255,0.7)' }} />
                <div style={{ position: 'absolute', top: 0, right: 0, width: 24, height: 24, borderTop: '2px solid rgba(255,255,255,0.7)', borderRight: '2px solid rgba(255,255,255,0.7)' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, width: 24, height: 24, borderBottom: '2px solid rgba(255,255,255,0.7)', borderLeft: '2px solid rgba(255,255,255,0.7)' }} />
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderBottom: '2px solid rgba(255,255,255,0.7)', borderRight: '2px solid rgba(255,255,255,0.7)' }} />
              </div>
            </div>
            
            {!isMobileDevice && (
              <button className="btn btn-ghost" style={{ marginTop: 20, color: 'var(--text-muted)' }} onClick={() => {
                document.documentElement.requestFullscreen().catch(console.error);
              }}>Resume Fullscreen</button>
            )}
          </div>
        </div>
      )}

      {penaltyRemaining > 0 && !reEntryFullscreenLock && !isShouldersMisaligned && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9997, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5, 5, 10, 0.9)', backdropFilter: 'blur(20px)' }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid rgba(255, 42, 79, 0.3)',
            borderRadius: 16,
            padding: '40px 48px',
            maxWidth: 480,
            boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 40px rgba(255, 42, 79, 0.1)',
            textAlign: 'center',
          }}>
            <ShieldAlert size={48} color="#ff2a4f" style={{ marginBottom: 20, opacity: 0.9 }} />
            <h2 style={{ color: '#ff2a4f', marginBottom: 16, fontSize: '1.5rem', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Security Penalty</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9375rem', lineHeight: 1.6 }}>
              {criticalViolationMsg}
            </p>
            <div style={{ 
              fontSize: '3.5rem', 
              fontWeight: 800, 
              fontFamily: 'var(--font-mono)', 
              color: '#f5f5f5',
              background: 'rgba(255, 42, 79, 0.1)',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 42, 79, 0.2)'
            }}>
              {penaltyRemaining}s
            </div>
            <p style={{ color: 'var(--text-muted)', marginTop: 24, fontSize: '0.8125rem', fontStyle: 'italic' }}>
              Your exam timer is paused while this penalty is active. Repeated violations may result in exam termination.
            </p>
          </div>
        </div>
      )}

      {/* Proctoring engine */}
      {uid && examStarted && !submitted && (
        <ProctoringMonitor
          uid={uid}
          testId={testId ?? undefined}
          videoRef={videoRef}
          onViolation={handleViolation}
          onViolationStart={handleViolationStart}
          onViolationClear={handleViolationClear}
          overlayCanvasRef={overlayCanvasRef}
          isSubmitting={submitted}
          stream={stream}
          isMobile={isMobileDevice}
        />
      )}
      {/* Hidden webcam feed + canvas overlay (not visible to student) */}
      <div style={{ position: 'fixed', opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
        <div style={{ position: 'relative' }}>
          <WebcamFeed ref={videoRef} stream={stream} />
          <canvas ref={overlayCanvasRef} style={{ position: 'absolute', inset: 0 }} />
        </div>
      </div>
    </main>
  );
}

export default function TestPage() {
  return (
    <StudentGuard>
      <TestContent />
    </StudentGuard>
  );
}
