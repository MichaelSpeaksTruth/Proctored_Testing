'use client';

import { useEffect, forwardRef } from 'react';

interface Props {
  stream?: MediaStream | null;
}

const WebcamFeed = forwardRef<HTMLVideoElement, Props>(function WebcamFeed({ stream }, ref) {
  useEffect(() => {
    if (ref && 'current' in ref && ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream, ref]);

  return (
    <div className="webcam-container">
      <div className="flex items-center gap-sm">
        <span className="webcam-status-dot" />
        <span className="webcam-label">Live Camera</span>
      </div>
      <video
        ref={ref}
        className="webcam-feed"
        autoPlay
        playsInline
        muted
        style={{ width: 200, height: 150, objectFit: 'cover', borderRadius: 6 }}
      />
    </div>
  );
});

export default WebcamFeed;
