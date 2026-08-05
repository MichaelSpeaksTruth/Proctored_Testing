'use client';

/**
 * useTestState.ts
 *
 * Offline-resilient answer state management.
 *
 * Every answer change is immediately persisted to localStorage so that:
 *  - A page refresh (panic or accidental) restores the student's exact progress.
 *  - A network drop doesn't lose any work.
 *  - The in-memory state and localStorage are always in sync.
 *
 * Storage key: pt_answers_{testId}_{uid}
 * Call clearPersistedState() after a successful submission to clean up.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

type Answers = Record<string, string>;

function makeStorageKey(testId: string, uid: string): string {
  return `pt_answers_${testId}_${uid}`;
}

interface UseTestStateReturn {
  answers: Answers;
  setAnswer: (questionId: string, value: string) => void;
  clearPersistedState: () => void;
  /** True on the first render if answers were restored from localStorage */
  wasRestored: boolean;
}

export function useTestState(
  testId: string | null,
  uid: string | null
): UseTestStateReturn {
  const [answers, setAnswers] = useState<Answers>({});
  const [wasRestored, setWasRestored] = useState(false);
  // Track whether we've hydrated from localStorage yet
  const hydratedRef = useRef(false);

  // Hydrate from localStorage once testId + uid are both known
  useEffect(() => {
    if (!testId || !uid || hydratedRef.current) return;
    hydratedRef.current = true;

    try {
      const key = makeStorageKey(testId, uid);
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed: Answers = JSON.parse(stored);
        const hasAnswers = Object.keys(parsed).length > 0;
        if (hasAnswers) {
          setAnswers(parsed);
          setWasRestored(true);
        }
      }
    } catch {
      // If localStorage is corrupt / unavailable, start fresh silently
    }
  }, [testId, uid]);

  // Persist to localStorage on every answers change (after initial hydration)
  useEffect(() => {
    if (!testId || !uid || !hydratedRef.current) return;
    try {
      const key = makeStorageKey(testId, uid);
      localStorage.setItem(key, JSON.stringify(answers));
    } catch {
      // Storage quota exceeded or unavailable — continue in-memory
    }
  }, [answers, testId, uid]);

  const setAnswer = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const clearPersistedState = useCallback(() => {
    if (!testId || !uid) return;
    try {
      localStorage.removeItem(makeStorageKey(testId, uid));
    } catch {
      // Ignore
    }
    setAnswers({});
  }, [testId, uid]);

  return { answers, setAnswer, clearPersistedState, wasRestored };
}
