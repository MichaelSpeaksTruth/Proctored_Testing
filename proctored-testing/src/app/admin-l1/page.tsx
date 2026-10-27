'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import RoleGuard from '@/components/RoleGuard';
import EventsAuditView from '@/components/EventsAuditView';
import LeaderboardTable, { LeaderboardEntry } from '@/components/LeaderboardTable';
import ExcelExport from '@/components/ExcelExport';
import { Question } from '@/components/QuestionPanel';
import Image from 'next/image';
import TCCCom from '@/components/TCCCom';
import BackButton from '@/components/BackButton';
import { MessageSquareQuote } from 'lucide-react';

interface Section {
  id: string;
  name: string;
  timeLimit: number;
  questions: Question[];
}

interface TestDraft {
  id: string;
  title: string;
  sections: Section[];
  status?: string;
}

interface ParticipantItem {
  email: string;
  name?: string;
  allowed: boolean;
  tests?: Record<string, boolean>;
}

interface TestOption {
  id: string;
  title: string;
}

function AdminL1Content() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'events' | 'tests' | 'spectator' | 'participants' | 'tcc'>('events');

  // Tests & Questions state
  const [tests, setTests] = useState<TestDraft[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string>('');
  const [loadingTests, setLoadingTests] = useState(false);

  // Spectator state
  const [spectatorTests, setSpectatorTests] = useState<TestOption[]>([]);
  const [spectatorTestId, setSpectatorTestId] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [resultsDeclared, setResultsDeclared] = useState(false);
  const [isInterviewerMode, setIsInterviewerMode] = useState(false);
  const [spectatorSearch, setSpectatorSearch] = useState('');

  // Participants state
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantTestFilter, setParticipantTestFilter] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setCurrentUser(u);
    });
    return () => unsub();
  }, []);

  // Fetch tests for Inspection tab and Spectator tab
  const fetchTestsList = useCallback(async () => {
    setLoadingTests(true);
    try {
      // 1. Shallow test list for options
      const res = await fetch('/api/tests-list');
      const data = await res.json();
      if (Array.isArray(data)) {
        setSpectatorTests(data);
        if (data.length > 0 && !selectedTestId) {
          setSelectedTestId(data[0].id);
        }
      }

      // 2. Full tests data from RTDB for inspection
      const snap = await get(ref(rtdb, 'tests'));
      const val = snap.val();
      if (val) {
        const toArr = <T,>(v: unknown): T[] => {
          if (!v) return [];
          if (Array.isArray(v)) return (v as T[]).filter(Boolean);
          if (typeof v === 'object') return Object.values(v as Record<string, T>).filter(Boolean);
          return [];
        };

        const parsed: TestDraft[] = Object.keys(val).map(key => {
          const t = val[key];
          const sections: Section[] = toArr<Section>(t.sections).map((s: Section) => ({
            ...s,
            questions: toArr<Question>(s.questions),
          }));
          return { id: key, ...t, sections };
        });
        setTests(parsed);
      }
    } catch (err) {
      console.error('Failed to fetch tests in Admin L1:', err);
    } finally {
      setLoadingTests(false);
    }
  }, [selectedTestId]);

  useEffect(() => {
    fetchTestsList();
  }, [fetchTestsList]);

  // Fetch Spectator Results when test changes
  useEffect(() => {
    if (!spectatorTestId) {
      setLeaderboard([]);
      setResultsDeclared(false);
      return;
    }

    const fetchResults = async () => {
      setLoadingLeaderboard(true);
      try {
        const testStateSnap = await get(ref(rtdb, `testState/${spectatorTestId}`));
        const testState = testStateSnap.val();
        if (!testState || !testState.resultsDeclared) {
          setResultsDeclared(false);
          setLeaderboard([]);
          setLoadingLeaderboard(false);
          return;
        }

        const resultsSnap = await get(ref(rtdb, `results/${spectatorTestId}`));
        const resultsVal = resultsSnap.val();
        if (resultsVal) {
          setResultsDeclared(true);
          const uids = Object.keys(resultsVal);
          const entries: LeaderboardEntry[] = await Promise.all(
            uids.map(async uid => {
              const data = resultsVal[uid];
              let flags: any[] = [];
              try {
                const flagsSnap = await get(ref(rtdb, `proctoringFlags/${uid}/${spectatorTestId}/flags`));
                const flagsData = flagsSnap.val();
                if (flagsData) flags = Object.values(flagsData);
              } catch (err) {
                console.warn(`Could not read flags for ${uid}:`, err);
              }

              return {
                uid,
                name: data.name || 'Unknown Candidate',
                email: data.email || 'Unknown Email',
                score: data.score,
                total: data.total,
                rank: data.rank,
                roundStatus: data.roundStatus || 'Pending',
                flagCount: flags.length,
                flags,
                aiSeverity: data.aiSeverity,
                aiSummary: data.aiSummary,
                interviewScheduled: data.interviewScheduled,
                panelNo: data.panelNo,
                venue: data.venue,
                dateTime: data.dateTime,
                integrityFlag: data.integrityFlag,
                delaySeconds: data.delaySeconds,
                flagNote: data.flagNote,
              };
            })
          );
          entries.sort((a, b) => a.rank - b.rank);
          setLeaderboard(entries);
        } else {
          setResultsDeclared(false);
          setLeaderboard([]);
        }
      } catch (err) {
        console.error('Failed to load spectator results:', err);
      } finally {
        setLoadingLeaderboard(false);
      }
    };

    fetchResults();
  }, [spectatorTestId]);

  // Fetch Participants list (view-only) via API route
  const fetchParticipants = useCallback(async () => {
    if (!currentUser) return;
    setLoadingParticipants(true);
    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch('/api/participants-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.participants)) {
        setParticipants(data.participants);
      } else {
        // Fallback to direct RTDB read
        const snap = await get(ref(rtdb, 'participants'));
        const val = snap.val() || {};
        const decodeEmail = (e: string) => e.replace(/,/g, '.');
        const parsed = Object.keys(val).map(key => ({
          email: decodeEmail(key),
          ...(val[key] as { allowed: boolean; name?: string; tests?: Record<string, boolean> }),
        }));
        setParticipants(parsed);
      }
    } catch (err) {
      console.error('Failed to load participants for Admin L1:', err);
    } finally {
      setLoadingParticipants(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (activeTab === 'participants') {
      fetchParticipants();
    }
  }, [activeTab, fetchParticipants]);

  // Filtered Leaderboard for Spectator
  const filteredLeaderboard = useMemo(() => {
    let list = leaderboard;
    if (isInterviewerMode) {
      list = list.filter(e => e.roundStatus === 'Qualified' || e.roundStatus === 'Waitlisted');
    }
    if (spectatorSearch.trim()) {
      const q = spectatorSearch.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q));
    }
    return list;
  }, [leaderboard, isInterviewerMode, spectatorSearch]);

  // Filtered Participants
  const filteredParticipants = useMemo(() => {
    return participants.filter(p => {
      if (participantTestFilter) {
        if (!p.tests || !p.tests[participantTestFilter]) return false;
      }
      if (participantSearch.trim()) {
        const q = participantSearch.toLowerCase();
        const nameMatch = p.name?.toLowerCase().includes(q);
        const emailMatch = p.email.toLowerCase().includes(q);
        if (!nameMatch && !emailMatch) return false;
      }
      return true;
    });
  }, [participants, participantTestFilter, participantSearch]);

  const activeTest = tests.find(t => t.id === selectedTestId) || null;

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-md) 0' }}>
      <div className="container" style={{ maxWidth: '1240px' }}>
        {/* Navigation Bar */}
        <nav
          className="navbar"
          style={{
            marginBottom: 'var(--space-xl)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
              <Image src="/aerosoc_logo.jpeg" alt="AeroSoc Logo" width={32} height={32} style={{ objectFit: 'cover' }} />
            </div>
            <div>
              <div className="brand-name">AeroSoc Admin L1</div>
              <div className="brand-sub desktop-only">BIT Mesra &middot; Examination Supervisory Portal</div>
            </div>
          </div>

          <div className="flex items-center gap-md navbar-actions">
            <span
              className="badge badge-gray"
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Admin L1
            </span>
            <span
              style={{
                fontSize: '0.8125rem',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {currentUser?.email}
            </span>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => auth.signOut()}
            >
              Sign Out
            </button>
          </div>
        </nav>

        {/* Tab Selection */}
        <div
          className="flex gap-sm"
          style={{
            marginBottom: 'var(--space-xl)',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 'var(--space-sm)',
            overflowX: 'auto',
          }}
        >
          <button
            className={`btn btn-sm ${activeTab === 'events' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('events')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
          >
            Events View (Activity Log)
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'tests' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('tests')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
          >
            Tests &amp; Question Attribution
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'spectator' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('spectator')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
          >
            Spectator View
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'participants' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('participants')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
          >
            Participants (View Only)
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'tcc' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('tcc')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              whiteSpace: 'nowrap',
              background: activeTab === 'tcc' ? undefined : 'rgba(45, 106, 79, 0.15)',
              color: activeTab === 'tcc' ? undefined : '#52b788',
              border: activeTab === 'tcc' ? undefined : '1px solid rgba(45, 106, 79, 0.35)',
            }}
          >
            <MessageSquareQuote size={14} />
            <span>Team Coordination Corner (TCC)</span>
          </button>
        </div>

        {/* TAB 0: TCC (TEAM COORDINATION CORNER) */}
        {activeTab === 'tcc' && (
          <div style={{ marginBottom: 'var(--space-xl)' }}>
            <TCCCom />
          </div>
        )}

        {/* TAB 1: EVENTS VIEW (AUDIT ACTIVITY LOG) */}
        {activeTab === 'events' && (
          <div>
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Organized real-time overview of actions taken by Question Setters and Supreme Admins (Admin Sr.).
              </p>
            </div>
            <EventsAuditView embeddedInAdmin={false} />
          </div>
        )}

        {/* TAB 2: TESTS & SECTIONS / QUESTION ATTRIBUTION VIEW */}
        {activeTab === 'tests' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            <div className="card">
              <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-xs)' }}>
                Test Structure &amp; Question Attribution (Read-Only)
              </h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
                Inspect which sections and questions are registered for each examination, along with verified author attributions.
              </p>

              <div className="form-group" style={{ maxWidth: 450, margin: 0 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Select Examination:</label>
                <select
                  value={selectedTestId}
                  onChange={e => setSelectedTestId(e.target.value)}
                  className="input"
                >
                  <option value="">-- Choose a test --</option>
                  {tests.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.title} ({t.sections ? t.sections.length : 0} sections)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loadingTests && <p>Loading test details...</p>}

            {activeTest && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                {/* Test Meta Header */}
                <div
                  className="card"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-light)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 'var(--space-md)',
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--white)' }}>
                      {activeTest.title}
                    </h3>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      Total Sections: <strong>{activeTest.sections.length}</strong> · Total Questions:{' '}
                      <strong>
                        {activeTest.sections.reduce((acc, s) => acc + (s.questions ? s.questions.length : 0), 0)}
                      </strong>
                    </div>
                  </div>
                  <span className="badge badge-gray">Read-Only View</span>
                </div>

                {/* Sections List */}
                {activeTest.sections.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <p style={{ color: 'var(--text-muted)' }}>No sections have been added to this test yet.</p>
                  </div>
                ) : (
                  activeTest.sections.map((section, sIdx) => {
                    const qList = section.questions || [];
                    return (
                      <div
                        key={section.id || sIdx}
                        className="card"
                        style={{
                          border: '1px solid var(--border-light)',
                          background: 'var(--bg-card)',
                        }}
                      >
                        {/* Section Header */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 'var(--space-lg)',
                            paddingBottom: 'var(--space-sm)',
                            borderBottom: '1px solid var(--border)',
                            flexWrap: 'wrap',
                            gap: 'var(--space-sm)',
                          }}
                        >
                          <div>
                            <span
                              style={{
                                fontSize: '0.75rem',
                                color: 'var(--accent-green-light)',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                              }}
                            >
                              Section #{sIdx + 1}
                            </span>
                            <h3 style={{ margin: '2px 0 0', fontSize: '1.125rem' }}>
                              {section.name}
                            </h3>
                          </div>
                          <div className="flex items-center gap-sm">
                            <span className="badge badge-gray">
                              {Math.round((section.timeLimit || 0) / 60)} mins
                            </span>
                            <span className="badge badge-gray">
                              {qList.length} {qList.length === 1 ? 'question' : 'questions'}
                            </span>
                          </div>
                        </div>

                        {/* Questions inside Section */}
                        {qList.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            No questions added in this section.
                          </p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                            {qList.map((q, qIdx) => (
                              <div
                                key={q.id || qIdx}
                                style={{
                                  padding: 'var(--space-md)',
                                  background: 'var(--bg-primary)',
                                  borderRadius: 'var(--radius-sm)',
                                  border: '1px solid var(--border)',
                                }}
                              >
                                {/* Top question info */}
                                <div
                                  className="flex justify-between items-center"
                                  style={{ marginBottom: 'var(--space-sm)' }}
                                >
                                  <div className="flex items-center gap-sm">
                                    <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>
                                      Q{qIdx + 1}
                                    </span>
                                    <span
                                      style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.8125rem',
                                        color: 'var(--accent-amber-light)',
                                        fontWeight: 600,
                                      }}
                                    >
                                      #{q.tag}
                                    </span>
                                    <span className="badge badge-gray" style={{ textTransform: 'uppercase', fontSize: '0.6875rem' }}>
                                      {q.type}
                                    </span>
                                  </div>
                                  {q.timeLimit ? (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                      Timer: {q.timeLimit}s
                                    </span>
                                  ) : null}
                                </div>

                                {/* Question Text */}
                                <p
                                  style={{
                                    fontSize: '0.9375rem',
                                    color: 'var(--text-primary)',
                                    marginBottom: 'var(--space-sm)',
                                    lineHeight: 1.6,
                                  }}
                                >
                                  {q.text}
                                </p>

                                {/* MCQ Options if applicable */}
                                {q.type === 'mcq' && q.options && q.options.length > 0 && (
                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                      gap: 8,
                                      marginBottom: 'var(--space-md)',
                                    }}
                                  >
                                    {q.options.map((opt, optIdx) => (
                                      <div
                                        key={optIdx}
                                        style={{
                                          padding: '6px 12px',
                                          background: 'var(--bg-card)',
                                          borderRadius: 'var(--radius-sm)',
                                          fontSize: '0.8125rem',
                                          border: '1px solid var(--border)',
                                          color: 'var(--text-secondary)',
                                        }}
                                      >
                                        <strong style={{ color: 'var(--text-muted)', marginRight: 6 }}>
                                          {String.fromCharCode(65 + optIdx)}.
                                        </strong>
                                        {opt}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* QUESTION ATTRIBUTION MARK */}
                                <div
                                  style={{
                                    marginTop: 'var(--space-sm)',
                                    padding: '8px 12px',
                                    background: 'var(--bg-secondary)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px dashed var(--border-light)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: 8,
                                    fontSize: '0.8125rem',
                                  }}
                                >
                                  <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Added by:</span>
                                    <span style={{ fontWeight: 600, color: 'var(--white)' }}>
                                      {q.authorName || q.authorEmail?.split('@')[0] || 'Admin Sr. / Question Setter (Legacy)'}
                                    </span>
                                    {q.authorRole && (
                                      <span
                                        className={
                                          q.authorRole.includes('Admin Sr.')
                                            ? 'badge badge-red'
                                            : 'badge badge-green'
                                        }
                                        style={{ fontSize: '0.6875rem' }}
                                      >
                                        {q.authorRole}
                                      </span>
                                    )}
                                    {q.authorEmail && (
                                      <span
                                        style={{
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: '0.75rem',
                                          color: 'var(--text-muted)',
                                        }}
                                      >
                                        ({q.authorEmail})
                                      </span>
                                    )}
                                  </div>

                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    {q.createdAt && (
                                      <span>
                                        Created: {new Date(q.createdAt).toLocaleDateString()}
                                      </span>
                                    )}
                                    {q.lastEditedBy && (
                                      <span style={{ marginLeft: 8 }}>
                                        · Edited by: <em>{q.lastEditedBy}</em>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SPECTATOR VIEW */}
        {activeTab === 'spectator' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            <div className="card">
              <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-xs)' }}>
                Spectator Examination Overview
              </h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
                Real-time leaderboard, candidate evaluations, interviewer mode, and AI proctoring flag inspection.
              </p>

              <div className="form-group" style={{ maxWidth: 450, margin: 0 }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Select Examination:</label>
                <select
                  value={spectatorTestId}
                  onChange={e => setSpectatorTestId(e.target.value)}
                  className="input"
                >
                  <option value="">-- Choose a test --</option>
                  {spectatorTests.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {spectatorTestId && !loadingLeaderboard && !resultsDeclared && (
              <div className="alert alert-info">
                Results have not been declared yet for this examination.
              </div>
            )}

            {loadingLeaderboard && <p>Loading examination scores &amp; proctoring insights...</p>}

            {resultsDeclared && leaderboard.length > 0 && (
              <div className="card">
                <div
                  className="flex justify-between items-center"
                  style={{ marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-md)' }}
                >
                  <div className="flex items-center gap-md" style={{ flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: '1.25rem', margin: 0 }}>Leaderboard</h3>
                    <button
                      className={`btn btn-sm ${isInterviewerMode ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setIsInterviewerMode(!isInterviewerMode)}
                    >
                      {isInterviewerMode ? 'Interviewer Mode: ON' : 'Interviewer Mode: OFF'}
                    </button>
                  </div>

                  <div className="flex items-center gap-md" style={{ flexWrap: 'wrap', width: '100%' }}>
                    {isInterviewerMode && (
                      <input
                        type="text"
                        className="input"
                        placeholder="Search candidate name or email..."
                        value={spectatorSearch}
                        onChange={e => setSpectatorSearch(e.target.value)}
                        style={{ flex: 1, minWidth: '220px' }}
                      />
                    )}
                    <ExcelExport data={filteredLeaderboard as any} filename={`leaderboard_${spectatorTestId}.xlsx`} />
                  </div>
                </div>

                {isInterviewerMode && (
                  <div className="alert alert-info" style={{ marginBottom: 'var(--space-md)' }}>
                    <strong>Interviewer Mode Active:</strong> Showing only Qualified and Waitlisted candidates. Click &ldquo;Details&rdquo; to view the AI review and proctoring flags.
                  </div>
                )}

                <LeaderboardTable entries={filteredLeaderboard} />
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PARTICIPANTS SECTION (JUST VIEW) */}
        {activeTab === 'participants' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            <div className="card">
              <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
                    Examinees &amp; Participants Directory
                  </h2>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Read-only view of enrolled candidates and their assigned test enrollments.
                  </p>
                </div>
                <span className="badge badge-gray">Read-Only Mode</span>
              </div>

              {/* Filters */}
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-md)',
                  flexWrap: 'wrap',
                  marginTop: 'var(--space-lg)',
                }}
              >
                <div style={{ flex: 1, minWidth: 240 }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Search candidate by name or email..."
                    value={participantSearch}
                    onChange={e => setParticipantSearch(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ minWidth: 200 }}>
                  <select
                    className="input"
                    value={participantTestFilter}
                    onChange={e => setParticipantTestFilter(e.target.value)}
                  >
                    <option value="">All Tests</option>
                    {spectatorTests.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Participants Table */}
            <div className="card">
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem' }}>Candidates List</h3>
                <span className="badge badge-gray">
                  {filteredParticipants.length} of {participants.length} Candidates
                </span>
              </div>

              {loadingParticipants ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                  <div className="spinner" style={{ margin: '0 auto var(--space-md)' }} />
                  <p style={{ color: 'var(--text-muted)' }}>Loading participants list...</p>
                </div>
              ) : filteredParticipants.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No participants found matching criteria.</p>
              ) : (
                <>
                  <div className="table-responsive desktop-only">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Candidate Name</th>
                          <th>Email</th>
                          <th>Permission Status</th>
                          <th>Enrolled Examinations</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredParticipants.map(cand => {
                          const enrolledTestIds = cand.tests ? Object.keys(cand.tests) : [];
                          return (
                            <tr key={cand.email}>
                              <td style={{ fontWeight: 600 }}>{cand.name || '—'}</td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                                {cand.email}
                              </td>
                              <td>
                                {cand.allowed ? (
                                  <span className="badge badge-green">Allowed</span>
                                ) : (
                                  <span className="badge badge-red">Blocked</span>
                                )}
                              </td>
                              <td>
                                {enrolledTestIds.length === 0 ? (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>None</span>
                                ) : (
                                  <div className="flex gap-xs" style={{ flexWrap: 'wrap' }}>
                                    {enrolledTestIds.map(tid => {
                                      const match = spectatorTests.find(t => t.id === tid);
                                      return (
                                        <span key={tid} className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                                          {match?.title || tid}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View */}
                  <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filteredParticipants.map(cand => {
                      const enrolledTestIds = cand.tests ? Object.keys(cand.tests) : [];
                      return (
                        <div
                          key={cand.email}
                          style={{
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '12px 14px',
                          }}
                        >
                          <div className="flex justify-between items-start" style={{ gap: 8, marginBottom: 4 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                              {cand.name || 'Unnamed Candidate'}
                            </div>
                            <div>
                              {cand.allowed ? (
                                <span className="badge badge-green">Allowed</span>
                              ) : (
                                <span className="badge badge-red">Blocked</span>
                              )}
                            </div>
                          </div>
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.78125rem',
                              color: 'var(--text-secondary)',
                              wordBreak: 'break-all',
                              marginBottom: 8,
                            }}
                          >
                            {cand.email}
                          </div>
                          <div>
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginRight: 6 }}>
                              Tests:
                            </span>
                            {enrolledTestIds.length === 0 ? (
                              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>None</span>
                            ) : (
                              <div className="flex gap-xs" style={{ flexWrap: 'wrap', marginTop: 4 }}>
                                {enrolledTestIds.map(tid => {
                                  const match = spectatorTests.find(t => t.id === tid);
                                  return (
                                    <span key={tid} className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                                      {match?.title || tid}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function AdminL1Page() {
  return (
    <RoleGuard requiredRole="Admin L1">
      <AdminL1Content />
    </RoleGuard>
  );
}
