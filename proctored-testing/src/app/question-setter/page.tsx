'use client';

import { useState, useEffect, useCallback } from 'react';
import { rtdb, auth } from '@/lib/firebase';
import { ref, get, update, set, remove } from 'firebase/database';
import RoleGuard from '@/components/RoleGuard';
import { Question } from '@/components/QuestionPanel';
import { generateQuestionTag } from '@/lib/adminUtils';

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
  status: string;
}

function QuestionSetterContent() {
  const [tests, setTests] = useState<TestDraft[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  
  const [userEmail, setUserEmail] = useState<string>('');

  // New section form
  const [sectionName, setSectionName] = useState('');
  const [sectionTime, setSectionTime] = useState(1800);

  // New question form
  const [qText, setQText] = useState('');
  const [qType, setQType] = useState<'mcq' | 'short'>('mcq');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qSectionId, setQSectionId] = useState('');
  const [qTimeLimit, setQTimeLimit] = useState(0);

  // Upload solutions
  const [solutions, setSolutions] = useState<Record<string, string>>({}); // questionTag -> solution

  useEffect(() => {
    if (auth.currentUser?.email) {
      setUserEmail(auth.currentUser.email);
    }
  }, []);

  const fetchTests = useCallback(async () => {
    const snap = await get(ref(rtdb, 'tests'));
    const val = snap.val();
    if (!val) { setTests([]); return; }
    
    // Arrays helper
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
  }, []);

  useEffect(() => { fetchTests(); }, [fetchTests]);

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 4000);
  };

  const selectedTest = tests.find(t => t.id === selectedTestId) || null;
  const isTestClosed = selectedTest?.status === 'closed' || selectedTest?.status === 'stopped';

  // ── ADD SECTION ─────────────────────────────────────────────────────────────
  const addSection = async () => {
    if (!selectedTestId || !sectionName.trim()) return;
    const test = tests.find(t => t.id === selectedTestId)!;
    if (test.sections.some(s => s.name.toLowerCase() === sectionName.trim().toLowerCase())) {
      alert('A section with this name already exists.');
      return;
    }
    setLoading(true);
    const newSection: Section = {
      id: `s_${Date.now()}`,
      name: sectionName.trim(),
      timeLimit: sectionTime,
      questions: [],
    };
    const sectionsCount = test.sections ? test.sections.length : 0;
    await set(ref(rtdb, `tests/${selectedTestId}/sections/${sectionsCount}`), newSection);
    
    setSectionName('');
    await fetchTests();
    setLoading(false);
    flash(`Section added.`);
  };

  // ── ADD QUESTION ────────────────────────────────────────────────────────────
  const addQuestion = async () => {
    if (!selectedTestId || !qText.trim() || !qSectionId) return;
    setLoading(true);
    const test = tests.find(t => t.id === selectedTestId)!;
    
    // Generate unique tag avoiding collisions
    let newTag = generateQuestionTag();
    let collision = true;
    while (collision) {
      collision = test.sections.some(s => s.questions.some(q => q.tag === newTag));
      if (collision) newTag = generateQuestionTag();
    }
    
    const newQ: Question = {
      id: `q_${Date.now()}`,
      text: qText.trim(),
      type: qType,
      tag: newTag,
      authorEmail: userEmail, // mark ownership
    };
    if (qType === 'mcq') {
      newQ.options = qOptions.filter(Boolean);
    }
    if (qTimeLimit) {
      newQ.timeLimit = qTimeLimit;
    }
    const sIndex = test.sections.findIndex(s => s.id === qSectionId);
    const qCount = test.sections[sIndex].questions ? test.sections[sIndex].questions.length : 0;
    await set(ref(rtdb, `tests/${selectedTestId}/sections/${sIndex}/questions/${qCount}`), newQ);
    
    setQText(''); setQOptions(['', '', '', '']); setQTimeLimit(0);
    await fetchTests();
    setLoading(false);
    flash(`Question added with Tag: ${newTag}`);
  };

  // ── DELETE QUESTION ─────────────────────────────────────────────────────────
  const deleteQuestion = async (testId: string, sectionId: string, questionId: string) => {
    if (!confirm('Are you sure you want to delete this question?')) return;
    setLoading(true);
    const test = tests.find(t => t.id === testId)!;
    const sIndex = test.sections.findIndex(s => s.id === sectionId);
    const qIndex = test.sections[sIndex].questions.findIndex(q => q.id === questionId);
    await remove(ref(rtdb, `tests/${testId}/sections/${sIndex}/questions/${qIndex}`));
    
    await fetchTests();
    setLoading(false);
    flash('Question deleted.');
  };

  // ── SUBMIT SOLUTIONS ────────────────────────────────────────────────────────
  const submitSolutions = async () => {
    if (!selectedTestId) return;
    
    // Validate that all solutions provided are not empty
    const test = tests.find(t => t.id === selectedTestId)!;
    let hasEmpty = false;
    let missingTag = '';
    
    test.sections.forEach(sec => {
      sec.questions.forEach(q => {
        if (q.authorEmail === userEmail) {
          if (!solutions[q.tag] || solutions[q.tag].trim() === '') {
            hasEmpty = true;
            missingTag = q.tag;
          }
        }
      });
    });

    if (hasEmpty) {
      alert(`Please provide an answer for question tag: ${missingTag}`);
      return;
    }

    setLoading(true);
    try {
      // We merge our solutions into answerKeys/${selectedTestId}
      const ansRef = ref(rtdb, `answerKeys/${selectedTestId}`);
      const snap = await get(ansRef);
      const existing = snap.val() || {};
      
      const newKey = { ...existing, ...solutions };
      await update(ref(rtdb, 'answerKeys'), { [selectedTestId]: newKey });
      flash('Solutions submitted successfully.');
    } catch (e) {
      console.error(e);
      flash('Failed to submit solutions.');
    }
    setLoading(false);
  };

  // Pre-load solutions if we have them
  useEffect(() => {
    if (isTestClosed && selectedTestId) {
      get(ref(rtdb, `answerKeys/${selectedTestId}`)).then(snap => {
        if (snap.exists()) {
          setSolutions(snap.val());
        } else {
          setSolutions({});
        }
      });
    }
  }, [selectedTestId, isTestClosed]);

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        <h1 style={{ fontSize: '1.75rem', marginBottom: 'var(--space-xl)' }}>Question Setter Dashboard</h1>
        
        {msg && <div className="alert alert-success" style={{ marginBottom: 'var(--space-lg)' }}>{msg}</div>}

        <div className="grid-2" style={{ gap: 'var(--space-lg)', alignItems: 'start' }}>
          {/* ── Left: Select Test ────────────────────────────────── */}
          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Select Test</h3>
            {tests.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No tests available.</p>
            ) : (
              <div className="flex-col gap-sm">
                {tests.map(t => (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTestId(t.id)}
                    style={{
                      padding: '12px 16px',
                      background: selectedTestId === t.id ? 'rgba(255,255,255,0.06)' : 'var(--bg-input)',
                      border: `1px solid ${selectedTestId === t.id ? 'var(--border-light)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                    }}
                  >
                    <div className="font-bold">{t.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status: {t.status}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Right: Operations ──────────────────────── */}
          {selectedTest && (
            <div>
              {!isTestClosed ? (
                <>
                  {/* Add Section */}
                  <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
                    <h3 style={{ marginBottom: 'var(--space-md)' }}>Select/Create Section</h3>
                    <div className="form-group">
                      <label>New Section Name</label>
                      <input value={sectionName} onChange={e => setSectionName(e.target.value)} placeholder="e.g. Aptitude" />
                    </div>
                    <button className="btn btn-primary" onClick={addSection} disabled={loading || !sectionName.trim()}>
                      Create Section
                    </button>
                  </div>

                  {/* Add Question */}
                  {selectedTest.sections.length > 0 && (
                    <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
                      <h3 style={{ marginBottom: 'var(--space-md)' }}>Submit Question</h3>
                      <div className="form-group">
                        <label>Target Section</label>
                        <select value={qSectionId} onChange={e => setQSectionId(e.target.value)}>
                          <option value="">-- Select section --</option>
                          {selectedTest.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Question Type</label>
                        <select value={qType} onChange={e => setQType(e.target.value as 'mcq' | 'short')}>
                          <option value="mcq">Multiple Choice (MCQ)</option>
                          <option value="short">Short Answer</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Question Text</label>
                        <textarea value={qText} onChange={e => setQText(e.target.value)} rows={3} placeholder="Enter question..." />
                      </div>
                      {qType === 'mcq' && (
                        <div className="form-group">
                          <label>Options (A, B, C, D)</label>
                          {qOptions.map((opt, i) => (
                            <input
                              key={i}
                              value={opt}
                              onChange={e => { const o = [...qOptions]; o[i] = e.target.value; setQOptions(o); }}
                              placeholder={`Option ${String.fromCharCode(65 + i)}`}
                              style={{ marginBottom: 8 }}
                            />
                          ))}
                        </div>
                      )}
                      <button className="btn btn-primary" onClick={addQuestion} disabled={loading || !qText.trim() || !qSectionId}>
                        Add Question
                      </button>
                    </div>
                  )}

                  {/* My Questions */}
                  <div className="card">
                    <h3 style={{ marginBottom: 'var(--space-md)' }}>My Questions</h3>
                    {selectedTest.sections.map(sec => {
                      const myQs = sec.questions.filter(q => q.authorEmail === userEmail);
                      if (myQs.length === 0) return null;
                      return (
                        <div key={sec.id} style={{ marginBottom: 16 }}>
                          <h4 style={{ fontSize: '0.875rem', marginBottom: 8 }}>{sec.name}</h4>
                          {myQs.map((q, qi) => (
                            <div key={q.id} style={{ padding: '8px', background: 'var(--bg-input)', borderRadius: 4, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                              <div>
                                <span style={{ fontSize: '0.875rem' }}>{q.text.substring(0, 50)}...</span>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tag: {q.tag}</div>
                              </div>
                              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent-red-light)' }} onClick={() => deleteQuestion(selectedTest.id, sec.id, q.id)}>🗑 Delete</button>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="card">
                  <h3 style={{ marginBottom: 'var(--space-md)' }}>Upload Solutions</h3>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
                    This test has ended. Please provide the correct answers to the questions you authored.
                  </p>
                  
                  {selectedTest.sections.map(sec => {
                    const myQs = sec.questions.filter(q => q.authorEmail === userEmail);
                    if (myQs.length === 0) return null;
                    return (
                      <div key={sec.id} style={{ marginBottom: 16 }}>
                        <h4 style={{ fontSize: '0.875rem', marginBottom: 8, color: 'var(--text-primary)' }}>{sec.name}</h4>
                        {myQs.map(q => {
                          const hasAns = !!solutions[q.tag];
                          return (
                            <div key={q.id} style={{ padding: '12px', background: 'var(--bg-input)', borderRadius: 4, marginBottom: 8 }}>
                              <div style={{ fontSize: '0.875rem', marginBottom: 8 }}>
                                {q.text} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Tag: {q.tag})</span>
                                {hasAns && <span style={{ marginLeft: 8, color: 'var(--accent-green)' }}>✅ Solution Received</span>}
                              </div>
                              {q.type === 'mcq' ? (
                                <select 
                                  value={solutions[q.tag] || ''} 
                                  onChange={e => setSolutions(prev => ({ ...prev, [q.tag]: e.target.value }))}
                                  className="input"
                                >
                                  <option value="">-- Select correct option --</option>
                                  {(q.options || []).map((opt, i) => {
                                    const letter = String.fromCharCode(65 + i);
                                    return <option key={i} value={letter}>{letter}: {opt}</option>;
                                  })}
                                </select>
                              ) : (
                                <input 
                                  className="input" 
                                  placeholder="Enter short answer..." 
                                  value={solutions[q.tag] || ''}
                                  onChange={e => setSolutions(prev => ({ ...prev, [q.tag]: e.target.value }))}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  
                  <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={submitSolutions} disabled={loading}>
                    {loading ? 'Submitting...' : 'Upload Solutions'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function QuestionSetterPage() {
  return <RoleGuard requiredRole="Question Setter"><QuestionSetterContent /></RoleGuard>;
}
