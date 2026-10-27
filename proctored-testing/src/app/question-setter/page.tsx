'use client';

import { useState, useEffect, useCallback } from 'react';
import { rtdb, auth } from '@/lib/firebase';
import { ref, get, update, set, remove } from 'firebase/database';
import RoleGuard from '@/components/RoleGuard';
import { Question } from '@/components/QuestionPanel';
import { generateQuestionTag } from '@/lib/adminUtils';
import { logAuditEvent } from '@/lib/auditLogger';
import Link from 'next/link';
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
  status: string;
}

// Arrays helper
const toArr = <T,>(v: unknown): T[] => {
  if (!v) return [];
  if (Array.isArray(v)) return (v as T[]).filter(Boolean);
  if (typeof v === 'object') return Object.values(v as Record<string, T>).filter(Boolean);
  return [];
};

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
  const [editQId, setEditQId] = useState<string | null>(null);

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

    const parsed: TestDraft[] = Object.keys(val).map(key => {
      const t = val[key];
      const sections: Section[] = toArr<Section>(t.sections).map((s: Section) => ({
        ...s,
        questions: toArr<Question>(s.questions),
      }));
      return { id: key, ...t, sections };
    });
    setTests(parsed);
    if (!selectedTestId && parsed.length > 0) {
      setSelectedTestId(parsed[0].id);
    }
  }, [selectedTestId]);

  useEffect(() => { fetchTests(); }, [fetchTests]);

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 4000);
  };

  const selectedTest = tests.find(t => t.id === selectedTestId) || null;
  const isTestClosed = selectedTest?.status === 'closed' || selectedTest?.status === 'stopped' || selectedTest?.status === 'ended';

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
    
    const actorName = auth.currentUser?.displayName || (userEmail ? userEmail.split('@')[0] : 'Question Setter');
    await logAuditEvent({
      actorEmail: userEmail,
      actorName,
      actorRole: 'Question Setter',
      action: 'ADD_SECTION',
      actionLabel: 'Added Section',
      targetTitle: sectionName.trim(),
      details: {
        testId: selectedTestId,
        testTitle: test.title,
        sectionName: sectionName.trim(),
      },
    });

    setSectionName('');
    await fetchTests();
    setLoading(false);
    flash(`Section "${newSection.name}" created.`);
  };

  // ── ADD QUESTION ────────────────────────────────────────────────────────────
  const addQuestion = async () => {
    if (!selectedTestId || !qText.trim() || !qSectionId) return;
    setLoading(true);
    const test = tests.find(t => t.id === selectedTestId)!;
    const sIndex = test.sections.findIndex(s => s.id === qSectionId);
    if (sIndex === -1) {
      setLoading(false);
      return;
    }

    const qSnap = await get(ref(rtdb, `tests/${selectedTestId}/sections/${sIndex}/questions`));
    const currentQuestions: Question[] = toArr<Question>(qSnap.val());

    const generatedTag = generateQuestionTag();
    const actorName = auth.currentUser?.displayName || (userEmail ? userEmail.split('@')[0] : 'Question Setter');

    const newQ: Question = {
      id: `q_${Date.now()}`,
      text: qText.trim(),
      type: qType,
      tag: generatedTag,
      authorEmail: userEmail,
      authorName: actorName,
      authorRole: 'Question Setter',
      createdAt: new Date().toISOString(),
    };

    if (qType === 'mcq') {
      newQ.options = qOptions.filter(Boolean);
    }
    if (qTimeLimit) {
      newQ.timeLimit = qTimeLimit;
    }

    const updatedQuestions = [...currentQuestions, newQ];
    await set(ref(rtdb, `tests/${selectedTestId}/sections/${sIndex}/questions`), updatedQuestions);

    await logAuditEvent({
      actorEmail: userEmail,
      actorName,
      actorRole: 'Question Setter',
      action: 'ADD_QUESTION',
      actionLabel: 'Added Question',
      targetTitle: `Question #${generatedTag}`,
      details: {
        testId: selectedTestId,
        testTitle: test.title,
        sectionName: test.sections[sIndex]?.name,
        questionTag: generatedTag,
        questionSnippet: qText.trim().slice(0, 100),
      },
    });

    setQText(''); setQOptions(['', '', '', '']); setQTimeLimit(0);
    await fetchTests();
    setLoading(false);
    flash(`Question #${generatedTag} submitted.`);
  };

  // ── EDIT QUESTION ───────────────────────────────────────────────────────────
  const handleEditClick = (testId: string, sectionId: string, q: Question) => {
    setEditQId(q.id);
    setQSectionId(sectionId);
    setQText(q.text);
    setQType(q.type);
    setQOptions(q.options ? [...q.options] : ['', '', '', '']);
    setQTimeLimit(q.timeLimit || 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveEditedQuestion = async () => {
    if (!selectedTestId || !editQId || !qText.trim() || !qSectionId) return;
    setLoading(true);
    const test = tests.find(t => t.id === selectedTestId)!;
    const sIndex = test.sections.findIndex(s => s.id === qSectionId);
    
    const qSnap = await get(ref(rtdb, `tests/${selectedTestId}/sections/${sIndex}/questions`));
    const currentQuestions: Question[] = toArr<Question>(qSnap.val());
    const oldQ = currentQuestions.find(q => q.id === editQId) || test.sections[sIndex]?.questions.find(q => q.id === editQId);
    if (!oldQ) {
      setLoading(false);
      return;
    }

    const actorName = auth.currentUser?.displayName || (userEmail ? userEmail.split('@')[0] : 'Question Setter');
    const updatedQ: Question = {
      ...oldQ,
      text: qText.trim(),
      type: qType,
      options: qType === 'mcq' ? qOptions.filter(Boolean) : undefined,
      timeLimit: qTimeLimit || undefined,
      lastEditedBy: actorName,
      lastEditedAt: new Date().toISOString(),
    };

    const updatedQuestions = currentQuestions.map(q => q.id === editQId ? updatedQ : q);
    await set(ref(rtdb, `tests/${selectedTestId}/sections/${sIndex}/questions`), updatedQuestions);

    await logAuditEvent({
      actorEmail: userEmail,
      actorName,
      actorRole: 'Question Setter',
      action: 'EDIT_QUESTION',
      actionLabel: 'Edited Question',
      targetTitle: `Question #${oldQ.tag}`,
      details: {
        testId: selectedTestId,
        testTitle: test.title,
        sectionName: test.sections[sIndex]?.name,
        questionTag: oldQ.tag,
        questionSnippet: qText.trim().slice(0, 100),
      },
    });

    setQText(''); setQOptions(['', '', '', '']); setQTimeLimit(0); setEditQId(null);
    await fetchTests();
    setLoading(false);
    flash(`Question updated.`);
  };

  // ── DELETE QUESTION ─────────────────────────────────────────────────────────
  const deleteQuestion = async (testId: string, sectionId: string, questionId: string) => {
    if (!confirm('Are you sure you want to delete this question?')) return;
    setLoading(true);
    const test = tests.find(t => t.id === testId)!;
    const sIndex = test.sections.findIndex(s => s.id === sectionId);
    const qSnap = await get(ref(rtdb, `tests/${testId}/sections/${sIndex}/questions`));
    const currentQuestions: Question[] = toArr<Question>(qSnap.val());
    const qToDelete = currentQuestions.find(q => q.id === questionId) || test.sections[sIndex]?.questions.find(q => q.id === questionId);
    const updatedQuestions = currentQuestions.filter(q => q.id !== questionId);
    
    await set(ref(rtdb, `tests/${testId}/sections/${sIndex}/questions`), updatedQuestions);
    
    const actorName = auth.currentUser?.displayName || (userEmail ? userEmail.split('@')[0] : 'Question Setter');
    await logAuditEvent({
      actorEmail: userEmail,
      actorName,
      actorRole: 'Question Setter',
      action: 'DELETE_QUESTION',
      actionLabel: 'Deleted Question',
      targetTitle: `Question #${qToDelete?.tag || questionId}`,
      details: {
        testId,
        testTitle: test.title,
        sectionName: test.sections[sIndex]?.name,
        questionTag: qToDelete?.tag,
      },
    });

    await fetchTests();
    setLoading(false);
    flash('Question deleted.');
  };

  // ── SUBMIT SOLUTIONS ────────────────────────────────────────────────────────
  const submitSolutions = async () => {
    if (!selectedTestId) return;
    
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
      const ansRef = ref(rtdb, `answerKeys/${selectedTestId}`);
      const snap = await get(ansRef);
      const existing = snap.val() || {};
      
      const newKey = { ...existing, ...solutions };
      await update(ref(rtdb, 'answerKeys'), { [selectedTestId]: newKey });

      const actorName = auth.currentUser?.displayName || (userEmail ? userEmail.split('@')[0] : 'Question Setter');
      await logAuditEvent({
        actorEmail: userEmail,
        actorName,
        actorRole: 'Question Setter',
        action: 'SUBMIT_SOLUTIONS',
        actionLabel: 'Submitted Solutions',
        targetTitle: test.title,
        details: {
          testId: selectedTestId,
          testTitle: test.title,
          count: Object.keys(solutions).length,
        },
      });

      flash('Solutions successfully submitted.');
    } catch (e: any) {
      alert(`Error submitting solutions: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Load existing solutions when test is closed
  useEffect(() => {
    if (selectedTestId && isTestClosed) {
      get(ref(rtdb, `answerKeys/${selectedTestId}`)).then(snap => {
        if (snap.val()) {
          setSolutions(snap.val());
        }
      });
    }
  }, [selectedTestId, isTestClosed]);

  return (
    <main style={{ minHeight: '100vh', padding: '16px 0 var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: 1200 }}>
        {/* Header Bar */}
        <div
          className="flex justify-between items-center"
          style={{ marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 10 }}
        >
          <div className="flex items-center gap-md">
            <div>
              <h1 style={{ fontSize: '1.375rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
                Question Setter Dashboard
              </h1>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                {userEmail}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-sm">
            <Link
              href="/tcc"
              className="btn btn-sm"
              style={{
                background: 'rgba(45, 106, 79, 0.25)',
                color: '#52b788',
                border: '1px solid rgba(45, 106, 79, 0.55)',
                fontSize: '0.75rem',
                padding: '4px 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <MessageSquareQuote size={14} />
              <span>Team Coordination Corner (TCC)</span>
            </Link>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => auth.signOut()}
            >
              Sign Out
            </button>
          </div>
        </div>
        
        {msg && <div className="alert alert-success" style={{ marginBottom: 'var(--space-md)' }}>{msg}</div>}

        {/* Test Selector Strip */}
        <div className="card" style={{ marginBottom: 'var(--space-lg)', padding: '14px 16px' }}>
          <div className="flex justify-between items-center" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Select Active Test
            </span>
          </div>

          {tests.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>No tests available.</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {tests.map(t => {
                const isSelected = selectedTestId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTestId(t.id)}
                    style={{
                      padding: '8px 14px',
                      background: isSelected ? 'rgba(255,255,255,0.08)' : 'var(--bg-input)',
                      border: `1px solid ${isSelected ? 'var(--border-focus)' : 'var(--border)'}`,
                      borderLeft: isSelected ? '3px solid var(--accent-green-light)' : '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <span style={{ fontWeight: isSelected ? 700 : 500, fontSize: '0.875rem', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {t.title}
                    </span>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Status: {t.status}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Main Work Area */}
        {selectedTest && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            {!isTestClosed ? (
              <>
                {/* Add Section (Compact) */}
                <div className="card">
                  <h3 style={{ marginBottom: 'var(--space-md)', fontSize: '1.05rem' }}>Add New Section</h3>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <input
                      value={sectionName}
                      onChange={e => setSectionName(e.target.value)}
                      placeholder="e.g. Propulsion / Aptitude"
                      style={{ flex: '1 1 200px' }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={addSection}
                      disabled={loading || !sectionName.trim()}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      Create Section
                    </button>
                  </div>
                </div>

                {/* Submit / Edit Question */}
                {selectedTest.sections.length > 0 && (
                  <div className="card">
                    <h3 style={{ marginBottom: 'var(--space-md)', fontSize: '1.05rem' }}>
                      {editQId ? 'Edit Question' : 'Submit New Question'}
                    </h3>

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
                      <textarea
                        value={qText}
                        onChange={e => setQText(e.target.value)}
                        rows={3}
                        placeholder="Enter full question statement..."
                      />
                    </div>

                    {qType === 'mcq' && (
                      <div className="form-group">
                        <label>Options (A, B, C, D)</label>
                        {qOptions.map((opt, i) => (
                          <div key={i} className="flex gap-sm" style={{ marginBottom: 8, alignItems: 'center' }}>
                            <span
                              style={{
                                width: 26,
                                height: 26,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-xs)',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--text-muted)',
                                flexShrink: 0,
                              }}
                            >
                              {String.fromCharCode(65 + i)}
                            </span>
                            <input
                              value={opt}
                              onChange={e => { const o = [...qOptions]; o[i] = e.target.value; setQOptions(o); }}
                              placeholder={`Option ${String.fromCharCode(65 + i)}`}
                              style={{ flex: 1 }}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-sm" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                      {editQId ? (
                        <>
                          <button
                            className="btn btn-primary"
                            onClick={saveEditedQuestion}
                            disabled={loading || !qText.trim() || !qSectionId}
                            style={{ flex: '1 1 140px' }}
                          >
                            Update Question
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => { setEditQId(null); setQText(''); setQOptions(['', '', '', '']); setQTimeLimit(0); }}
                            disabled={loading}
                          >
                            Cancel Edit
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-primary"
                          onClick={addQuestion}
                          disabled={loading || !qText.trim() || !qSectionId}
                          style={{ flex: '1 1 140px' }}
                        >
                          Submit Question
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* My Questions List */}
                <div className="card">
                  <h3 style={{ marginBottom: 'var(--space-md)', fontSize: '1.05rem' }}>My Authored Questions</h3>
                  {selectedTest.sections.every(sec => sec.questions.filter(q => q.authorEmail === userEmail).length === 0) ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>You have not submitted any questions for this test yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {selectedTest.sections.map(sec => {
                        const myQs = sec.questions.filter(q => q.authorEmail === userEmail);
                        if (myQs.length === 0) return null;
                        return (
                          <div key={sec.id}>
                            <div className="flex items-center gap-sm" style={{ marginBottom: 8 }}>
                              <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                                {sec.name}
                              </span>
                              <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                                {myQs.length} {myQs.length === 1 ? 'question' : 'questions'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {myQs.map((q, qi) => (
                                <div
                                  key={q.id}
                                  style={{
                                    padding: '12px 14px',
                                    background: 'var(--bg-input)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-sm)',
                                  }}
                                >
                                  <div className="flex justify-between items-start" style={{ gap: 8, marginBottom: 8 }}>
                                    <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
                                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                                        #{qi + 1}
                                      </span>
                                      <span
                                        style={{
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: '0.75rem',
                                          color: 'var(--text-muted)',
                                          background: 'rgba(255,255,255,0.04)',
                                          padding: '1px 6px',
                                          borderRadius: 'var(--radius-xs)',
                                          border: '1px solid var(--border)',
                                        }}
                                      >
                                        #{q.tag}
                                      </span>
                                      <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                                        {q.type.toUpperCase()}
                                      </span>
                                    </div>

                                    <div className="flex gap-sm">
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                                        onClick={() => handleEditClick(selectedTest.id, sec.id, q)}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--accent-red-light)' }}
                                        onClick={() => deleteQuestion(selectedTest.id, sec.id, q.id)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>

                                  <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: q.options ? 8 : 0 }}>
                                    {q.text}
                                  </div>

                                  {q.type === 'mcq' && q.options && q.options.length > 0 && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6, marginTop: 6 }}>
                                      {q.options.map((opt, oi) => (
                                        <div
                                          key={oi}
                                          style={{
                                            fontSize: '0.75rem',
                                            padding: '4px 8px',
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid var(--border)',
                                            borderRadius: 'var(--radius-xs)',
                                            color: 'var(--text-secondary)',
                                          }}
                                        >
                                          <strong>{String.fromCharCode(65 + oi)}:</strong> {opt}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Solutions Upload for Ended Test */
              <div className="card">
                <h3 style={{ marginBottom: 'var(--space-md)', fontSize: '1.05rem' }}>Upload Solutions</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
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
                              {q.text} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(Tag: #{q.tag})</span>
                              {hasAns && <span className="badge badge-green" style={{ marginLeft: 8, fontSize: '0.6875rem' }}>Solution Saved</span>}
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
                
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: 12 }}
                  onClick={submitSolutions}
                  disabled={loading}
                >
                  {loading ? 'Submitting...' : 'Upload Solutions'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function QuestionSetterPage() {
  return <RoleGuard requiredRole="Question Setter"><QuestionSetterContent /></RoleGuard>;
}
