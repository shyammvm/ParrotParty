import React, { useState } from 'react';
import { PlayerAvatar } from '../utils/avatarUtils';
import tintomLogo from '../assets/tintom.png';

export default function Header({ roomState, myPlayerId, onOpenSettings }) {
  const [copied, setCopied] = useState(false);

  const copyRoomLink = () => {
    if (!roomState?.roomId) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${roomState.roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const myPlayer = roomState?.players?.find(p => p.id === myPlayerId);

  return (
    <header className="card" style={{ padding: '0.8rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img
            src={tintomLogo}
            alt="TinTom Simulator Logo"
            onError={(e) => {
              e.currentTarget.src = `${import.meta.env.BASE_URL}images/tintom.png`;
            }}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              objectFit: 'cover',
              objectPosition: 'top center',
              boxShadow: '0 3px 10px rgba(244,132,95,0.35)',
              border: '2px solid rgba(255, 255, 255, 0.8)',
              flexShrink: 0
            }}
          />
          <div>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.3rem',
              fontWeight: 700,
              lineHeight: 1.1,
              color: 'var(--text-main)',
              letterSpacing: '0.01em'
            }}>
              TinTom Simulator
            </h1>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Party Voice Imitation Game
            </span>
          </div>
        </div>

        {/* Room info & audio controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          {roomState?.roomId && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: 'var(--bg-card-2)', padding: '0.35rem 0.8rem',
              borderRadius: '20px', border: '1.5px solid var(--border-color)'
            }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>ROOM</span>
              <strong style={{ fontSize: '0.95rem', letterSpacing: '2px', color: 'var(--primary)', fontFamily: 'var(--font-display)' }}>
                {roomState.roomId}
              </strong>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginLeft: '0.15rem' }}>
                ({roomState.players?.length || 0}/10)
              </span>
            </div>
          )}

          {roomState?.roomId && (
            <button
              className="btn btn-secondary"
              onClick={copyRoomLink}
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
            >
              {copied ? 'Copied!' : 'Share Link'}
            </button>
          )}

          {/* Universal Mic Settings Button */}
          {onOpenSettings && (
            <button
              className="btn btn-secondary"
              onClick={onOpenSettings}
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
              title="Universal Microphone & Audio Settings"
            >
              🎙️ Mic Setup
            </button>
          )}

          {myPlayer && (
            <PlayerAvatar name={myPlayer.name} avatar={myPlayer.avatar} size={34} />
          )}
        </div>
      </div>
    </header>
  );
}
