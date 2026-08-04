'use client';

import { useState, useEffect } from 'react';
import { db, rtdb } from '@/lib/firebase';
import { collection, doc, getDocs, setDoc, getDoc } from 'firebase/firestore';
import { ref, get } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import LeaderboardTable, { LeaderboardEntry } from '@/components/LeaderboardTable';
import Link from 'next/link';

interface TestOption { id: string; title: string; }
interface AnswerKey { [tag: string]: string; }
interface Submission { answers: Record<string, string>; submittedAt: string; autoSubmitted: boolean; }

function ResultsContent() {
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [answerKeyText, setAnswerKeyText] = useState('');
  const [answerKeyFile, setAnswerKeyFile] = useState<File | null>(null);
  const [answerKey, setAnswerKey] = useState<AnswerKey | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roundStatusUpdates, setRoundStatusUpdates] = useState<Record<string, string>>({});

  useEffect(() => {
    getDocs(collection(db, 'tests')).then(snap =>
      setTests(snap.docs.map(d => ({ id: d.id, title: (d.data().title as string) || d.id })))
    );
  }, []);

  const parseAnswerKeyText = (text: string): AnswerKey => {
    const key: AnswerKey = {};
    text.split('\n').forEach(line => {
      const [tag, answer] = line.split(':').map(s => s.trim());
      if (tag && answer) key[tag] = answer.toUpperCase();
    });
    return key;
  };

  const loadAnswerKeyFromFile = async () => {
    if (!answerKeyFile) return null;
    const { read, utils } = await import('xlsx');
    const buf = await answerKeyFile.arrayBuffer();
    const wb = read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = utils.sheet_to_json<{ tag?: string; answer?: string; Tag?: string; Answer?: string }>(sheet);
    const key: AnswerKey = {};
    rows.forEach(row => {
      const tag = String(row.tag || row.Tag || '').trim();
      const ans = String(row.answer || row.Answer || '').trim().toUpperCase();
      if (tag && ans) key[tag] = ans;
    });
    return key;
  };

  const uploadAnswerKey = async () => {
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      let key: AnswerKey = {};
      if (answerKeyFile) {
        const fileKey = await loadAnswerKeyFromFile();
        if (fileKey) key = fileKey;
      } else if (answerKeyText.trim()) {
        key = parseAnswerKeyText(answerKeyText);
      } else {
        setError('Please provide an answer key via file or text input.');
        setLoading(false);
        return;
      }
      await setDoc(doc(db, 'answerKeys', selectedTestId), key);
      setAnswerKey(key);
      setMsg(`Answer key uploaded with ${Object.keys(key).length} entries.`);
    } catch (e) {
      setError('Failed to upload answer key.');
    } finally {
      setLoading(false);
    }
  };

  const declareResults = async () => {
    if (!selectedTestId) { setError('Select a test first.'); return; }
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      // Load answer key if not in state
      let key = answerKey;
      if (!key) {
        const keySnap = await getDoc(doc(db, 'answerKeys', selectedTestId));
        if (!keySnap.exists()) { setError('No answer key found. Please upload it first.'); setLoading(false); return; }
        key = keySnap.data() as AnswerKey;
        setAnswerKey(key);
      }

      // Load test structure (to get question tags)
      const testSnap = await getDoc(doc(db, 'tests', selectedTestId));
      const testData = testSnap.data();
      const questionTagMap: Record<string, string> = {}; // questionId -> tag
      (testData?.sections || []).forEach((sec: { questions: { id: string; tag: string }[] }) => {
        sec.questions.forEach((q) => { questionTagMap[q.id] = q.tag; });
      });
      const totalQuestions = Object.keys(questionTagMap).length;

      // Load all submissions
      const submissionsSnap = await getDocs(collection(db, `submissions/${selectedTestId}`));
      const participantsSnap = await getDocs(collection(db, 'participants'));

      // Map uid -> email from participants (indexed by email)
      // We need uid -> email, so load all and match
      const emailToData: Record<string, string> = {};
      participantsSnap.docs.forEach(d => { emailToData[d.data().uid || ''] = d.id; });

      // Score each submission
      const scored: { uid: string; email: string; score: number }[] = [];
      for (const subDoc of submissionsSnap.docs) {
        const uid = subDoc.id;
        const sub = subDoc.data() as Submission;
        let score = 0;
        Object.entries(sub.answers || {}).forEach(([qId, ans]) => {
          const tag = questionTagMap[qId];
          if (tag && key![tag] === ans) score++;
        });
        scored.push({ uid, email: emailToData[uid] || uid, score });
      }

      // Sort by score descending, assign ranks
      scored.sort((a, b) => b.score - a.score);
      const entries: LeaderboardEntry[] = [];

      // Fetch proctoring flags for each
      for (let i = 0; i < scored.length; i++) {
        const { uid, email, score } = scored[i];
        const rank = i + 1;

        // Save result to Firestore
        await setDoc(doc(db, `results/${selectedTestId}/${uid}`), {
          score,
          total: totalQuestions,
          rank,
          roundStatus: roundStatusUpdates[uid] || 'Pending',
          email,
        });

        // Fetch flags from RTDB
        const flagsSnap = await get(ref(rtdb, `proctoringFlags/${uid}`));
        const flagsData = flagsSnap.val();
        const flags = flagsData
          ? Object.values(flagsData) as { event: string; severity: string; timestamp: string }[]
          : [];

        // Check for existing AI result
        const existingResult = await getDoc(doc(db, `results/${selectedTestId}/${uid}`));
        const existingAI = existingResult.data();

        entries.push({
          uid,
          name: email.split('@')[0],
          email,
          score,
          total: totalQuestions,
          rank,
          roundStatus: roundStatusUpdates[uid] || 'Pending',
          flagCount: flags.length,
          flags,
          aiSeverity: existingAI?.aiSeverity,
          aiSummary: existingAI?.aiSummary,
        });
      }

      setLeaderboard(entries);
      setMsg(`Results declared for ${entries.length} students.`);
    } catch (e) {
      console.error(e);
      setError('Failed to calculate results. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const analyzeStudent = async (uid: string) => {
    const entry = leaderboard.find(e => e.uid === uid);
    if (!entry || !entry.flags) return;
    setAnalyzing(uid);
    try {
      const res = await fetch('/api/analyze-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, flags: entry.flags }),
      });
      const data = await res.json();

      // Persist AI result to Firestore
      if (selectedTestId && data.severity) {
        await setDoc(
          doc(db, `results/${selectedTestId}/${uid}`),
          { aiSeverity: data.severity, aiSummary: data.summary },
          { merge: true }
        );
      }

      setLeaderboard(prev =>
        prev.map(e =>
          e.uid === uid
            ? { ...e, aiSeverity: data.severity, aiSummary: data.summary }
            : e
        )
      );
    } catch (e) {
      console.error('Groq analysis failed:', e);
    } finally {
      setAnalyzing(null);
    }
  };

  const updateRoundStatus = async (uid: string, status: string) => {
    setRoundStatusUpdates(prev => ({ ...prev, [uid]: status }));
    if (selectedTestId) {
      await setDoc(
        doc(db, `results/${selectedTestId}/${uid}`),
        { roundStatus: status },
        { merge: true }
      );
      setLeaderboard(prev => prev.map(e => e.uid === uid ? { ...e, roundStatus: status } : e));
    }
  };

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
          <Link href="/admin" className="btn btn-ghost btn-sm">← Back</Link>
          <h1 style={{ fontSize: '1.75rem' }}>Results & Grading</h1>
        </div>

        {msg && <div className="alert alert-success" style={{ marginBottom: 'var(--space-lg)' }}>{msg}</div>}
        {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--space-lg)' }}>{error}</div>}

        {/* Test select + Answer key upload */}
        <div className="grid-2" style={{ gap: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Select Test</h3>
            <div className="form-group">
              <label htmlFor="results-test-select">Test</label>
              <select id="results-test-select" value={selectedTestId} onChange={e => setSelectedTestId(e.target.value)}>
                <option value="">-- Select a test --</option>
                {tests.map(t => (<option key={t.id} value={t.id}>{t.title}</option>))}
              </select>
            </div>
            <button
              id="declare-results-btn"
              className="btn btn-success"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={declareResults}
              disabled={loading || !selectedTestId}
            >
              {loading ? 'Calculating...' : '✓ Declare Results'}
            </button>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Upload Answer Key</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
              Upload XLSX (columns: tag, answer) or enter manually (tag:answer per line).
            </p>
            <div className="form-group">
              <label htmlFor="answer-key-file">XLSX File</label>
              <input id="answer-key-file" type="file" accept=".xlsx,.xls,.csv" onChange={e => setAnswerKeyFile(e.target.files?.[0] || null)} />
            </div>
            <div className="form-group">
              <label htmlFor="answer-key-text">Or enter manually</label>
              <textarea
                id="answer-key-text"
                value={answerKeyText}
                onChange={e => setAnswerKeyText(e.target.value)}
                rows={4}
                placeholder={`apt_1:A\napt_2:C\nphy_1:B`}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}
              />
            </div>
            <button
              id="upload-key-btn"
              className="btn btn-primary"
              onClick={uploadAnswerKey}
              disabled={loading || (!answerKeyFile && !answerKeyText.trim()) || !selectedTestId}
            >
              Upload Key
            </button>
          </div>
        </div>

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <div className="card">
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
              <h2 style={{ fontSize: '1.375rem' }}>Leaderboard</h2>
              <span className="badge badge-gray">{leaderboard.length} candidates</span>
            </div>

            <div className="alert alert-info" style={{ marginBottom: 'var(--space-lg)' }}>
              <strong>AI Proctoring Review:</strong> Click "AI Review" on any student row to run an on-demand Groq analysis of their proctoring flags. Analysis is rate-limit safe — one student at a time.
            </div>

            <LeaderboardTable
              entries={leaderboard}
              onAnalyze={analyzeStudent}
              analyzing={analyzing}
            />

            {/* Round status bulk editor */}
            <div className="divider" />
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Update Round Status</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-sm)' }}>
              {leaderboard.map(entry => (
                <div
                  key={entry.uid}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    padding: '10px 14px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <span style={{ flex: 1, fontSize: '0.875rem', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.email}
                  </span>
                  <select
                    id={`round-status-${entry.uid}`}
                    value={entry.roundStatus || 'Pending'}
                    onChange={e => updateRoundStatus(entry.uid, e.target.value)}
                    style={{ width: 130, fontSize: '0.8125rem', padding: '6px 10px' }}
                  >
                    <option>Pending</option>
                    <option>Qualified</option>
                    <option>Eliminated</option>
                    <option>Waitlisted</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ResultsPage() {
  return <AdminGuard><ResultsContent /></AdminGuard>;
}
