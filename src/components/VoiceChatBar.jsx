import React, { useState, useEffect } from 'react';
import { voiceChatManager } from '../utils/voiceChatManager';
import { PlayerAvatar } from '../utils/avatarUtils';
import { IconMic, IconMicOff, IconVolumeMute, IconHeadphones, IconRefresh, IconSettings } from './Icons';

export default function VoiceChatBar({ roomState, onOpenSettings }) {
  const [voiceState, setVoiceState] = useState(() => ({
    isAutoMuted: false,
    autoMuteReasons: [],
    isManuallyMuted: false,
    isManuallyDeafened: false,
    effectiveMuted: false,
    effectiveDeafened: false,
    connectedPeersCount: 0,
    speakingMap: {}
  }));

  useEffect(() => {
    const unsubscribe = voiceChatManager.subscribe((newState) => {
      setVoiceState(newState);
    });
    return () => unsubscribe();
  }, []);

  if (!roomState?.roomId) return null;

  const players = roomState.players || [];
  const myPlayerId = roomState.myPlayerId;
  const { isAutoMuted, effectiveMuted, effectiveDeafened, speakingMap } = voiceState;

  return (
    <div className="voice-chat-bar card" style={{
      padding: '0.45rem 1rem',
      marginBottom: '1rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: '0.75rem',
      background: 'var(--bg-card)',
      border: '1.5px solid var(--border-color)',
      transition: 'all 0.25s ease'
    }}>
      {/* Left: Status Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <div style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: effectiveMuted ? '#f59e0b' : '#10b981',
          boxShadow: effectiveMuted ? '0 0 6px #f59e0b' : '0 0 8px #10b981',
          animation: !effectiveMuted ? 'pulseGreen 2s infinite' : 'none'
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={{
            fontSize: '0.82rem',
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'var(--text-main)'
          }}>
            Voice Chat Active
          </span>

          {/* Live bouncing mini equalizer bars */}
          {!effectiveMuted && (
            <div
              title="Live microphone input activity"
              style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 14, padding: '0 2px' }}
            >
              {[0.4, 0.8, 1.0, 0.6].map((scale, i) => {
                const h = Math.max(3, Math.min(14, Math.round(((voiceState.localVolumeLevel || 0) * scale * 0.14) + 2)));
                const isActive = (voiceState.localVolumeLevel || 0) > 12;
                return (
                  <div
                    key={i}
                    style={{
                      width: 3,
                      height: `${h}px`,
                      background: isActive ? '#10b981' : 'var(--text-muted)',
                      borderRadius: 2,
                      transition: 'height 0.05s ease, background 0.1s ease'
                    }}
                  />
                );
              })}
            </div>
          )}

          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            ({players.length} in room)
          </span>
        </div>
      </div>

      {/* Middle: Player speaking status indicators */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {players.map((p) => {
          const isSpeaking = Boolean(speakingMap[p.id] || speakingMap[p.peerId]);
          const isMe = p.id === myPlayerId;

          return (
            <div
              key={p.id}
              style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px',
                borderRadius: '50%',
                transition: 'all 0.12s ease',
                boxShadow: isSpeaking ? '0 0 0 3px #10b981, 0 0 14px rgba(16, 185, 129, 0.85)' : 'none',
                transform: isSpeaking ? 'scale(1.12)' : 'scale(1)',
                zIndex: isSpeaking ? 2 : 1
              }}
              title={`${p.name}${isMe ? ' (You)' : ''}${isSpeaking ? ' - Speaking' : ''}`}
            >
              <PlayerAvatar name={p.name} avatar={p.avatar} size={28} />
              {isSpeaking && (
                <span style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  background: '#10b981',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 14,
                  height: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                  animation: 'pulseGreen 1.2s infinite'
                }}>
                  <IconMic size={9} />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Right: Quick Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {/* Mute toggle */}
        <button
          className="btn"
          onClick={() => voiceChatManager.toggleMute()}
          style={{
            padding: '0.35rem 0.75rem',
            fontSize: '0.78rem',
            fontWeight: 700,
            background: effectiveMuted ? '#ef4444' : 'var(--bg-card-2)',
            color: effectiveMuted ? '#ffffff' : 'var(--text-main)',
            border: effectiveMuted ? '1.5px solid #dc2626' : '1.5px solid var(--border-color)',
            boxShadow: effectiveMuted ? '0 2px 8px rgba(239, 68, 68, 0.35)' : 'none',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            transition: 'all 0.15s ease'
          }}
          title={effectiveMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {effectiveMuted ? <IconMicOff size={14} /> : <IconMic size={14} />}
          <span>{effectiveMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        {/* Deafen toggle */}
        <button
          className="btn"
          onClick={() => voiceChatManager.toggleDeafen()}
          style={{
            padding: '0.35rem 0.75rem',
            fontSize: '0.78rem',
            fontWeight: 700,
            background: effectiveDeafened ? '#ef4444' : 'var(--bg-card-2)',
            color: effectiveDeafened ? '#ffffff' : 'var(--text-main)',
            border: effectiveDeafened ? '1.5px solid #dc2626' : '1.5px solid var(--border-color)',
            boxShadow: effectiveDeafened ? '0 2px 8px rgba(239, 68, 68, 0.35)' : 'none',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            transition: 'all 0.15s ease'
          }}
          title={effectiveDeafened ? 'Undeafen voice chat' : 'Deafen voice chat (mute all audio)'}
        >
          {effectiveDeafened ? <IconVolumeMute size={14} /> : <IconHeadphones size={14} />}
          <span>{effectiveDeafened ? 'Undeafen' : 'Deafen'}</span>
        </button>

        {/* Reconnect Mesh button if players exist but no active audio connection */}
        {players.length > 1 && voiceState.connectedPeersCount === 0 && (
          <button
            className="btn"
            onClick={() => voiceChatManager.refreshMesh()}
            style={{
              padding: '0.35rem 0.65rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              background: 'rgba(245, 158, 11, 0.15)',
              color: '#f59e0b',
              border: '1.5px solid rgba(245, 158, 11, 0.4)',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
            title="Retry voice chat connection"
          >
            <IconRefresh size={13} /> Reconnect
          </button>
        )}

        {/* Settings button */}
        <button
          className="btn btn-secondary"
          onClick={onOpenSettings}
          style={{
            padding: '0.35rem 0.75rem',
            fontSize: '0.8rem',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem'
          }}
          title="Microphone & Audio Settings"
        >
          <IconSettings size={13} /> Audio
        </button>
      </div>
    </div>
  );
}
