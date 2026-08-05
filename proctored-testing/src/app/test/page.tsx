'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, onValue, get, set } from 'firebase/database';
import StudentGuard from '@/components/StudentGuard';
import ProctoringMonitor from '@/components/ProctoringMonitor';
import WebcamFeed from '@/components/WebcamFeed';
import CountdownTimer from '@/components/CountdownTimer';
import QuestionPanel, { Question } from '@/components/QuestionPanel';
import { Lock, Camera, Monitor } from 'lucide-react';
import { ProctoringEvent, DurationFlag } from '@/lib/proctoring';

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
  const [uid, setUid] = useState<string | null>(null);
  const [testData, setTestData] = useState<TestData | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [locked, setLocked] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [violation, setViolation] = useState<string | null>(null);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const violationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auth ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
    });
    return () => unsub();
  }, []);

  // ── Load active test ─────────────────────────────────────────
  useEffect(() => {
    const stateRef = ref(rtdb, 'testState');
    const unsub = onValue(stateRef, async (snap) => {
      const data = snap.val();
      if (!data) return;
      if (data.status === 'ended') {
        setLocked(true);
      } else if (data.status === 'active' && data.activeTestId) {
        setTestId(data.activeTestId);
        const testSnap = await get(ref(rtdb, `tests/${data.activeTestId}`));
        if (testSnap.exists()) {
          setTestData(testSnap.val() as TestData);
        }
      }
    });
    return () => unsub();
  }, []);

  // ── Enforce fullscreen ────────────────────────────────────────
  const enterFullscreenAndStart = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error);
    }
    setExamStarted(true);
  }, []);

  // ── Request camera + mic permissions ─────────────────────────
  const requestPermissions = async () => {
    setRequestingPermissions(true);
    setPermError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setPermissionsGranted(true);
    } catch (err) {
      setPermError(
        'Camera and microphone access is required to proceed. Please allow access in your browser settings and try again.'
      );
    } finally {
      setRequestingPermissions(false);
    }
  };

  // ── Violation handler (shows banner for 3s) ──────────────────
  const handleViolation = useCallback((flag: DurationFlag) => {
    const messages: Record<ProctoringEvent, string> = {
      INVALID_FACE_COUNT: `WARNING: Face visibility issue logged (${flag.durationInSeconds}s).`,
      TAB_SWITCHED: `WARNING: Tab switching logged (${flag.durationInSeconds}s).`,
      LEFT_FULLSCREEN: `WARNING: Exited fullscreen logged (${flag.durationInSeconds}s).`,
      LOUD_AUDIO: `WARNING: Loud audio logged (${flag.durationInSeconds}s).`,
      CAMERA_COVERED: `CRITICAL: Camera covered logged (${flag.durationInSeconds}s).`,
      PHONE_DETECTED: `CRITICAL: Mobile device detected (${flag.durationInSeconds}s).`,
    };
    setViolation(messages[flag.event] || 'WARNING: Proctoring violation logged.');
    if (violationTimeoutRef.current) clearTimeout(violationTimeoutRef.current);
    violationTimeoutRef.current = setTimeout(() => setViolation(null), 3000);
  }, []);



  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (autoSubmit = false) => {
      if (submitted || !uid || !testId) return;
      setSubmitted(true);
      try {
        await set(ref(rtdb, `submissions/${testId}/${uid}`), {
          answers,
          submittedAt: new Date().toISOString(),
          autoSubmitted: autoSubmit,
        });
        if (document.fullscreenElement) document.exitFullscreen();
        router.replace('/student-dashboard');
      } catch (err) {
        console.error('Submit failed:', err);
        setSubmitted(false);
      }
    },
    [submitted, uid, testId, answers, router]
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

  // ── Start Exam Gate ─────────────────────────────────────────
  if (permissionsGranted && !examStarted) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-xl)' }}>
        <div className="card" style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <Monitor size={40} color="var(--text-primary)" />
          </div>
          <h2 style={{ marginBottom: 'var(--space-sm)' }}>Ready to Begin</h2>
          <p style={{ marginBottom: 'var(--space-xl)', color: 'var(--text-muted)' }}>
            Your camera and microphone are configured. This test must be taken in full-screen mode.
            Exiting full-screen more than once will automatically lock your exam.
          </p>
          <button
            className="btn btn-success btn-lg"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={enterFullscreenAndStart}
          >
            Start Exam & Enter Fullscreen
          </button>
        </div>
        <div style={{ position: 'fixed', opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
           <WebcamFeed ref={videoRef} stream={stream} />
        </div>
      </main>
    );
  }

  // ── Main test interface ───────────────────────────────────
  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Violation banner */}
      {violation && <div className="proctoring-banner">{violation}</div>}

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
              durationSeconds={currentSection.timeLimit}
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
      <div className="test-body">
        {/* Question panel first on mobile */}
        <div className="test-question-area">
          {currentQuestion ? (
            <>
              <QuestionPanel
                question={currentQuestion}
                questionIndex={currentQuestionIdx}
                totalQuestions={totalQuestions}
                answer={answers[currentQuestion.id] || ''}
                onChange={(val) =>
                  setAnswers((prev) => ({ ...prev, [currentQuestion.id]: val }))
                }
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
              return (
                <button
                  key={q.id}
                  id={`q-nav-${idx}`}
                  onClick={() => setCurrentQuestionIdx(idx)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${isCurrent ? 'var(--white)' : isAnswered ? 'var(--accent-green)' : 'var(--border)'}`,
                    background: isCurrent ? 'rgba(255,255,255,0.1)' : isAnswered ? 'rgba(45,106,79,0.2)' : 'var(--bg-input)',
                    color: isCurrent ? 'var(--white)' : isAnswered ? '#52b788' : 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 100ms ease',
                  }}
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



      {/* Proctoring engine + webcam */}
      {uid && examStarted && <ProctoringMonitor uid={uid} videoRef={videoRef} onViolation={handleViolation} />}
      <WebcamFeed ref={videoRef} stream={stream} />
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
