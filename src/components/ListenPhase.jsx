import React, { useState, useRef, useEffect } from 'react';
import { playAudioDataUrl, stopCurrentAudio } from '../utils/audioPlayer';
import { getAudioContext } from '../utils/audioAnalyzer';
import { voiceChatManager } from '../utils/voiceChatManager';
import { peerManager } from '../utils/peerManager';
import { PlayerAvatar } from '../utils/avatarUtils';
import WaveformDisplay from './WaveformDisplay';
import { IconPlay, IconVolume, IconLock, IconCheck, IconHeadphones, IconMic, IconClock } from './Icons';

const LISTEN_TIME_LIMIT = 30; // 30 seconds timer limit

export default function ListenPhase({ roomState, onStartRecordingPhase }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(LISTEN_TIME_LIMIT);

  const animFrameRef = useRef(null);
  const startTimeRef = useRef(null);
  const localStartMsRef = useRef(Date.now());

  const isHost = roomState?.isHost;
  const myPlayerId = roomState?.myPlayerId;
  const players = roomState?.players || [];
  const currentSoundIndex = roomState?.currentSoundIndex || 0;
  const soundPack = roomState?.soundPack || [];
  const currentSound = soundPack[currentSoundIndex] || soundPack[0];
  const totalSounds = soundPack.length || 5;

  const bars = currentSound?.waveformBars || [];
  const duration = currentSound?.duration || 3;

  const listenPhaseStartTime = roomState?.listenPhaseStartTime;
  const listenReadyMap = roomState?.listenReadyMap || {};

  const isMyPlayerReady = Boolean(listenReadyMap[myPlayerId]);
  const isPlaybackDeactivated = isMyPlayerReady || timeLeft <= 0;

  const readyPlayersCount = players.filter(p => Boolean(listenReadyMap[p.id])).length;
  const allReady = players.length > 0 && players.every(p => Boolean(listenReadyMap[p.id]));

  // Reset state on sound change
  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);
    localStartMsRef.current = Date.now();
    setTimeLeft(LISTEN_TIME_LIMIT);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);

    return () => {
      stopCurrentAudio();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);
    };
  }, [currentSoundIndex]);

  // Mark player as ready & deactivate playback
  const handleMarkReady = () => {
    if (isMyPlayerReady) return;

    // Immediately stop audio if currently playing
    stopCurrentAudio();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setIsPlaying(false);
    voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);

    // Sync ready state across room
    peerManager.setListenReady(true);
  };

  // 30-second countdown ticker
  useEffect(() => {
    const checkTimer = () => {
      const effectiveStart = listenPhaseStartTime || localStartMsRef.current;
      const elapsed = Math.max(0, (Date.now() - effectiveStart) / 1000);
      const remaining = Math.max(0, Math.ceil(LISTEN_TIME_LIMIT - elapsed));
      setTimeLeft(remaining);

      if (remaining <= 0) {
        // Whichever reaches first (30s timer or ready button) deactivates playback
        stopCurrentAudio();
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        setIsPlaying(false);
        voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);

        // Auto-mark player as ready when timer ends
        if (!isMyPlayerReady) {
          peerManager.setListenReady(true);
        }
      }
    };

    checkTimer();
    const interval = setInterval(checkTimer, 250);
    return () => clearInterval(interval);
  }, [listenPhaseStartTime, isMyPlayerReady]);

  const playDemoSound = async () => {
    const demoSource = currentSound?.targetAudioUrl || currentSound?.soundUrl;
    if (!demoSource || isPlaying || isPlaybackDeactivated) return;

    setIsPlaying(true);
    setProgress(0);
    voiceChatManager.setAutoMuted('DEMO_PLAYBACK', true);

    const audioCtx = getAudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    startTimeRef.current = audioCtx.currentTime;
    const animateCursor = () => {
      const elapsed = audioCtx.currentTime - startTimeRef.current;
      const pct = Math.min(1, elapsed / duration);
      setProgress(pct);
      if (pct < 1) animFrameRef.current = requestAnimationFrame(animateCursor);
    };
    animFrameRef.current = requestAnimationFrame(animateCursor);

    try {
      await playAudioDataUrl(demoSource);
    } catch (err) {
      console.error('Play error:', err);
    } finally {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setProgress(1);
      setIsPlaying(false);
      voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);
    }
  };

  const handleStartRecordingRound = () => {
    if (!allReady) return;

    stopCurrentAudio();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setProgress(0);
    setIsPlaying(false);
    voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);

    onStartRecordingPhase();
  };

  // Timer color states
  const isUrgent = timeLeft <= 5;
  const isWarning = timeLeft <= 10 && !isUrgent;
  const timerBadgeColor = isUrgent
    ? 'var(--accent)'
    : isWarning
      ? 'var(--warning)'
      : 'var(--primary)';

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      {/* Progress pill */}
      <div style={{
        display: 'inline-block', padding: '0.25rem 0.9rem',
        background: 'rgba(244,132,95,0.1)', border: '1.5px solid rgba(244,132,95,0.35)',
        borderRadius: '20px', fontSize: '0.78rem', color: 'var(--primary)',
        fontWeight: 700, marginBottom: '1rem', fontFamily: 'var(--font-display)',
        letterSpacing: '0.03em'
      }}>
        SOUND {currentSoundIndex + 1} OF {totalSounds}
      </div>

      <h2 style={{
        fontFamily: 'var(--font-display)', fontSize: '1.8rem',
        fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-main)'
      }}>
        {currentSound?.title || ''}
      </h2>
      <p className="card-subtitle" style={{ marginBottom: '1.25rem' }}>
        Listen carefully — practice your mimic before the timer runs out!
      </p>

      {/* ── 30-Second Listening Timer Bar ── */}
      <div style={{
        background: 'var(--bg-card-2)',
        border: `1.5px solid ${isUrgent ? 'rgba(255,107,107,0.4)' : 'var(--border-color)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: '0.85rem 1.1rem',
        marginBottom: '1.25rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)' }}>
            ⏱️ Listening Time Remaining
          </span>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1rem',
            fontWeight: 800,
            color: timerBadgeColor,
            background: isUrgent ? 'rgba(255,107,107,0.15)' : 'rgba(255,255,255,0.06)',
            padding: '0.15rem 0.6rem',
            borderRadius: '12px',
            border: `1px solid ${timerBadgeColor}`,
            animation: isUrgent ? 'pulse 1s infinite' : 'none'
          }}>
            {timeLeft > 0 ? `${timeLeft}s` : 'Time Expired'}
          </span>
        </div>

        {/* Visual countdown track */}
        <div style={{
          width: '100%',
          height: '6px',
          background: 'rgba(255,255,255,0.08)',
          borderRadius: '3px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${Math.max(0, Math.min(100, (timeLeft / LISTEN_TIME_LIMIT) * 100))}%`,
            height: '100%',
            background: isUrgent
              ? 'linear-gradient(90deg, #ff6b6b, #ff8787)'
              : 'linear-gradient(90deg, var(--primary), var(--secondary))',
            transition: 'width 0.25s linear'
          }} />
        </div>

        <div style={{ marginTop: '0.45rem', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          {isPlaybackDeactivated ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <IconLock size={13} /> Playback locked — ready to record!
            </span>
          ) : (
            'Pressing "Ready" or reaching 0s locks playback.'
          )}
        </div>
      </div>

      {/* Waveform panel */}
      <div style={{
        background: 'var(--bg-card-2)',
        border: '1.5px solid var(--border-color)',
        borderRadius: 'var(--radius-sm)',
        padding: '1rem',
        marginBottom: '1.25rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>
          <span>TARGET WAVEFORM</span>
          <span>{duration.toFixed(1)}s</span>
        </div>
        <WaveformDisplay
          bars={bars}
          progress={progress}
          color="#f4845f"
          height={90}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
          <span>0s</span>
          <span>{(duration / 2).toFixed(1)}s</span>
          <span>{duration.toFixed(1)}s</span>
        </div>
      </div>

      {/* ── Play Demo & Ready Action Buttons ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '0.85rem',
        flexWrap: 'wrap',
        marginBottom: '1.25rem'
      }}>
        {/* Play button */}
        <button
          className="btn btn-primary"
          onClick={playDemoSound}
          disabled={isPlaying || isPlaybackDeactivated}
          style={{
            padding: '0.85rem 1.8rem',
            fontSize: '1rem',
            opacity: isPlaybackDeactivated ? 0.45 : 1,
            cursor: isPlaybackDeactivated ? 'not-allowed' : 'pointer'
          }}
          title={isPlaybackDeactivated ? 'Playback deactivated because ready status was set' : 'Play audio'}
        >
          {isPlaying ? (
            <>
              <IconVolume size={18} /> Playing Target Demo...
            </>
          ) : isPlaybackDeactivated ? (
            <>
              <IconLock size={17} /> Playback Locked
            </>
          ) : (
            <>
              <IconPlay size={18} fill="currentColor" /> Play Demo Sound
            </>
          )}
        </button>

        {/* Ready button */}
        <button
          className={isMyPlayerReady ? 'btn btn-secondary' : 'btn btn-success'}
          onClick={handleMarkReady}
          disabled={isMyPlayerReady}
          style={{
            padding: '0.85rem 1.8rem',
            fontSize: '1rem',
            background: isMyPlayerReady ? 'rgba(74, 222, 128, 0.2)' : undefined,
            color: isMyPlayerReady ? '#4ade80' : undefined,
            border: isMyPlayerReady ? '1.5px solid #4ade80' : undefined,
            cursor: isMyPlayerReady ? 'default' : 'pointer',
            boxShadow: !isMyPlayerReady ? '0 0 16px rgba(74, 222, 128, 0.35)' : 'none'
          }}
        >
          {isMyPlayerReady ? (
            <>
              <IconCheck size={18} /> Ready
            </>
          ) : (
            <>
              <IconCheck size={18} /> I'm Ready
            </>
          )}
        </button>
      </div>

      {/* ── Player Readiness Roster ── */}
      <div style={{
        background: 'var(--bg-card-2)',
        border: '1.5px solid var(--border-color)',
        borderRadius: 'var(--radius-sm)',
        padding: '0.75rem 1rem',
        marginBottom: '1.25rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>
            PLAYER STATUS
          </span>
          <span style={{
            fontSize: '0.78rem',
            fontWeight: 800,
            color: allReady ? 'var(--secondary)' : 'var(--primary)'
          }}>
            {readyPlayersCount} / {players.length} Ready
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {players.map(p => {
            const isReady = Boolean(listenReadyMap[p.id]);
            const isMe = p.id === myPlayerId;
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.3rem 0.65rem',
                  borderRadius: '20px',
                  background: isReady ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1.5px solid ${isReady ? 'rgba(74, 222, 128, 0.4)' : 'rgba(255,255,255,0.1)'}`,
                  fontSize: '0.8rem'
                }}
              >
                <PlayerAvatar name={p.name} avatar={p.avatar} size={22} />
                <span style={{ fontWeight: 600 }}>{p.name} {isMe ? '(you)' : ''}</span>
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.2rem',
                  color: isReady ? '#4ade80' : 'var(--text-muted)'
                }}>
                  {isReady ? <IconCheck size={14} /> : <IconHeadphones size={14} />}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Host & Client Action Row ── */}
      {isHost ? (
        <div>
          <button
            className={allReady ? 'btn btn-accent' : 'btn btn-secondary'}
            onClick={handleStartRecordingRound}
            disabled={!allReady}
            style={{
              width: '100%',
              padding: '0.95rem',
              fontSize: '1.05rem',
              fontWeight: 800,
              cursor: allReady ? 'pointer' : 'not-allowed',
              opacity: allReady ? 1 : 0.65,
              boxShadow: allReady ? '0 0 24px rgba(245, 158, 11, 0.4)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            {allReady ? (
              <>
                <IconMic size={18} /> Start Recording Round (All Players Ready!)
              </>
            ) : (
              <>
                <IconClock size={18} /> Waiting for Players ({readyPlayersCount}/{players.length} Ready)
              </>
            )}
          </button>
          {!allReady && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontWeight: 600 }}>
              Button will activate once all players click Ready or 30s timer finishes.
            </p>
          )}
        </div>
      ) : (
        <div style={{
          padding: '0.85rem 1.25rem',
          background: 'var(--bg-card-2)', borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--border-color)',
          color: allReady ? 'var(--secondary)' : 'var(--text-muted)',
          fontWeight: 700, fontSize: '0.88rem'
        }}>
          {allReady ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', justifyContent: 'center' }}>
              <IconCheck size={16} color="#4ade80" /> All players ready! Waiting for host to start recording...
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', justifyContent: 'center' }}>
              <IconHeadphones size={16} /> Listening &amp; practicing... ({readyPlayersCount} / {players.length} players ready)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
