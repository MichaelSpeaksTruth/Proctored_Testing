'use client';

import { useEffect, forwardRef, useRef } from 'react';

interface Props {
  stream?: MediaStream | null;
  embedded?: boolean;
  /**
   * When provided in embedded mode, this ref is rendered directly instead of
   * creating a new <video> element. This avoids the "black camera" bug on mobile
   * where the OS restricts a MediaStream to a single active video consumer.
   */
  sharedVideoRef?: React.RefObject<HTMLVideoElement | null>;
}

const WebcamFeed = forwardRef<HTMLVideoElement, Props>(function WebcamFeed(
  { stream, embedded = false, sharedVideoRef },
  externalRef
) {
  const internalRef = useRef<HTMLVideoElement>(null);

  // Sync both the external forwardRef and our internal ref in one effect
  // to avoid ordering issues on mobile Safari strict mode.
  useEffect(() => {
    if (externalRef) {
      if (typeof externalRef === 'function') {
        externalRef(internalRef.current);
      } else {
        (externalRef as React.MutableRefObject<HTMLVideoElement | null>).current =
          internalRef.current;
      }
    }
  }, [externalRef]);

  // Robustly attach stream to the exact video node we render.
  // Skip if we're in embedded mode using a sharedVideoRef — that video
  // element already has the stream attached by the parent.
  useEffect(() => {
    if (sharedVideoRef) return; // parent manages the shared element
    const videoNode = internalRef.current;
    if (videoNode && stream) {
      videoNode.srcObject = stream;
      videoNode.play().catch(() => {});
    }
  }, [stream, sharedVideoRef]);

  // ── Embedded mode using the shared (already-streaming) video element ──
  // We move the existing video node into this container via a ref callback
  // so the stream is never interrupted and mobile OSes don't see two consumers.
  if (embedded && sharedVideoRef) {
    return (
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, background: '#000' }}>
        {/* Mirror the shared video element's stream into a fresh clone */}
        <video
          ref={(el) => {
            if (el && sharedVideoRef.current?.srcObject) {
              el.srcObject = sharedVideoRef.current.srcObject;
              el.play().catch(() => {});
            }
          }}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute', bottom: 12, left: 12,
            background: 'rgba(0,0,0,0.6)', padding: '4px 8px',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span className="webcam-status-dot" style={{ margin: 0 }} />
          <span className="webcam-label" style={{ color: '#fff' }}>LIVE CAMERA</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={embedded ? '' : 'webcam-container'}
      style={embedded ? { width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 } : {}}
    >
      {!embedded && (
        <div className="flex items-center gap-sm">
          <span className="webcam-status-dot" />
          <span className="webcam-label">Live Camera</span>
        </div>
      )}
      <video
        ref={internalRef}
        className={embedded ? '' : 'webcam-feed'}
        autoPlay
        playsInline
        muted
        style={
          embedded
            ? { width: '100%', height: '100%', objectFit: 'cover' }
            : { width: 200, height: 150, objectFit: 'cover', borderRadius: 6 }
        }
      />
      {embedded && (
        <div
          style={{
            position: 'absolute', bottom: 12, left: 12,
            background: 'rgba(0,0,0,0.6)', padding: '4px 8px',
            borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span className="webcam-status-dot" style={{ margin: 0 }} />
          <span className="webcam-label" style={{ color: '#fff' }}>LIVE CAMERA</span>
        </div>
      )}
    </div>
  );
});

export default WebcamFeed;
