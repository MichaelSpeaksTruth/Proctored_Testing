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
import { Lock, Camera, Monitor, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
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
  const [violation, setViolation] = useState<string | null>(null);
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
  const [lives, setLives] = useState(3);
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
    // Fetch questions from the edge-cached API route
    fetch('/api/get-test-questions')
      .then(async (res) => {
        if (!res.ok) return; // No active test or error — handled elsewhere
        const payload = await res.json() as { testId: string; title: string; sections: Section[] };
        setTestId(payload.testId);
        setTestData({ title: payload.title, sections: payload.sections });
      })
      .catch(() => {
        // Network failure during question load — student sees the spinner.
        // They can refresh; localStorage will restore their answers.
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

  // ── Check if already submitted ─────────────────────────────
  useEffect(() => {
    if (uid && testId) {
      get(ref(rtdb, `submissions/${testId}/${uid}`)).then(snap => {
        if (snap.exists()) {
          setSubmitted(true);
          router.replace('/student-dashboard');
        }
      });
    }
  }, [uid, testId, router]);

  // ── Restore student exam start time from localStorage on reload ──
  // This ensures the timer continues from where it left off after a reload.
  useEffect(() => {
    if (!testId || !uid) return;
    const lsKey = `pt_exam_start_${testId}_${uid}`;
    const stored = localStorage.getItem(lsKey);
    if (stored) {
      setStudentExamStartedAt(stored);
    }
  }, [testId, uid]);

  // ── Enforce fullscreen ────────────────────────────────────────
  const enterFullscreenAndStart = useCallback(() => {
    if (!isMobileDevice && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error);
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
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
            ? 'Camera is being used by another application. Please close any other video apps (Teams, Zoom, another browser tab) and try again.'
            : err.name === 'NotAllowedError'
            ? 'Permission denied. Please click the camera icon in the browser address bar and set both Camera and Microphone to Allow, then try again.'
            : err.name === 'NotFoundError'
            ? 'No camera or microphone found. Please ensure your webcam is connected and not disabled in Windows Device Manager.'
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
    } else if (event === 'DUCKING_DOWN') {
      deductLife = true;
      isCritical = true;
      setCriticalViolationMsg(`Face out of frame boundaries`);
    } else if (event === 'NO_FACE' || event === 'MULTIPLE_FACES') {
      deductLife = true;
      isCritical = true;
      setCriticalViolationMsg(messages[event]);
    }

    if (deductLife) {
      setLives(l => Math.max(0, l - 1));
    }

    if (event === 'HEAD_PITCH_DOWN') {
      // 3. Grace Period Escalation: Show warning immediately, penalize only if it lasts 5s
      setViolation(messages[event]);
      if (violationTimeoutRef.current) clearTimeout(violationTimeoutRef.current);
      violationTimeoutRef.current = setTimeout(() => setViolation(null), 3500);

      if (activeTimersRef.current[event]) clearTimeout(activeTimersRef.current[event]);
      activeTimersRef.current[event] = setTimeout(() => {
        setLives(l => Math.max(0, l - 1));
        setCriticalViolationMsg(`Looking down detected`);
        setPenaltyBoxEndTime(Date.now() + 5000);
      }, 5000);
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
        // Also clear the exam start time so a future test session starts fresh
        try { localStorage.removeItem(`pt_exam_start_${testId}_${uid}`); } catch { /* ignore */ }
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
          minHeight: '100vh',
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
            This proctored examination requires access to your camera and microphone. Your video is
            processed locally and never sent to any server.
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
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-xl)' }}>
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
          />
        )}
        <div style={{ position: 'fixed', opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
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
            <CountdownTimer
              durationSeconds={(() => {
                // Use the student's personal exam start time (stored in localStorage)
                // to compute the true remaining time for this section.
                // This prevents the timer resetting to full duration on page reload.
                // We do NOT use testStartedAt (admin start time) — that would
                // compute a negative remaining time for students who join late.
                if (studentExamStartedAt) {
                  const elapsedSeconds = Math.floor(
                    (Date.now() - new Date(studentExamStartedAt).getTime()) / 1000
                  );
                  // Subtract time used by previous sections
                  let previousSectionsTime = 0;
                  for (let i = 0; i < currentSectionIdx; i++) {
                    previousSectionsTime += testData!.sections[i].timeLimit;
                  }
                  const sectionElapsed = Math.max(0, elapsedSeconds - previousSectionsTime);
                  // Never return 0 here — a 0 causes immediate onExpire
                  return Math.max(1, currentSection.timeLimit - sectionElapsed);
                }
                return currentSection.timeLimit;
              })()}
              label=""
              onExpire={() => {
                if (currentSectionIdx < totalSections - 1) {
                  setCurrentSectionIdx((i) => i + 1);
                  setCurrentQuestionIdx(0);
                } else {
                  handleSubmit(true);
                }
              }}
            />
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
      <div className="test-body" style={{ filter: (reEntryFullscreenLock || isShouldersMisaligned || penaltyRemaining > 0) ? 'blur(16px)' : 'none', transition: 'filter 0.3s ease' }}>
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

      {/* ── Gamified 3-Lives HUD ── */}
      <div style={{
        position: 'fixed',
        bottom: 'var(--space-xl)',
        right: 'var(--space-xl)',
        display: 'flex',
        gap: 8,
        background: 'rgba(10, 15, 20, 0.8)',
        padding: '12px 16px',
        borderRadius: 24,
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(10px)',
        zIndex: 50,
      }}>
        {[...Array(3)].map((_, i) => (
          <div key={i} style={{
            color: i < lives ? '#ff2a4f' : 'rgba(255, 255, 255, 0.1)',
            transition: 'color 0.4s ease',
            fontSize: '1.25rem'
          }}>
            ❤
          </div>
        ))}
      </div>

      {/* ── Enforcement Overlays ── */}
      {reEntryFullscreenLock && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}>
          <div className="card" style={{ maxWidth: 400, textAlign: 'center' }}>
            <h2>Window Unfocused</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>You exited fullscreen or switched tabs. Click below to resume your exam.</p>
            <button className="btn btn-primary" onClick={() => {
              document.documentElement.requestFullscreen().catch(console.error);
              setReEntryFullscreenLock(false);
            }}>Resume Fullscreen</button>
          </div>
        </div>
      )}

      {isShouldersMisaligned && !reEntryFullscreenLock && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5, 5, 10, 0.9)', backdropFilter: 'blur(20px)' }}>
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <Monitor size={24} color="#e63946" />
              <h2 style={{ color: '#e63946', margin: 0, fontSize: '1.25rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Camera Alignment Required</h2>
            </div>
            
            {/* Animated Laptop Lid Icon */}
            <div style={{
              width: 80, height: 60, margin: '24px auto', display: 'flex', flexDirection: 'column', alignItems: 'center'
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

            <p style={{ color: 'var(--text-muted)', marginBottom: 32, maxWidth: 400, fontSize: '0.9375rem', lineHeight: 1.6 }}>
              Adjust your screen angle until your torso is visible within the alignment frame.
            </p>
            <div style={{ position: 'relative', width: 480, height: 360, background: '#000', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
              <WebcamFeed stream={stream} embedded={true} />
              
              {/* Premium HUD Target Frame */}
              <div style={{ position: 'absolute', top: '15%', bottom: '35%', left: '20%', right: '20%', pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: 24, height: 24, borderTop: '2px solid rgba(255,255,255,0.7)', borderLeft: '2px solid rgba(255,255,255,0.7)' }} />
                <div style={{ position: 'absolute', top: 0, right: 0, width: 24, height: 24, borderTop: '2px solid rgba(255,255,255,0.7)', borderRight: '2px solid rgba(255,255,255,0.7)' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, width: 24, height: 24, borderBottom: '2px solid rgba(255,255,255,0.7)', borderLeft: '2px solid rgba(255,255,255,0.7)' }} />
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderBottom: '2px solid rgba(255,255,255,0.7)', borderRight: '2px solid rgba(255,255,255,0.7)' }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {penaltyRemaining > 0 && !reEntryFullscreenLock && !isShouldersMisaligned && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9997, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255, 42, 79, 0.1)' }}>
          <div className="card" style={{ maxWidth: 400, textAlign: 'center', border: '1px solid #ff2a4f' }}>
            <h2 style={{ color: '#ff2a4f' }}>Penalty Applied</h2>
            <p style={{ color: 'white', margin: '16px 0' }}>{criticalViolationMsg}</p>
            <div style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'monospace' }}>{penaltyRemaining}s</div>
          </div>
        </div>
      )}

      {/* Proctoring engine */}
      {uid && examStarted && (
        <ProctoringMonitor
          uid={uid}
          testId={testId ?? undefined}
          videoRef={videoRef}
          onViolation={handleViolation}
          onViolationStart={handleViolationStart}
          onViolationClear={handleViolationClear}
          overlayCanvasRef={overlayCanvasRef}
          isSubmitting={submitted}
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
