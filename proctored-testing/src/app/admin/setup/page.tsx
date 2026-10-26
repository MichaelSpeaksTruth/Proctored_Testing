'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { auth, rtdb } from '@/lib/firebase';
import { ref, push, get, update, set } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { Question } from '@/components/QuestionPanel';
import { logAuditEvent } from '@/lib/auditLogger';
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
  createdAt?: string;
}

// Inline edit state types
type EditMode =
  | { kind: 'none' }
  | { kind: 'test'; testId: string; title: string }
  | { kind: 'section'; testId: string; sectionId: string; name: string; timeLimit: number }
  | { kind: 'question'; testId: string; sectionId: string; question: Question };

// Array conversion helper
const toArr = <T,>(v: unknown): T[] => {
  if (!v) return [];
  if (Array.isArray(v)) return (v as T[]).filter(Boolean);
  if (typeof v === 'object') return Object.values(v as Record<string, T>).filter(Boolean);
  return [];
};

// Clean Modal shell
function Modal({ title, onClose, maxWidth = 560, children }: { title: string; onClose: () => void; maxWidth?: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth, maxHeight: '92vh', overflowY: 'auto',
          border: '1px solid var(--border-light)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.8)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
        }}
      >
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
          <h3 style={{ fontSize: '1.125rem', margin: 0, letterSpacing: '-0.01em' }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1, padding: 4,
            }}
          >&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Danger confirm button
function DeleteBtn({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="flex gap-sm" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--accent-red-light)', fontFamily: 'var(--font-mono)' }}>Confirm?</span>
        <button className="btn btn-danger btn-sm" disabled={disabled} onClick={() => { setConfirming(false); onConfirm(); }}>Yes, delete</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent-red-light)' }} disabled={disabled} onClick={() => setConfirming(true)}>
      Delete {label}
    </button>
  );
}

