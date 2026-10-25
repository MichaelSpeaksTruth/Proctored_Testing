'use client';

import { useState, useEffect, useCallback } from 'react';
import { auth, rtdb } from '@/lib/firebase';
import { ref, push, get, update, set } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';
import { Question } from '@/components/QuestionPanel';
import { logAuditEvent } from '@/lib/auditLogger';

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

// ─── Inline edit state types ─────────────────────────────────────────────────
type EditMode =
  | { kind: 'none' }
  | { kind: 'test'; testId: string; title: string }
  | { kind: 'section'; testId: string; sectionId: string; name: string; timeLimit: number }
  | { kind: 'question'; testId: string; sectionId: string; question: Question };

// ─── tiny helper ─────────────────────────────────────────────────────────────
const toArr = <T,>(v: unknown): T[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'object') return Object.values(v as Record<string, T>);
  return [];
};

// ─── Inline modal shell ───────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{
          width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
          border: '1px solid var(--border-light)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          animation: 'fadeIn 150ms ease',
        }}
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
          <h3 style={{ fontSize: '1.125rem', margin: 0 }}>{title}</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1 }}
          >✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Danger confirm button ────────────────────────────────────────────────────
function DeleteBtn({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="flex gap-sm" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--accent-red-light)' }}>Sure?</span>
        <button className="btn btn-danger btn-sm" disabled={disabled} onClick={() => { setConfirming(false); onConfirm(); }}>Yes, delete</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent-red-light)' }} disabled={disabled} onClick={() => setConfirming(true)}>
      🗑 {label}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
