'use client';

import { useEffect, forwardRef, useRef } from 'react';

interface Props {
  stream?: MediaStream | null;
  embedded?: boolean;
}

const WebcamFeed = forwardRef<HTMLVideoElement, Props>(function WebcamFeed({ stream, embedded = false }, externalRef) {
  const internalRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // If an external ref is provided, try to use it. Otherwise, use the internal ref.
    const activeRef = (externalRef as React.MutableRefObject<HTMLVideoElement>)?.current ? (externalRef as React.MutableRefObject<HTMLVideoElement>) : internalRef;
    
    if (activeRef.current && stream) {
      activeRef.current.srcObject = stream;
    }
  }, [stream, externalRef]);

  return (
    <div className={embedded ? "" : "webcam-container"} style={embedded ? { width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 } : {}}>
      {!embedded && (
        <div className="flex items-center gap-sm">
          <span className="webcam-status-dot" />
          <span className="webcam-label">Live Camera</span>
        </div>
      )}
      <video
        ref={(node) => {
          // Keep both refs in sync
          if (typeof externalRef === 'function') externalRef(node);
          else if (externalRef) (externalRef as React.MutableRefObject<HTMLVideoElement | null>).current = node;
          internalRef.current = node;
        }}
        className={embedded ? "" : "webcam-feed"}
        autoPlay
        playsInline
        muted
        style={embedded ? { width: '100%', height: '100%', objectFit: 'cover' } : { width: 200, height: 150, objectFit: 'cover', borderRadius: 6 }}
      />
      {embedded && (
        <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="webcam-status-dot" style={{ margin: 0 }} />
          <span className="webcam-label" style={{ color: '#fff' }}>LIVE CAMERA</span>
        </div>
      )}
    </div>
  );
});

export default WebcamFeed;
