'use client';

import { useEffect, useState, useRef } from 'react';

interface Props {
  durationSeconds: number;
  onExpire?: () => void;
  onTick?: (remaining: number) => void;
  label?: string;
  isStopped?: boolean;
}

export default function CountdownTimer({ durationSeconds, onExpire, onTick, label, isStopped }: Props) {
  const [remaining, setRemaining] = useState(durationSeconds);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  const onTickRef = useRef(onTick);

  useEffect(() => {
    onExpireRef.current = onExpire;
    onTickRef.current = onTick;
  }, [onExpire, onTick]);

  useEffect(() => {
    if (isStopped) return; // Freeze timer if stopped

    expiredRef.current = false;
    setRemaining(durationSeconds);

    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const next = Math.max(0, durationSeconds - elapsed);
      setRemaining(next);

      if (next <= 0) {
        clearInterval(interval);
        if (!expiredRef.current) {
          expiredRef.current = true;
          onExpireRef.current?.();
        }
        return;
      }
      onTickRef.current?.(next);
    }, 500);

    return () => clearInterval(interval);
  }, [durationSeconds, isStopped]);

  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  const format = (n: number) => String(n).padStart(2, '0');
  const pct = remaining / durationSeconds;

  let timerClass = 'timer';
  if (pct < 0.1) timerClass += ' danger';
  else if (pct < 0.25) timerClass += ' warning';

  return (
    <div className="timer-wrapper">
      {label && <div className="timer-label">{label}</div>}
      <div className={timerClass}>
        {hours > 0 ? `${format(hours)}:${format(minutes)}:${format(seconds)}` : `${format(minutes)}:${format(seconds)}`}
      </div>
    </div>
  );
}