function SetupContent() {
  const [tests, setTests] = useState<TestDraft[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<'success' | 'error'>('success');

  // New section form
  const [sectionName, setSectionName] = useState('');
  const [sectionTime, setSectionTime] = useState(1800);

  // New question form
  const [qText, setQText] = useState('');
  const [qType, setQType] = useState<'mcq' | 'short'>('mcq');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qTag, setQTag] = useState('');
  const [qSectionId, setQSectionId] = useState('');
  const [qTimeLimit, setQTimeLimit] = useState(0);

  // Edit state
  const [editMode, setEditMode] = useState<EditMode>({ kind: 'none' });

  const flash = (text: string, kind: 'success' | 'error' = 'success') => {
    setMsg(text); setMsgKind(kind);
    setTimeout(() => setMsg(null), 4000);
  };

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
  }, []);

  useEffect(() => { fetchTests(); }, [fetchTests]);

  const selectedTest = tests.find(t => t.id === selectedTestId) || null;

  const getAdminActor = () => {
    const user = auth.currentUser;
    const actorEmail = user?.email || process.env.NEXT_PUBLIC_ADMIN_1 || 'admin@aerosoc';
    const actorName = `${user?.displayName || 'Admin'} (Admin Sr.)`;
    return { actorEmail, actorName, actorRole: 'Admin Sr.' as const };
  };

  // ── CREATE TEST ─────────────────────────────────────────────────────────────
  const createTest = async () => {
    if (!newTitle.trim()) return;
    if (tests.some(t => t.title.toLowerCase() === newTitle.trim().toLowerCase())) {
      flash('A test with this name already exists.', 'error');
      return;
    }
    setLoading(true);
    const newRef = push(ref(rtdb, 'tests'));
    await set(newRef, {
      title: newTitle.trim(),
      sections: [],
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const { actorEmail, actorName, actorRole } = getAdminActor();
    await logAuditEvent({
      actorEmail,
      actorName,
      actorRole,
      action: 'CREATE_TEST',
      actionLabel: 'Created Test',
      targetTitle: newTitle.trim(),
      details: { testId: newRef.key || undefined, testTitle: newTitle.trim() },
    });

    setNewTitle('');
    setSelectedTestId(newRef.key);
    await fetchTests();
    setLoading(false);
    flash('Test created.');
  };

  // ── DELETE TEST ─────────────────────────────────────────────────────────────
  const deleteTest = async (testId: string) => {
    setLoading(true);
    const testToDelete = tests.find(t => t.id === testId);
    
    // Clean up test references from all participants
    const pSnap = await get(ref(rtdb, 'participants'));
    const pVal = pSnap.val();
    if (pVal) {
      const updates: Record<string, any> = {};
      Object.keys(pVal).forEach(key => {
        if (pVal[key].tests && pVal[key].tests[testId]) {
          updates[`participants/${key}/tests/${testId}`] = null;
        }
      });
      if (Object.keys(updates).length > 0) {
        await update(ref(rtdb), updates);
      }
    }

    await set(ref(rtdb, `tests/${testId}`), null);

    const { actorEmail, actorName, actorRole } = getAdminActor();
    await logAuditEvent({
      actorEmail,
      actorName,
      actorRole,
      action: 'DELETE_TEST',
      actionLabel: 'Deleted Test',
      targetTitle: testToDelete?.title || testId,
      details: { testId, testTitle: testToDelete?.title },
    });

    if (selectedTestId === testId) setSelectedTestId(null);
    await fetchTests();
    setLoading(false);
    flash('Test deleted.');
  };

  // ── SAVE EDIT: TEST TITLE ───────────────────────────────────────────────────
  const saveTestEdit = async () => {
    if (editMode.kind !== 'test') return;
    if (!editMode.title.trim()) return;
    if (tests.some(t => t.id !== editMode.testId && t.title.toLowerCase() === editMode.title.trim().toLowerCase())) {
      flash('A test with this name already exists.', 'error');
      return;
    }
    setLoading(true);
    await update(ref(rtdb, `tests/${editMode.testId}`), { title: editMode.title.trim() });
    await fetchTests();
    setLoading(false);
    setEditMode({ kind: 'none' });
    flash('Test renamed.');
  };

  // ── ADD SECTION ─────────────────────────────────────────────────────────────
  const addSection = async () => {
    if (!selectedTestId || !sectionName.trim()) return;
    const test = tests.find(t => t.id === selectedTestId)!;
    if (test.sections.some(s => s.name.toLowerCase() === sectionName.trim().toLowerCase())) {
      flash('A section with this name already exists in this test.', 'error');
      return;
    }
    setLoading(true);
    const newSection: Section = {
      id: `s_${Date.now()}`,
      name: sectionName.trim(),
      timeLimit: sectionTime,
      questions: [],
    };
    await update(ref(rtdb, `tests/${selectedTestId}`), {
      sections: [...(test.sections || []), newSection],
    });

    const { actorEmail, actorName, actorRole } = getAdminActor();
    await logAuditEvent({
      actorEmail,
      actorName,
      actorRole,
      action: 'ADD_SECTION',
      actionLabel: 'Added Section',
      targetTitle: sectionName.trim(),
      details: { testId: selectedTestId, testTitle: test.title, sectionName: sectionName.trim() },
    });

    setSectionName('');
    await fetchTests();
    setLoading(false);
    flash(`Section "${newSection.name}" added.`);
  };

  // ── DELETE SECTION ──────────────────────────────────────────────────────────
  const deleteSection = async (testId: string, sectionId: string) => {
    setLoading(true);
    const test = tests.find(t => t.id === testId)!;
    const secToDelete = test.sections.find(s => s.id === sectionId);
    const updatedSections = test.sections.filter(s => s.id !== sectionId);
    await update(ref(rtdb, `tests/${testId}`), { sections: updatedSections });

    const { actorEmail, actorName, actorRole } = getAdminActor();
    await logAuditEvent({
      actorEmail,
      actorName,
      actorRole,
      action: 'DELETE_SECTION',
      actionLabel: 'Deleted Section',
      targetTitle: secToDelete?.name || sectionId,
      details: { testId, testTitle: test.title, sectionName: secToDelete?.name },
    });

    await fetchTests();
    setLoading(false);
    flash('Section deleted.');
  };

  // ── SAVE EDIT: SECTION ──────────────────────────────────────────────────────
  const saveSectionEdit = async () => {
    if (editMode.kind !== 'section') return;
    const test = tests.find(t => t.id === editMode.testId)!;
    if (test.sections.some(s => s.id !== editMode.sectionId && s.name.toLowerCase() === editMode.name.trim().toLowerCase())) {
      flash('A section with this name already exists in this test.', 'error');
      return;
    }
    setLoading(true);
    const updatedSections = test.sections.map(s =>
      s.id === editMode.sectionId
        ? { ...s, name: editMode.name.trim(), timeLimit: editMode.timeLimit }
        : s
    );
    await update(ref(rtdb, `tests/${editMode.testId}`), { sections: updatedSections });

    const { actorEmail, actorName, actorRole } = getAdminActor();
    await logAuditEvent({
      actorEmail,
      actorName,
      actorRole,
      action: 'UPDATE_SECTION',
      actionLabel: 'Updated Section',
      targetTitle: editMode.name.trim(),
      details: { testId: editMode.testId, testTitle: test.title, sectionName: editMode.name.trim() },
    });

    await fetchTests();
    setLoading(false);
    setEditMode({ kind: 'none' });
    flash('Section updated.');
  };

  // ── ADD QUESTION ────────────────────────────────────────────────────────────
  const addQuestion = async () => {
    if (!selectedTestId || !qText.trim() || !qSectionId || !qTag.trim()) return;
    setLoading(true);
    const test = tests.find(t => t.id === selectedTestId)!;
    const { actorEmail, actorName, actorRole } = getAdminActor();
    const newQ: Question = {
      id: `q_${Date.now()}`,
      text: qText.trim(),
      type: qType,
      tag: qTag.trim(),
      authorEmail: actorEmail,
      authorName: actorName,
      authorRole: 'Admin Sr.',
      createdAt: new Date().toISOString(),
    };
    if (qType === 'mcq') {
      newQ.options = qOptions.filter(Boolean);
    }
    if (qTimeLimit) {
      newQ.timeLimit = qTimeLimit;
    }
    const updatedSections = test.sections.map(s =>
      s.id === qSectionId ? { ...s, questions: [...s.questions, newQ] } : s
    );
    await update(ref(rtdb, `tests/${selectedTestId}`), { sections: updatedSections });

    await logAuditEvent({
      actorEmail,
      actorName,
      actorRole,
      action: 'ADD_QUESTION',
      actionLabel: 'Added Question',
      targetTitle: `Question #${qTag.trim()}`,
      details: {
        testId: selectedTestId,
        testTitle: test.title,
        sectionName: test.sections.find(s => s.id === qSectionId)?.name,
        questionTag: qTag.trim(),
        questionSnippet: qText.trim().slice(0, 100),
      },
    });

    setQText(''); setQTag(''); setQOptions(['', '', '', '']); setQTimeLimit(0);
    await fetchTests();
    setLoading(false);
    flash('Question added.');
  };

  // ── DELETE QUESTION ─────────────────────────────────────────────────────────
  const deleteQuestion = async (testId: string, sectionId: string, questionId: string) => {
    setLoading(true);
    const test = tests.find(t => t.id === testId)!;
    const qToDelete = test.sections.find(s => s.id === sectionId)?.questions.find(q => q.id === questionId);
    const updatedSections = test.sections.map(s =>
      s.id === sectionId
        ? { ...s, questions: s.questions.filter(q => q.id !== questionId) }
        : s
    );
    await update(ref(rtdb, `tests/${testId}`), { sections: updatedSections });

    const { actorEmail, actorName, actorRole } = getAdminActor();
    await logAuditEvent({
      actorEmail,
      actorName,
      actorRole,
      action: 'DELETE_QUESTION',
      actionLabel: 'Deleted Question',
      targetTitle: `Question #${qToDelete?.tag || questionId}`,
      details: {
        testId,
        testTitle: test.title,
        sectionName: test.sections.find(s => s.id === sectionId)?.name,
        questionTag: qToDelete?.tag,
      },
    });

    await fetchTests();
    setLoading(false);
    flash('Question deleted.');
  };

  // ── SAVE EDIT: QUESTION ─────────────────────────────────────────────────────
  const saveQuestionEdit = async () => {
    if (editMode.kind !== 'question') return;
    const q = editMode.question;
    if (!q.text.trim() || !q.tag.trim()) return;
    setLoading(true);
    const test = tests.find(t => t.id === editMode.testId)!;
    const { actorEmail, actorName, actorRole } = getAdminActor();
    const updatedSections = test.sections.map(s =>
      s.id === editMode.sectionId
        ? {
          ...s,
          questions: s.questions.map(existing =>
            existing.id === q.id
              ? {
                  ...q,
                  text: q.text.trim(),
                  tag: q.tag.trim(),
                  lastEditedBy: actorName,
                  lastEditedAt: new Date().toISOString(),
                }
              : existing
          ),
        }
        : s
    );
    await update(ref(rtdb, `tests/${editMode.testId}`), { sections: updatedSections });

    await logAuditEvent({
      actorEmail,
      actorName,
      actorRole,
      action: 'EDIT_QUESTION',
      actionLabel: 'Edited Question',
      targetTitle: `Question #${q.tag.trim()}`,
      details: {
        testId: editMode.testId,
        testTitle: test.title,
        sectionName: test.sections.find(s => s.id === editMode.sectionId)?.name,
        questionTag: q.tag.trim(),
        questionSnippet: q.text.trim().slice(0, 100),
      },
    });

    await fetchTests();
    setLoading(false);
    setEditMode({ kind: 'none' });
    flash('Question updated.');
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
          <Link href="/admin" className="btn btn-ghost btn-sm">← Back</Link>
          <h1 style={{ fontSize: '1.75rem' }}>Test Setup</h1>
        </div>

        {msg && (
          <div
            className={`alert alert-${msgKind === 'success' ? 'success' : 'info'}`}
            style={{ marginBottom: 'var(--space-lg)' }}
          >
            {msg}
          </div>
        )}

        <div className="grid-2" style={{ gap: 'var(--space-lg)', alignItems: 'start' }}>
          {/* ── Left: test list + create ────────────────────────────────── */}
          <div>
            <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
              <h3 style={{ marginBottom: 'var(--space-md)' }}>Create New Test</h3>
              <div className="form-group">
                <label htmlFor="test-title">Test Title</label>
                <input
                  id="test-title"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. AeroSoc Round 1"
                  onKeyDown={e => e.key === 'Enter' && createTest()}
                />
              </div>
              <button id="create-test-btn" className="btn btn-primary" onClick={createTest} disabled={loading || !newTitle.trim()}>
                Create Test
              </button>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 'var(--space-md)' }}>Existing Tests</h3>
              {tests.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No tests created yet.</p>
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
                      <div className="flex justify-between items-center">
                        <button
                          id={`select-test-${t.id}`}
                          onClick={() => setSelectedTestId(t.id)}
                          style={{
                            background: 'none', border: 'none',
                            color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
                            fontSize: '0.9375rem', cursor: 'pointer', textAlign: 'left',
                            fontWeight: 500, padding: 0, flex: 1,
                          }}
                        >
                          {t.title}
                        </button>
                        <div className="flex gap-sm" onClick={e => e.stopPropagation()}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setEditMode({ kind: 'test', testId: t.id, title: t.title })}
                            title="Rename test"
                          >✏️</button>
                          <DeleteBtn label="" onConfirm={() => deleteTest(t.id)} disabled={loading} />
                        </div>
                      </div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                        {t.sections.length} sections · {t.sections.reduce((a, s) => a + s.questions.length, 0)} questions
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: section + question builder ──────────────────────── */}
          {selectedTest && (
            <div>
              {/* Add Section */}
              <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
                <h3 style={{ marginBottom: 'var(--space-md)' }}>Add Section to "{selectedTest.title}"</h3>
                <div className="form-group">
                  <label htmlFor="section-name">Section Name</label>
                  <input id="section-name" value={sectionName} onChange={e => setSectionName(e.target.value)} placeholder="e.g. Aptitude" />
                </div>
                <div className="form-group">
                  <label htmlFor="section-time">Time Limit (seconds)</label>
                  <input id="section-time" type="number" value={sectionTime} onChange={e => setSectionTime(Number(e.target.value))} />
                </div>
                <button id="add-section-btn" className="btn btn-primary" onClick={addSection} disabled={loading || !sectionName.trim()}>
                  Add Section
                </button>
              </div>

              {/* Sections Preview with edit/delete */}
              {selectedTest.sections.length > 0 && (
                <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
                  <h3 style={{ marginBottom: 'var(--space-md)' }}>Sections &amp; Questions</h3>
                  {selectedTest.sections.map((sec, si) => (
                    <div
                      key={sec.id}
                      style={{
                        marginBottom: 'var(--space-md)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Section header */}
                      <div
                        className="flex justify-between items-center"
                        style={{
                          padding: '10px 14px',
                          background: 'rgba(255,255,255,0.04)',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <div className="flex items-center gap-sm">
                          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            §{si + 1}
                          </span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{sec.name}</span>
                          <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>
                            {sec.questions.length} Qs · {Math.floor(sec.timeLimit / 60)}m
                          </span>
                        </div>
                        <div className="flex gap-sm">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setEditMode({ kind: 'section', testId: selectedTestId!, sectionId: sec.id, name: sec.name, timeLimit: sec.timeLimit })}
                          >✏️ Edit</button>
                          <DeleteBtn label="Section" onConfirm={() => deleteSection(selectedTestId!, sec.id)} disabled={loading} />
                        </div>
                      </div>

                      {/* Questions list */}
                      <div style={{ padding: '10px 14px' }}>
                        {sec.questions.length === 0 ? (
                          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No questions yet.</p>
                        ) : (
                          sec.questions.map((q, qi) => (
                            <div
                              key={q.id}
                              style={{
                                display: 'flex', alignItems: 'flex-start', gap: 10,
                                padding: '8px 10px',
                                background: 'var(--bg-input)',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border)',
                                marginBottom: 6,
                                fontSize: '0.875rem',
                              }}
                            >
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }}>
                                Q{qi + 1}
                              </span>
                              <div style={{ flex: 1, color: 'var(--text-secondary)' }}>
                                {q.text.substring(0, 80)}{q.text.length > 80 ? '...' : ''}
                                {q.type === 'mcq' && q.options && (
                                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {q.options.map((opt, oi) => (
                                      <span
                                        key={oi}
                                        style={{
                                          fontSize: '0.75rem', padding: '2px 8px',
                                          background: 'rgba(255,255,255,0.06)',
                                          border: '1px solid var(--border)',
                                          borderRadius: 'var(--radius-sm)',
                                          color: 'var(--text-muted)',
                                        }}
                                      >
                                        {String.fromCharCode(65 + oi)}: {opt}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                  #{q.tag} · {q.type}{q.timeLimit ? ` · ${q.timeLimit}s` : ''}
                                </div>
                              </div>
                              <div className="flex gap-sm" style={{ flexShrink: 0 }}>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                                  onClick={() => setEditMode({ kind: 'question', testId: selectedTestId!, sectionId: sec.id, question: { ...q, options: q.options ? [...q.options] : ['', '', '', ''] } })}
                                >✏️</button>
                                <DeleteBtn label="" onConfirm={() => deleteQuestion(selectedTestId!, sec.id, q.id)} disabled={loading} />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Question */}
              {selectedTest.sections.length > 0 && (
                <div className="card">
                  <h3 style={{ marginBottom: 'var(--space-md)' }}>Add Question</h3>
                  <div className="form-group">
                    <label htmlFor="q-section">Target Section</label>
                    <select id="q-section" value={qSectionId} onChange={e => setQSectionId(e.target.value)}>
                      <option value="">-- Select section --</option>
                      {selectedTest.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="q-type">Question Type</label>
                    <select id="q-type" value={qType} onChange={e => setQType(e.target.value as 'mcq' | 'short')}>
                      <option value="mcq">Multiple Choice (MCQ)</option>
                      <option value="short">Short Answer</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="q-text">Question Text</label>
                    <textarea id="q-text" value={qText} onChange={e => setQText(e.target.value)} rows={3} placeholder="Enter question..." />
                  </div>
                  {qType === 'mcq' && (
                    <div className="form-group">
                      <label>Options (A, B, C, D)</label>
                      {qOptions.map((opt, i) => (
                        <input
                          key={i}
                          id={`q-option-${i}`}
                          value={opt}
                          onChange={e => { const o = [...qOptions]; o[i] = e.target.value; setQOptions(o); }}
                          placeholder={`Option ${String.fromCharCode(65 + i)}`}
                          style={{ marginBottom: 8 }}
                        />
                      ))}
                    </div>
                  )}
                  <div className="grid-2" style={{ gap: 'var(--space-md)' }}>
                    <div className="form-group">
                      <label htmlFor="q-tag">Question Tag</label>
                      <input id="q-tag" value={qTag} onChange={e => setQTag(e.target.value)} placeholder="e.g. apt_1" style={{ fontFamily: 'var(--font-mono)' }} />
                    </div>
                    <div className="form-group">
                      <label htmlFor="q-timelimit">Per-Question Timer (s, 0=none)</label>
                      <input id="q-timelimit" type="number" value={qTimeLimit} onChange={e => setQTimeLimit(Number(e.target.value))} />
                    </div>
                  </div>
                  <button
                    id="add-question-btn"
                    className="btn btn-primary"
                    onClick={addQuestion}
                    disabled={loading || !qText.trim() || !qSectionId || !qTag.trim()}
                  >
                    Add Question
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Edit Modals ──────────────────────────────────────────────────────── */}

      {/* Edit Test Title */}
      {editMode.kind === 'test' && (
        <Modal title="Rename Test" onClose={() => setEditMode({ kind: 'none' })}>
          <div className="form-group">
            <label htmlFor="edit-test-title">New Title</label>
            <input
              id="edit-test-title"
              value={editMode.title}
              onChange={e => setEditMode({ ...editMode, title: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && saveTestEdit()}
              autoFocus
            />
          </div>
          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setEditMode({ kind: 'none' })}>Cancel</button>
            <button className="btn btn-primary" onClick={saveTestEdit} disabled={loading || !editMode.title.trim()}>Save</button>
          </div>
        </Modal>
      )}

      {/* Edit Section */}
      {editMode.kind === 'section' && (
        <Modal title="Edit Section" onClose={() => setEditMode({ kind: 'none' })}>
          <div className="form-group">
            <label htmlFor="edit-section-name">Section Name</label>
            <input
              id="edit-section-name"
              value={editMode.name}
              onChange={e => setEditMode({ ...editMode, name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-section-time">Time Limit (seconds)</label>
            <input
              id="edit-section-time"
              type="number"
              value={editMode.timeLimit}
              onChange={e => setEditMode({ ...editMode, timeLimit: Number(e.target.value) })}
            />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              = {Math.floor(editMode.timeLimit / 60)}m {editMode.timeLimit % 60}s
            </span>
          </div>
          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setEditMode({ kind: 'none' })}>Cancel</button>
            <button className="btn btn-primary" onClick={saveSectionEdit} disabled={loading || !editMode.name.trim()}>Save</button>
          </div>
        </Modal>
      )}

      {/* Edit Question */}
      {editMode.kind === 'question' && (
        <Modal title="Edit Question" onClose={() => setEditMode({ kind: 'none' })}>
          <div className="form-group">
            <label htmlFor="edit-q-type">Question Type</label>
            <select
              id="edit-q-type"
              value={editMode.question.type}
              onChange={e => setEditMode({
                ...editMode,
                question: {
                  ...editMode.question,
                  type: e.target.value as 'mcq' | 'short',
                  options: e.target.value === 'mcq' ? (editMode.question.options || ['', '', '', '']) : undefined,
                },
              })}
            >
              <option value="mcq">Multiple Choice (MCQ)</option>
              <option value="short">Short Answer</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="edit-q-text">Question Text</label>
            <textarea
              id="edit-q-text"
              value={editMode.question.text}
              onChange={e => setEditMode({ ...editMode, question: { ...editMode.question, text: e.target.value } })}
              rows={4}
              autoFocus
            />
          </div>
          {editMode.question.type === 'mcq' && (
            <div className="form-group">
              <label>Options</label>
              {(editMode.question.options || ['', '', '', '']).map((opt, i) => (
                <div key={i} className="flex gap-sm" style={{ marginBottom: 8, alignItems: 'center' }}>
                  <span style={{
                    width: 28, height: 28, border: '1px solid var(--border-light)',
                    borderRadius: '50%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700,
                    color: 'var(--text-muted)', flexShrink: 0,
                  }}>{String.fromCharCode(65 + i)}</span>
                  <input
                    id={`edit-q-option-${i}`}
                    value={opt}
                    onChange={e => {
                      const opts = [...(editMode.question.options || ['', '', '', ''])];
                      opts[i] = e.target.value;
                      setEditMode({ ...editMode, question: { ...editMode.question, options: opts } });
                    }}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    style={{ flex: 1 }}
                  />
                  {(editMode.question.options || []).length > 2 && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--accent-red-light)', flexShrink: 0 }}
                      onClick={() => {
                        const opts = [...(editMode.question.options || [])];
                        opts.splice(i, 1);
                        setEditMode({ ...editMode, question: { ...editMode.question, options: opts } });
                      }}
                    >✕</button>
                  )}
                </div>
              ))}
              {(editMode.question.options || []).length < 6 && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 4 }}
                  onClick={() => {
                    const opts = [...(editMode.question.options || []), ''];
                    setEditMode({ ...editMode, question: { ...editMode.question, options: opts } });
                  }}
                >+ Add option</button>
              )}
            </div>
          )}
          <div className="grid-2" style={{ gap: 'var(--space-md)' }}>
            <div className="form-group">
              <label htmlFor="edit-q-tag">Tag</label>
              <input
                id="edit-q-tag"
                value={editMode.question.tag}
                onChange={e => setEditMode({ ...editMode, question: { ...editMode.question, tag: e.target.value } })}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="edit-q-timelimit">Timer (s, 0=none)</label>
              <input
                id="edit-q-timelimit"
                type="number"
                value={editMode.question.timeLimit || 0}
                onChange={e => setEditMode({ ...editMode, question: { ...editMode.question, timeLimit: Number(e.target.value) || undefined } })}
              />
            </div>
          </div>
          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setEditMode({ kind: 'none' })}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={saveQuestionEdit}
              disabled={loading || !editMode.question.text.trim() || !editMode.question.tag.trim()}
            >
              Save Changes
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

export default function SetupPage() {
  return <AdminGuard><SetupContent /></AdminGuard>;
}
