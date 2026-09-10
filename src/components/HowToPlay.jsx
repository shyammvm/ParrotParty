import React from 'react';
import ParrotMascot from './ParrotMascot';
import { IconArrowRight, IconHeadphones, IconMic, IconTrophy } from './Icons';

export default function HowToPlay({ onBack }) {
  const steps = [
    {
      num: '1',
      title: 'Listen',
      desc: 'Everyone hears an iconic movie quote or funny sound clip.',
      icon: <IconHeadphones size={22} color="#8b5cf6" />,
      bg: 'rgba(139, 92, 246, 0.12)',
      border: 'rgba(139, 92, 246, 0.3)'
    },
    {
      num: '2',
      title: 'Mimic',
      desc: 'Record your best (or worst!) voice impression.',
      icon: <IconMic size={22} color="var(--primary)" />,
      bg: 'rgba(244, 132, 95, 0.12)',
      border: 'rgba(244, 132, 95, 0.3)'
    },
    {
      num: '3',
      title: 'Score & Laugh',
      desc: 'Make fun of others.',
      icon: <IconTrophy size={22} color="var(--accent)" />,
      bg: 'rgba(255, 179, 71, 0.14)',
      border: 'rgba(255, 179, 71, 0.35)'
    }
  ];

  return (
    <div className="card htp-minimal-card">
      {/* ── Top Header ── */}
      <div className="htp-minimal-header">
        <button
          type="button"
          className="btn btn-secondary htp-back-btn"
          onClick={onBack}
          title="Back to home"
        >
          <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
            <IconArrowRight size={13} />
          </span>
          <span>Back</span>
        </button>
        <ParrotMascot mode="LISTEN" size={44} />
      </div>

      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.5rem',
          fontWeight: 800,
          color: 'var(--text-main)',
          marginBottom: '0.25rem'
        }}>
          How to Play
        </h2>
        <p style={{
          fontSize: '0.88rem',
          color: 'var(--text-muted)',
          margin: 0
        }}>
          A voice-imitation party game in 3 quick steps:
        </p>
      </div>

      {/* ── 3 Quick Steps ── */}
      <div className="htp-minimal-steps">
        {steps.map((s) => (
          <div
            key={s.num}
            className="htp-minimal-step"
            style={{ borderColor: s.border }}
          >
            <div
              className="htp-minimal-step-icon"
              style={{ background: s.bg }}
            >
              {s.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: '1rem',
                color: 'var(--text-main)',
                marginBottom: '0.15rem'
              }}>
                {s.num}. {s.title}
              </div>
              <p style={{
                fontSize: '0.84rem',
                color: 'var(--text-muted)',
                lineHeight: 1.4,
                margin: 0
              }}>
                {s.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Single Pro Tip ── */}
      <div className="htp-minimal-tip">
        <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>🎧</span>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
          <strong style={{ color: 'var(--text-main)' }}>Pro Tip:</strong> Wear headphones so your mic doesn't catch background echo!
        </span>
      </div>

      {/* ── Play Button ── */}
      <button
        type="button"
        className="btn btn-primary"
        onClick={onBack}
        style={{
          width: '100%',
          padding: '0.85rem',
          fontSize: '1rem',
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.45rem'
        }}
      >
        <span>Got It, Let's Play!</span>
        <IconArrowRight size={16} />
      </button>
    </div>
  );
}
