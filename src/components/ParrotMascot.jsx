import React from 'react';
import parrotLogo from '../assets/parrot-party.png';
import { IconMusic, IconSparkles, IconMic, IconHeadphones } from './Icons';

/**
 * ParrotMascot
 * Energetic arcade mascot with state-reactive accessories:
 * - 'LISTEN': DJ headphones + floating music notes + groove bob
 * - 'RECORD': Gold microphone + sound pulse waves
 * - 'COUNTDOWN': Energetic pulsing anticipation
 * - 'SUCCESS': Celebratory sparkles
 */
export default function ParrotMascot({
  mode = 'LISTEN', // 'LISTEN' | 'RECORD' | 'COUNTDOWN' | 'SUCCESS'
  size = 48,
  showBubble = false,
  bubbleText = '',
  className = '',
  style = {}
}) {
  const isListen = mode === 'LISTEN';
  const isRecord = mode === 'RECORD';
  const isCountdown = mode === 'COUNTDOWN';
  const isSuccess = mode === 'SUCCESS';

  return (
    <div
      className={`parrot-mascot-wrap mascot-${mode.toLowerCase()} ${className}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 8,
        height: size + 8,
        flexShrink: 0,
        ...style
      }}
    >
      {/* Ambient Pulsing Aura */}
      <div
        className="mascot-aura"
        style={{
          position: 'absolute',
          inset: 2,
          borderRadius: '50%',
          background: isListen
            ? 'radial-gradient(circle, rgba(124, 58, 237, 0.25) 0%, transparent 70%)'
            : isRecord
              ? 'radial-gradient(circle, rgba(244, 63, 94, 0.3) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(245, 158, 11, 0.3) 0%, transparent 70%)',
          animation: 'pulseAura 2s ease-in-out infinite',
          zIndex: 0
        }}
      />

      {/* Floating Music Notes for LISTEN phase */}
      {isListen && (
        <>
          <span className="floating-note note-1" aria-hidden="true" style={{ display: 'inline-flex' }}>
            <IconMusic size={14} color="#8b5cf6" />
          </span>
          <span className="floating-note note-2" aria-hidden="true" style={{ display: 'inline-flex' }}>
            <IconMusic size={11} color="#a855f7" />
          </span>
        </>
      )}

      {/* Sparks for RECORD phase */}
      {isRecord && (
        <>
          <span className="floating-spark spark-1" aria-hidden="true" style={{ display: 'inline-flex' }}>
            <IconSparkles size={14} color="#f43f5e" />
          </span>
          <span className="floating-spark spark-2" aria-hidden="true" style={{ display: 'inline-flex' }}>
            <IconMic size={12} color="#f43f5e" />
          </span>
        </>
      )}

      {/* Mascot Avatar Coin */}
      <div
        className="mascot-coin"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: `2px solid ${isListen ? 'rgba(139, 92, 246, 0.5)' : isRecord ? 'rgba(244, 63, 94, 0.5)' : 'rgba(245, 158, 11, 0.5)'}`,
          background: isListen
            ? 'radial-gradient(circle, rgba(139, 92, 246, 0.14) 0%, rgba(139, 92, 246, 0.03) 100%)'
            : isRecord
              ? 'radial-gradient(circle, rgba(244, 63, 94, 0.14) 0%, rgba(244, 63, 94, 0.03) 100%)'
              : 'radial-gradient(circle, rgba(245, 158, 11, 0.14) 0%, rgba(245, 158, 11, 0.03) 100%)',
          boxShadow: `0 3px 12px ${isListen ? 'rgba(139, 92, 246, 0.3)' : isRecord ? 'rgba(244, 63, 94, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 1,
          animation: isListen
            ? 'mascotBob 1.6s ease-in-out infinite'
            : isRecord
              ? 'mascotHype 0.8s ease-in-out infinite'
              : isCountdown
                ? 'mascotBounce 0.4s ease-in-out infinite'
                : 'none'
        }}
      >
        <img
          src={parrotLogo}
          alt="Parrot Party Mascot"
          style={{
            width: '90%',
            height: '90%',
            objectFit: 'contain',
            filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.18))'
          }}
          onError={(e) => {
            e.currentTarget.src = `${import.meta.env.BASE_URL}images/parrot-party.png`;
          }}
        />

        {/* DJ Headphones SVG Overlay for LISTEN phase */}
        {isListen && (
          <svg
            viewBox="0 0 40 40"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              filter: 'drop-shadow(0 2px 4px rgba(108, 99, 255, 0.5))'
            }}
          >
            {/* Headphone Arch */}
            <path
              d="M 8 20 A 12 12 0 0 1 32 20"
              fill="none"
              stroke="#6c63ff"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            {/* Left Ear Cushion */}
            <rect x="5" y="16" width="6" height="11" rx="3" fill="#ec4899" stroke="#be185d" strokeWidth="1" />
            {/* Right Ear Cushion */}
            <rect x="29" y="16" width="6" height="11" rx="3" fill="#ec4899" stroke="#be185d" strokeWidth="1" />
          </svg>
        )}
      </div>

      {/* Mini Badge Icon at bottom corner */}
      <div
        style={{
          position: 'absolute',
          bottom: -1,
          right: -1,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: isListen ? '#8b5cf6' : isRecord ? '#f43f5e' : '#10b981',
          border: '2px solid #ffffff',
          boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.62rem',
          zIndex: 2,
          color: '#ffffff',
          fontWeight: 800
        }}
      >
        {isListen ? (
          <IconHeadphones size={10} color="#ffffff" />
        ) : isRecord ? (
          <IconMic size={10} color="#ffffff" />
        ) : (
          <IconSparkles size={10} color="#ffffff" />
        )}
      </div>

      {/* Optional Comic Speech Bubble */}
      {showBubble && bubbleText && (
        <div className="mascot-speech-bubble">
          {bubbleText}
        </div>
      )}
    </div>
  );
}