function SetupContent() {
  const [tests, setTests] = useState<TestDraft[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<'success' | 'error'>('success');

  // Modal display states
  const [isCreateTestOpen, setIsCreateTestOpen] = useState(false);
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [isAddQuestionOpen, setIsAddQuestionOpen] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>({ kind: 'none' });

  // Creation forms
  const [newTitle, setNewTitle] = useState('');
  const [sectionName, setSectionName] = useState('');
  const [sectionTime, setSectionTime] = useState(1800);

  // New question form
  const [qSectionId, setQSectionId] = useState('');
  const [qType, setQType] = useState<'mcq' | 'short'>('mcq');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qTag, setQTag] = useState('');
  const [qTimeLimit, setQTimeLimit] = useState(0);

  const flash = (text: string, kind: 'success' | 'error' = 'success') => {
    setMsg(text); setMsgKind(kind);
    setTimeout(() => setMsg(null), 4000);
  };

  const fetchTests = useCallback(async () => {
    const snap = await get(ref(rtdb, 'tests'));
    const val = snap.val();
    if (!val) {
      setTests([]);
      setSelectedTestId(null);
      return;
    }
    const parsed: TestDraft[] = Object.keys(val).map(key => {
      const t = val[key];
      const sections: Section[] = toArr<Section>(t.sections).map((s: Section) => ({
        ...s,
        questions: toArr<Question>(s.questions),
      }));
      return { id: key, ...t, sections };
    });
    setTests(parsed);

    // Auto-select first test if none currently selected
    setSelectedTestId(prev => {
      if (prev && parsed.some(t => t.id === prev)) return prev;
      return parsed.length > 0 ? parsed[0].id : null;
    });
  }, []);

  useEffect(() => { fetchTests(); }, [fetchTests]);

  const selectedTest = tests.find(t => t.id === selectedTestId) || null;

  // Sync active section if current selection is invalid
  useEffect(() => {
    if (!selectedTest) return;
    if (activeSectionId !== 'all' && !selectedTest.sections.some(s => s.id === activeSectionId)) {
      setActiveSectionId('all');
    }
  }, [selectedTest, activeSectionId]);

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
    setIsCreateTestOpen(false);
    setSelectedTestId(newRef.key);
    setActiveSectionId('all');
    await fetchTests();
    setLoading(false);
    flash('Test created successfully.');
  };

  // ── DELETE TEST ─────────────────────────────────────────────────────────────
  const deleteTest = async (testId: string) => {
    setLoading(true);
    const testToDelete = tests.find(t => t.id === testId);

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

    if (selectedTestId === testId) {
      setSelectedTestId(null);
      setActiveSectionId('all');
    }
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
    setIsAddSectionOpen(false);
    setActiveSectionId(newSection.id);
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

    if (activeSectionId === sectionId) {
      setActiveSectionId('all');
    }
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

  // ── OPEN ADD QUESTION MODAL ─────────────────────────────────────────────────
  const openAddQuestionModal = (defaultSectionId?: string) => {
    if (!selectedTest) return;
    const targetSec = defaultSectionId || (activeSectionId !== 'all' ? activeSectionId : selectedTest.sections[0]?.id || '');
    setQSectionId(targetSec);
    setQText('');
    setQType('mcq');
    setQOptions(['', '', '', '']);
    setQTag(generateQuestionTag());
    setQTimeLimit(0);
    setIsAddQuestionOpen(true);
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

    setIsAddQuestionOpen(false);
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
    const { actorName, actorEmail, actorRole } = getAdminActor();
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

  // ── COMPUTED QUESTION LIST FOR DISPLAY ──────────────────────────────────────
  interface DisplayQuestion extends Question {
    sectionId: string;
    sectionName: string;
    questionIndex: number;
  }

  const displayedQuestions = useMemo(() => {
    if (!selectedTest) return [];
    const list: DisplayQuestion[] = [];

    const sectionsToInclude = activeSectionId === 'all'
      ? selectedTest.sections
      : selectedTest.sections.filter(s => s.id === activeSectionId);

    sectionsToInclude.forEach(sec => {
      sec.questions.forEach((q, idx) => {
        list.push({
          ...q,
          sectionId: sec.id,
          sectionName: sec.name,
          questionIndex: idx + 1,
        });
      });
    });

    if (!searchQuery.trim()) return list;
    const qLower = searchQuery.toLowerCase().trim();
    return list.filter(item =>
      item.text.toLowerCase().includes(qLower) ||
      item.tag.toLowerCase().includes(qLower) ||
      (item.authorName && item.authorName.toLowerCase().includes(qLower)) ||
      (item.options && item.options.some(opt => opt.toLowerCase().includes(qLower)))
    );
  }, [selectedTest, activeSectionId, searchQuery]);

  const activeSection = selectedTest?.sections.find(s => s.id === activeSectionId);
  const totalQuestionsCount = selectedTest?.sections.reduce((acc, s) => acc + s.questions.length, 0) || 0;

  return (
    <main style={{ minHeight: '100vh', padding: '16px 0 var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: 1400, margin: '0 auto' }}>
        
        {/* Top Header Bar */}
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <div className="flex items-center gap-md">
            <BackButton fallbackUrl="/admin" />
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Test Setup</h1>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
                Admin Sr. curriculum and question bank controller
              </p>
            </div>
          </div>

          <div className="flex items-center gap-sm">
            <button
              id="open-create-test-btn"
              className="btn btn-primary"
              onClick={() => { setNewTitle(''); setIsCreateTestOpen(true); }}
            >
              + Create New Test
            </button>
          </div>
        </div>

        {/* Status Notification */}
        {msg && (
          <div
            className={`alert alert-${msgKind === 'success' ? 'success' : 'info'}`}
            style={{ marginBottom: 'var(--space-lg)' }}
          >
            {msg}
          </div>
        )}

        {/* ── Test Selector Ribbon ────────────────────────────────────── */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            marginBottom: 'var(--space-lg)',
          }}
        >
          <div className="flex justify-between items-center" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Select Active Test ({tests.length})
            </span>
          </div>

          {tests.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ margin: 0, fontSize: '0.9375rem' }}>No tests created yet. Click "+ Create New Test" to begin.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
              {tests.map(t => {
                const isSelected = selectedTestId === t.id;
                const qCount = t.sections.reduce((a, s) => a + s.questions.length, 0);
                return (
                  <div
                    key={t.id}
                    onClick={() => { setSelectedTestId(t.id); setActiveSectionId('all'); }}
                    id={`select-test-${t.id}`}
                    style={{
                      minWidth: 260,
                      maxWidth: 340,
                      flex: '0 0 auto',
                      padding: '14px 18px',
                      background: isSelected ? 'rgba(255,255,255,0.07)' : 'var(--bg-input)',
                      border: `1px solid ${isSelected ? 'var(--border-focus)' : 'var(--border)'}`,
                      borderLeft: isSelected ? '3px solid var(--accent-green-light)' : '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    <div className="flex justify-between items-start" style={{ gap: 8 }}>
                      <span style={{ fontWeight: isSelected ? 700 : 500, fontSize: '0.9375rem', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {t.title}
                      </span>
                      <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                        {t.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
                      {t.sections.length} sections &middot; {qCount} questions
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Active Test Canvas ──────────────────────────────────────── */}
        {selectedTest && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            
            {/* Active Test Banner */}
            <div
              style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '20px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 16,
              }}
            >
              <div>
                <div className="flex items-center gap-sm" style={{ marginBottom: 4 }}>
                  <h2 style={{ fontSize: '1.375rem', fontWeight: 700, margin: 0 }}>{selectedTest.title}</h2>
                  <span className="badge badge-green" style={{ fontSize: '0.75rem' }}>{selectedTest.status}</span>
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  Test ID: {selectedTest.id} &middot; Total Sections: {selectedTest.sections.length} &middot; Total Questions: {totalQuestionsCount}
                </div>
              </div>

              <div className="flex gap-sm" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditMode({ kind: 'test', testId: selectedTest.id, title: selectedTest.title })}
                >
                  Rename Test
                </button>
                <DeleteBtn label="Test" onConfirm={() => deleteTest(selectedTest.id)} disabled={loading} />
                <button
                  id="open-add-section-btn"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setSectionName(''); setSectionTime(1800); setIsAddSectionOpen(true); }}
                >
                  + Add Section
                </button>
                <button
                  id="open-add-question-btn"
                  className="btn btn-primary btn-sm"
                  disabled={selectedTest.sections.length === 0}
                  onClick={() => openAddQuestionModal()}
                >
                  + Add Question
                </button>
              </div>
            </div>

            {/* Section Tabs Navigation */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  overflowX: 'auto',
                  borderBottom: '1px solid var(--border)',
                  paddingBottom: 8,
                }}
              >
                <button
                  onClick={() => setActiveSectionId('all')}
                  style={{
                    padding: '8px 16px',
                    fontSize: '0.875rem',
                    fontWeight: activeSectionId === 'all' ? 600 : 400,
                    color: activeSectionId === 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
                    background: activeSectionId === 'all' ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: `1px solid ${activeSectionId === 'all' ? 'var(--border-light)' : 'transparent'}`,
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                  }}
                >
                  All Sections
                  <span className="badge badge-gray" style={{ fontSize: '0.6875rem', padding: '1px 6px' }}>
                    {totalQuestionsCount}
                  </span>
                </button>

                {selectedTest.sections.map((sec, si) => {
                  const isActive = activeSectionId === sec.id;
                  return (
                    <button
                      key={sec.id}
                      onClick={() => setActiveSectionId(sec.id)}
                      style={{
                        padding: '8px 16px',
                        fontSize: '0.875rem',
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                        background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                        border: `1px solid ${isActive ? 'var(--border-light)' : 'transparent'}`,
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        &sect;{si + 1}
                      </span>
                      {sec.name}
                      <span className="badge badge-gray" style={{ fontSize: '0.6875rem', padding: '1px 6px' }}>
                        {sec.questions.length}
                      </span>
                    </button>
                  );
                })}

                <button
                  onClick={() => { setSectionName(''); setSectionTime(1800); setIsAddSectionOpen(true); }}
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.8125rem',
                    color: 'var(--text-muted)',
                    background: 'transparent',
                    border: '1px dashed var(--border-light)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  + New Section
                </button>
              </div>
            </div>

            {/* Active Section Bar (if specific section selected) */}
            {activeSection && (
              <div
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div className="flex items-center gap-md">
                  <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>
                    {activeSection.name}
                  </span>
                  <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>
                    Time Limit: {Math.floor(activeSection.timeLimit / 60)}m {activeSection.timeLimit % 60}s
                  </span>
                  <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>
                    {activeSection.questions.length} questions
                  </span>
                </div>

                <div className="flex gap-sm items-center">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditMode({ kind: 'section', testId: selectedTest.id, sectionId: activeSection.id, name: activeSection.name, timeLimit: activeSection.timeLimit })}
                  >
                    Edit Section
                  </button>
                  <DeleteBtn label="Section" onConfirm={() => deleteSection(selectedTest.id, activeSection.id)} disabled={loading} />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => openAddQuestionModal(activeSection.id)}
                  >
                    + Add Question
                  </button>
                </div>
              </div>
            )}

            {/* Search & Statistics Filter Bar */}
            <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Filter questions by text, #tag, or author..."
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '0.875rem',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Showing {displayedQuestions.length} of {activeSectionId === 'all' ? totalQuestionsCount : (activeSection?.questions.length || 0)} questions
              </div>
            </div>

            {/* ── Full Width Question Cards Canvas ────────────────────── */}
            {selectedTest.sections.length === 0 ? (
              <div
                style={{
                  padding: '48px 24px',
                  background: 'var(--bg-card)',
                  border: '1px dashed var(--border-light)',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'center',
                }}
              >
                <h3 style={{ fontSize: '1.125rem', marginBottom: 8 }}>No sections created yet</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 20 }}>
                  Tests require at least one section (e.g. "Aptitude", "Technical", "Rocketry") before adding questions.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => { setSectionName(''); setSectionTime(1800); setIsAddSectionOpen(true); }}
                >
                  + Add First Section
                </button>
              </div>
            ) : displayedQuestions.length === 0 ? (
              <div
                style={{
                  padding: '48px 24px',
                  background: 'var(--bg-card)',
                  border: '1px dashed var(--border-light)',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'center',
                }}
              >
                <h3 style={{ fontSize: '1.125rem', marginBottom: 8 }}>
                  {searchQuery ? 'No matching questions found' : 'No questions in this section yet'}
                </h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 20 }}>
                  {searchQuery ? 'Try adjusting your search criteria.' : 'Add questions to populate this section of the test.'}
                </p>
                {!searchQuery && (
                  <button
                    className="btn btn-primary"
                    onClick={() => openAddQuestionModal(activeSectionId !== 'all' ? activeSectionId : undefined)}
                  >
                    + Add Question
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {displayedQuestions.map(q => (
                  <div
                    key={q.id}
                    id={`question-card-${q.id}`}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '20px 24px',
                      transition: 'border-color var(--transition-fast)',
                    }}
                  >
                    {/* Card Top Row: Meta & Actions */}
                    <div className="flex justify-between items-center" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                      <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                          Q{q.questionIndex}
                        </span>
                        
                        {activeSectionId === 'all' && (
                          <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                            {q.sectionName}
                          </span>
                        )}

                        <span className="badge badge-gray" style={{ fontSize: '0.6875rem', textTransform: 'uppercase' }}>
                          {q.type}
                        </span>

                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            background: 'rgba(255,255,255,0.04)',
                            padding: '2px 8px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-xs)',
                          }}
                        >
                          #{q.tag}
                        </span>

                        {q.timeLimit ? (
                          <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                            Timer: {q.timeLimit}s
                          </span>
                        ) : null}
                      </div>

                      <div className="flex gap-sm items-center">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditMode({
                            kind: 'question',
                            testId: selectedTest.id,
                            sectionId: q.sectionId,
                            question: { ...q, options: q.options ? [...q.options] : ['', '', '', ''] },
                          })}
                        >
                          Edit
                        </button>
                        <DeleteBtn label="" onConfirm={() => deleteQuestion(selectedTest.id, q.sectionId, q.id)} disabled={loading} />
                      </div>
                    </div>

                    {/* Question Content (Full Width, No Truncation) */}
                    <div style={{ fontSize: '1rem', lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: q.options && q.options.length > 0 ? 16 : 12 }}>
                      {q.text}
                    </div>

                    {/* Options Grid (MCQ) */}
                    {q.type === 'mcq' && q.options && q.options.length > 0 && (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                          gap: 10,
                          marginBottom: 16,
                        }}
                      >
                        {q.options.map((opt, oi) => (
                          <div
                            key={oi}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 10,
                              padding: '10px 14px',
                              background: 'var(--bg-input)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.875rem',
                            }}
                          >
                            <span
                              style={{
                                width: 22,
                                height: 22,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(255,255,255,0.07)',
                                border: '1px solid var(--border-light)',
                                borderRadius: 'var(--radius-xs)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                                flexShrink: 0,
                                marginTop: 1,
                              }}
                            >
                              {String.fromCharCode(65 + oi)}
                            </span>
                            <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                              {opt}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Card Footer: Author Attribution & Timestamps */}
                    <div
                      style={{
                        paddingTop: 12,
                        borderTop: '1px solid var(--border-light)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 8,
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <div className="flex items-center gap-sm">
                        <span>
                          Author: <strong style={{ color: 'var(--text-secondary)' }}>{q.authorName || 'Personnel'}</strong>
                          {q.authorRole && <span> ({q.authorRole})</span>}
                        </span>
                        {q.createdAt && (
                          <span>&middot; Added: {new Date(q.createdAt).toLocaleDateString()} {new Date(q.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                      </div>

                      {q.lastEditedBy && (
                        <div>
                          Last edited by <strong style={{ color: 'var(--text-secondary)' }}>{q.lastEditedBy}</strong>
                          {q.lastEditedAt && <span> on {new Date(q.lastEditedAt).toLocaleDateString()}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MODALS ───────────────────────────────────────────────────────────── */}

      {/* Create Test Modal */}
      {isCreateTestOpen && (
        <Modal title="Create New Test" onClose={() => setIsCreateTestOpen(false)}>
          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
            <label htmlFor="modal-test-title">Test Title</label>
            <input
              id="modal-test-title"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="e.g. AeroSoc Recruitment Test (K26)"
              onKeyDown={e => e.key === 'Enter' && createTest()}
              autoFocus
            />
          </div>
          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setIsCreateTestOpen(false)}>Cancel</button>
            <button
              id="modal-submit-create-test"
              className="btn btn-primary"
              onClick={createTest}
              disabled={loading || !newTitle.trim()}
            >
              Create Test
            </button>
          </div>
        </Modal>
      )}

      {/* Add Section Modal */}
      {isAddSectionOpen && selectedTest && (
        <Modal title={`Add Section to "${selectedTest.title}"`} onClose={() => setIsAddSectionOpen(false)}>
          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
            <label htmlFor="modal-section-name">Section Name</label>
            <input
              id="modal-section-name"
              value={sectionName}
              onChange={e => setSectionName(e.target.value)}
              placeholder="e.g. Rocketry & Propulsion"
              autoFocus
            />
          </div>
          <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
            <label htmlFor="modal-section-time">Time Limit (seconds)</label>
            <input
              id="modal-section-time"
              type="number"
              value={sectionTime}
              onChange={e => setSectionTime(Number(e.target.value))}
            />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4, display: 'block', fontFamily: 'var(--font-mono)' }}>
              = {Math.floor(sectionTime / 60)} minutes {sectionTime % 60} seconds
            </span>
          </div>
          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setIsAddSectionOpen(false)}>Cancel</button>
            <button
              id="modal-submit-add-section"
              className="btn btn-primary"
              onClick={addSection}
              disabled={loading || !sectionName.trim()}
            >
              Add Section
            </button>
          </div>
        </Modal>
      )}

      {/* Add Question Modal */}
      {isAddQuestionOpen && selectedTest && (
        <Modal title={`Add Question &mdash; ${selectedTest.title}`} maxWidth={640} onClose={() => setIsAddQuestionOpen(false)}>
          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
            <label htmlFor="modal-q-section">Target Section</label>
            <select
              id="modal-q-section"
              value={qSectionId}
              onChange={e => setQSectionId(e.target.value)}
            >
              {selectedTest.sections.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
            <label htmlFor="modal-q-type">Question Type</label>
            <select
              id="modal-q-type"
              value={qType}
              onChange={e => setQType(e.target.value as 'mcq' | 'short')}
            >
              <option value="mcq">Multiple Choice (MCQ)</option>
              <option value="short">Short Answer</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
            <label htmlFor="modal-q-text">Question Text</label>
            <textarea
              id="modal-q-text"
              value={qText}
              onChange={e => setQText(e.target.value)}
              rows={4}
              placeholder="Enter full question statement..."
              autoFocus
            />
          </div>

          {qType === 'mcq' && (
            <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                <label style={{ margin: 0 }}>Options</label>
                {qOptions.length < 6 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => setQOptions([...qOptions, ''])}
                  >
                    + Add Option
                  </button>
                )}
              </div>
              {qOptions.map((opt, i) => (
                <div key={i} className="flex gap-sm" style={{ marginBottom: 8, alignItems: 'center' }}>
                  <span
                    style={{
                      width: 28, height: 28, border: '1px solid var(--border-light)',
                      borderRadius: 'var(--radius-xs)', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700,
                      color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <input
                    id={`modal-q-option-${i}`}
                    value={opt}
                    onChange={e => {
                      const o = [...qOptions];
                      o[i] = e.target.value;
                      setQOptions(o);
                    }}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    style={{ flex: 1 }}
                  />
                  {qOptions.length > 2 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--accent-red-light)', padding: '2px 8px' }}
                      onClick={() => {
                        const o = [...qOptions];
                        o.splice(i, 1);
                        setQOptions(o);
                      }}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="grid-2" style={{ gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
            <div className="form-group">
              <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
                <label htmlFor="modal-q-tag" style={{ margin: 0 }}>Question Tag</label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.6875rem', padding: '1px 6px', fontFamily: 'var(--font-mono)' }}
                  onClick={() => setQTag(generateQuestionTag())}
                >
                  Generate
                </button>
              </div>
              <input
                id="modal-q-tag"
                value={qTag}
                onChange={e => setQTag(e.target.value)}
                placeholder="e.g. 875TOD30P"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="modal-q-time">Per-Question Timer (s, 0=none)</label>
              <input
                id="modal-q-time"
                type="number"
                value={qTimeLimit}
                onChange={e => setQTimeLimit(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setIsAddQuestionOpen(false)}>Cancel</button>
            <button
              id="modal-submit-add-question"
              className="btn btn-primary"
              onClick={addQuestion}
              disabled={loading || !qText.trim() || !qSectionId || !qTag.trim()}
            >
              Add Question
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Test Title Modal */}
      {editMode.kind === 'test' && (
        <Modal title="Rename Test" onClose={() => setEditMode({ kind: 'none' })}>
          <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
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

      {/* Edit Section Modal */}
      {editMode.kind === 'section' && (
        <Modal title="Edit Section" onClose={() => setEditMode({ kind: 'none' })}>
          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
            <label htmlFor="edit-section-name">Section Name</label>
            <input
              id="edit-section-name"
              value={editMode.name}
              onChange={e => setEditMode({ ...editMode, name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
            <label htmlFor="edit-section-time">Time Limit (seconds)</label>
            <input
              id="edit-section-time"
              type="number"
              value={editMode.timeLimit}
              onChange={e => setEditMode({ ...editMode, timeLimit: Number(e.target.value) })}
            />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4, display: 'block', fontFamily: 'var(--font-mono)' }}>
              = {Math.floor(editMode.timeLimit / 60)}m {editMode.timeLimit % 60}s
            </span>
          </div>
          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setEditMode({ kind: 'none' })}>Cancel</button>
            <button className="btn btn-primary" onClick={saveSectionEdit} disabled={loading || !editMode.name.trim()}>Save</button>
          </div>
        </Modal>
      )}

      {/* Edit Question Modal */}
      {editMode.kind === 'question' && (
        <Modal title="Edit Question" maxWidth={640} onClose={() => setEditMode({ kind: 'none' })}>
          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
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
          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
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
            <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                <label style={{ margin: 0 }}>Options</label>
                {(editMode.question.options || []).length < 6 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => {
                      const opts = [...(editMode.question.options || []), ''];
                      setEditMode({ ...editMode, question: { ...editMode.question, options: opts } });
                    }}
                  >
                    + Add Option
                  </button>
                )}
              </div>
              {(editMode.question.options || ['', '', '', '']).map((opt, i) => (
                <div key={i} className="flex gap-sm" style={{ marginBottom: 8, alignItems: 'center' }}>
                  <span style={{
                    width: 28, height: 28, border: '1px solid var(--border-light)',
                    borderRadius: 'var(--radius-xs)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700,
                    color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'var(--font-mono)',
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
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--accent-red-light)', padding: '2px 8px' }}
                      onClick={() => {
                        const opts = [...(editMode.question.options || [])];
                        opts.splice(i, 1);
                        setEditMode({ ...editMode, question: { ...editMode.question, options: opts } });
                      }}
                    >&times;</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="grid-2" style={{ gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
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
