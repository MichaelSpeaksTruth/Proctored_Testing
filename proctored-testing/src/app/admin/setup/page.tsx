'use client';

import { useState, useEffect } from 'react';
import { rtdb } from '@/lib/firebase';
import { ref, push, get, update, remove, set } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';
import { Question } from '@/components/QuestionPanel';

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

function SetupContent() {
  const [tests, setTests] = useState<TestDraft[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

  const fetchTests = async () => {
    const snap = await get(ref(rtdb, 'tests'));
    const val = snap.val();
    if (!val) {
      setTests([]);
      return;
    }
    const parsed = Object.keys(val).map(key => ({ 
      id: key, 
      ...val[key],
      sections: val[key].sections || []
    }));
    setTests(parsed);
  };

  useEffect(() => { fetchTests(); }, []);

  const selectedTest = tests.find(t => t.id === selectedTestId) || null;

  const createTest = async () => {
    if (!newTitle.trim()) return;
    setLoading(true);
    const newRef = push(ref(rtdb, 'tests'));
    await set(newRef, {
      title: newTitle.trim(),
      sections: [],
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    setNewTitle('');
    setSelectedTestId(newRef.key);
    await fetchTests();
    setLoading(false);
  };

  const addSection = async () => {
    if (!selectedTestId || !sectionName.trim()) return;
    setLoading(true);
    const test = tests.find(t => t.id === selectedTestId)!;
    const newSection: Section = {
      id: `s_${Date.now()}`,
      name: sectionName.trim(),
      timeLimit: sectionTime,
      questions: [],
    };
    await update(ref(rtdb, `tests/${selectedTestId}`), {
      sections: [...(test.sections || []), newSection],
    });
    setSectionName('');
    await fetchTests();
    setLoading(false);
    setMsg(`Section "${newSection.name}" added.`);
  };

  const addQuestion = async () => {
    if (!selectedTestId || !qText.trim() || !qSectionId || !qTag.trim()) return;
    setLoading(true);
    const test = tests.find(t => t.id === selectedTestId)!;
    const newQ: Question = {
      id: `q_${Date.now()}`,
      text: qText.trim(),
      type: qType,
      tag: qTag.trim(),
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
    setQText(''); setQTag(''); setQOptions(['', '', '', '']); setQTimeLimit(0);
    await fetchTests();
    setLoading(false);
    setMsg('Question added.');
  };

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
          <Link href="/admin" className="btn btn-ghost btn-sm">← Back</Link>
          <h1 style={{ fontSize: '1.75rem' }}>Test Setup</h1>
        </div>

        {msg && <div className="alert alert-success" style={{ marginBottom: 'var(--space-lg)' }}>{msg}</div>}

        <div className="grid-2" style={{ gap: 'var(--space-lg)', alignItems: 'start' }}>
          {/* Left: test list + create */}
          <div>
            <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
              <h3 style={{ marginBottom: 'var(--space-md)' }}>Create New Test</h3>
              <div className="form-group">
                <label htmlFor="test-title">Test Title</label>
                <input id="test-title" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. AeroSoc Round 1" />
              </div>
              <button id="create-test-btn" className="btn btn-primary" onClick={createTest} disabled={loading || !newTitle.trim()}>Create Test</button>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 'var(--space-md)' }}>Existing Tests</h3>
              {tests.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No tests created yet.</p>
              ) : (
                <div className="flex-col gap-sm">
                  {tests.map(t => (
                    <button
                      key={t.id}
                      id={`select-test-${t.id}`}
                      onClick={() => setSelectedTestId(t.id)}
                      style={{
                        padding: '12px 16px',
                        background: selectedTestId === t.id ? 'rgba(255,255,255,0.06)' : 'var(--bg-input)',
                        border: `1px solid ${selectedTestId === t.id ? 'var(--border-light)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-sans)',
                        fontSize: '0.9375rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{t.title}</div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{t.sections.length} sections · {t.sections.reduce((acc, s) => acc + s.questions.length, 0)} questions</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: section + question builder */}
          {selectedTest && (
            <div>
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
                <button id="add-section-btn" className="btn btn-primary" onClick={addSection} disabled={loading || !sectionName.trim()}>Add Section</button>
              </div>

              {selectedTest.sections.length > 0 && (
                <div className="card">
                  <h3 style={{ marginBottom: 'var(--space-md)' }}>Add Question</h3>
                  <div className="form-group">
                    <label htmlFor="q-section">Target Section</label>
                    <select id="q-section" value={qSectionId} onChange={e => setQSectionId(e.target.value)}>
                      <option value="">-- Select section --</option>
                      {selectedTest.sections.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
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
                  <button id="add-question-btn" className="btn btn-primary" onClick={addQuestion} disabled={loading || !qText.trim() || !qSectionId || !qTag.trim()}>Add Question</button>

                  {/* Preview */}
                  <div className="divider" />
                  {selectedTest.sections.map(sec => (
                    <div key={sec.id} style={{ marginBottom: 'var(--space-md)' }}>
                      <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
                        <h4 style={{ fontSize: '0.875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{sec.name}</h4>
                        <span className="badge badge-gray">{sec.questions.length} Qs · {Math.floor(sec.timeLimit / 60)}m</span>
                      </div>
                      {sec.questions.map((q, qi) => (
                        <div key={q.id} style={{ padding: '8px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: 6, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginRight: 8 }}>Q{qi+1}</span>
                          {q.text.substring(0, 80)}{q.text.length > 80 ? '...' : ''}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function SetupPage() {
  return <AdminGuard><SetupContent /></AdminGuard>;
}
