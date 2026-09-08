import React, { useState, useEffect } from 'react';
import { PlayerAvatar } from '../utils/avatarUtils';
import { peerManager } from '../utils/peerManager';
import tintomLogo from '../assets/tintom.png';

export default function Header({ roomState, myPlayerId, onOpenSettings }) {
  const [copied, setCopied] = useState(false);
  const [connStatus, setConnStatus] = useState(() => peerManager.getConnectionStatus());

  useEffect(() => {
    const unsub = peerManager.onConnectionStatus((status) => {
      setConnStatus(status);
    });
    return () => unsub();
  }, []);

  const handleManualReconnect = () => {
    if (!roomState?.isHost) {
      peerManager.reconnectToHost();
    } else {
      peerManager.broadcastState();
    }
  };

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

        {/* Room info, connection badge & audio controls */}
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

          {/* Real-time Connection Status Indicator */}
          {roomState?.roomId && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.3rem 0.65rem',
                borderRadius: '20px',
                background:
                  connStatus === 'connected'
                    ? 'rgba(16, 185, 129, 0.12)'
                    : connStatus === 'reconnecting'
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                color:
                  connStatus === 'connected'
                    ? '#10b981'
                    : connStatus === 'reconnecting'
                    ? '#f59e0b'
                    : '#ef4444',
                border: `1.5px solid ${
                  connStatus === 'connected'
                    ? 'rgba(16, 185, 129, 0.35)'
                    : connStatus === 'reconnecting'
                    ? 'rgba(245, 158, 11, 0.45)'
                    : 'rgba(239, 68, 68, 0.45)'
                }`
              }}
              title={
                connStatus === 'connected'
                  ? 'Real-time connection is live & synced'
                  : 'Reconnecting to game host...'
              }
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background:
                    connStatus === 'connected'
                      ? '#10b981'
                      : connStatus === 'reconnecting'
                      ? '#f59e0b'
                      : '#ef4444',
                  boxShadow:
                    connStatus === 'connected'
                      ? '0 0 6px #10b981'
                      : '0 0 6px #f59e0b',
                  animation:
                    connStatus !== 'connected' ? 'pulseYellow 1.5s infinite' : 'none'
                }}
              />
              <span>
                {connStatus === 'connected'
                  ? 'Synced'
                  : connStatus === 'reconnecting'
                  ? 'Reconnecting...'
                  : 'Disconnected'}
              </span>

              {connStatus !== 'connected' && !roomState.isHost && (
                <button
                  onClick={handleManualReconnect}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '0 0.2rem',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontSize: '0.68rem',
                    fontWeight: 800
                  }}
                >
                  Retry
                </button>
              )}
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
