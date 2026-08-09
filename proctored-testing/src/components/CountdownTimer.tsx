'use client';

import { useEffect, useState, useRef } from 'react';

interface Props {
  durationSeconds: number;
  onExpire?: () => void;
  onTick?: (remaining: number) => void;
  label?: string;
}

export default function CountdownTimer({ durationSeconds, onExpire, onTick, label }: Props) {
  const [remaining, setRemaining] = useState(durationSeconds);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  const onTickRef = useRef(onTick);

  useEffect(() => {
    onExpireRef.current = onExpire;
    onTickRef.current = onTick;
  }, [onExpire, onTick]);

  useEffect(() => {
    expiredRef.current = false;
    setRemaining(durationSeconds);
    const interval = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(interval);
          if (!expiredRef.current) {
            expiredRef.current = true;
            onExpireRef.current?.();
          }
          return 0;
        }
        onTickRef.current?.(next);
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [durationSeconds]);

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
