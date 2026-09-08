import React, { useState, useEffect } from 'react';
import { IconHeadphones, IconMic, IconClock } from './Icons';

/**
 * PhaseIntroOverlay
 * Clean, punchy arcade-style announcement overlay:
 * - Round start: "ROUND 1 STARTS"
 * - Record start: "RECORD YOUR VERSION"
 */
export default function PhaseIntroOverlay({
  type = 'ROUND_START', // 'ROUND_START' | 'RECORD_START'
  roundNumber = 1,
  durationMs = 1800,
  onComplete
}) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, Math.max(400, durationMs - 350));

    const finishTimer = setTimeout(() => {
      if (onComplete) onComplete();
    }, durationMs);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(finishTimer);
    };
  }, [durationMs, onComplete]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      if (onComplete) onComplete();
    }, 150);
  };

  const isRoundStart = type === 'ROUND_START';

  return (
    <div
      className={`phase-intro-backdrop ${isExiting ? 'phase-intro-exit' : 'phase-intro-enter'}`}
      onClick={handleDismiss}
      role="button"
      tabIndex={0}
      title="Click to continue"
    >
      <div
        className={`phase-intro-card ${isExiting ? 'card-pop-out' : 'card-pop-in'}`}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 440,
          padding: '2.5rem 1.8rem',
          borderRadius: '28px'
        }}
      >
        {/* Animated Icon with Glowing Halo */}
        <div className={`phase-intro-icon-wrap ${isRoundStart ? 'icon-listen' : 'icon-record'}`} style={{ width: 92, height: 92 }}>
          <div className="phase-intro-halo" />
          <div className="phase-intro-halo halo-2" />
          {isRoundStart ? (
            <IconHeadphones size={50} />
          ) : (
            <IconMic size={50} />
          )}
        </div>

        {/* The Exact Punchy Title */}
        <h1
          className="phase-intro-title"
          style={{
            fontSize: '2.4rem',
            lineHeight: 1.15,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            margin: '0.6rem 0'
          }}
        >
          {isRoundStart ? `ROUND ${roundNumber} STARTS` : 'RECORD YOUR VERSION'}
        </h1>

        {/* Clean Sub-banner */}
        {!isRoundStart && (
          <div
            className="phase-intro-banner banner-record"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.45rem 1rem',
              fontSize: '0.92rem',
              fontWeight: 800,
              letterSpacing: '0.03em',
              margin: '0.25rem 0 0 0'
            }}
          >
            <IconClock size={18} /> 30 SECONDS TO RECORD
          </div>
        )}

        {/* Animated Bottom Progress Line */}
        <div className="phase-intro-timer-track">
          <div
            className="phase-intro-timer-fill"
            style={{ animationDuration: `${durationMs}ms` }}
          />
        </div>
      </div>
    </div>
  );
}
