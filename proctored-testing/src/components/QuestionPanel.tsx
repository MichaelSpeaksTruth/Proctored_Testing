'use client';

import { useState } from 'react';

export interface Question {
  id: string;
  text: string;
  options?: string[];
  type: 'mcq' | 'short';
  tag: string;
  timeLimit?: number;
}

interface Props {
  question: Question;
  questionIndex: number;
  totalQuestions: number;
  answer: string;
  onChange: (answer: string) => void;
}

export default function QuestionPanel({
  question,
  questionIndex,
  totalQuestions,
  answer,
  onChange,
}: Props) {
  return (
    <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
      <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
        <span className="badge badge-gray">
          Question {questionIndex + 1} / {totalQuestions}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          #{question.tag}
        </span>
      </div>

      <p style={{ fontSize: '1.0625rem', color: 'var(--text-primary)', marginBottom: 'var(--space-xl)', lineHeight: 1.8 }}>
        {question.text}
      </p>

      {question.type === 'mcq' && question.options ? (
        <div className="flex-col gap-sm">
          {question.options.map((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const isSelected = answer === letter;
            return (
              <button
                key={idx}
                id={`option-${question.id}-${letter}`}
                onClick={() => onChange(letter)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-md)',
                  padding: '14px 20px',
                  background: isSelected ? 'rgba(255,255,255,0.06)' : 'var(--bg-input)',
                  border: `1px solid ${isSelected ? 'rgba(255,255,255,0.25)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '0.9375rem',
                  transition: 'all 150ms ease',
                  width: '100%',
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    border: `1px solid ${isSelected ? 'var(--white)' : 'var(--border-light)'}`,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8125rem',
                    fontWeight: 700,
                    color: isSelected ? 'var(--white)' : 'var(--text-muted)',
                    flexShrink: 0,
                    background: isSelected ? 'rgba(255,255,255,0.1)' : 'transparent',
                  }}
                >
                  {letter}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
      ) : (
        <textarea
          id={`answer-${question.id}`}
          value={answer}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer here..."
          rows={4}
          style={{ resize: 'vertical' }}
        />
      )}
    </div>
  );
}
