import React, { useState, useRef, useEffect } from 'react';
import { playAudioDataUrl, stopCurrentAudio } from '../utils/audioPlayer';
import { getAudioContext } from '../utils/audioAnalyzer';
import { voiceChatManager } from '../utils/voiceChatManager';
import { peerManager } from '../utils/peerManager';
import { PlayerAvatar } from '../utils/avatarUtils';
import WaveformDisplay from './WaveformDisplay';
import PhaseIntroOverlay from './PhaseIntroOverlay';
import { IconPlay, IconVolume, IconLock, IconCheck, IconHeadphones, IconMic, IconClock, IconReplay } from './Icons';

const LISTEN_TIME_LIMIT = 30; // 30 seconds timer limit

export default function ListenPhase({ roomState, onStartRecordingPhase }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(LISTEN_TIME_LIMIT);
  const [showIntro, setShowIntro] = useState(true);

  const animFrameRef = useRef(null);
  const startTimeRef = useRef(null);
  const localStartMsRef = useRef(Date.now());
  const isPlayingRef = useRef(false);
  const hasAutoStartedRef = useRef(false);
  const [countdownToStart, setCountdownToStart] = useState(null);

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

  const playDemoSound = async () => {
    const demoSource = currentSound?.targetAudioUrl || currentSound?.soundUrl;
    if (!demoSource || isPlayingRef.current || isPlaybackDeactivated || roomState?.isPaused) return;

    isPlayingRef.current = true;
    setIsPlaying(true);
    setProgress(0);
    voiceChatManager.setAutoMuted('DEMO_PLAYBACK', true);

    const audioCtx = getAudioContext();
    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
      } catch (e) { }
    }

    startTimeRef.current = audioCtx.currentTime;
    const animateCursor = () => {
      const elapsed = audioCtx.currentTime - startTimeRef.current;
      const pct = Math.min(1, elapsed / duration);
      setProgress(pct);
      if (pct < 1 && isPlayingRef.current) {
        animFrameRef.current = requestAnimationFrame(animateCursor);
      }
    };
    animFrameRef.current = requestAnimationFrame(animateCursor);

    try {
      await playAudioDataUrl(demoSource);
    } catch (err) {
      console.error('Play error:', err);
    } finally {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setProgress(1);
      isPlayingRef.current = false;
      setIsPlaying(false);
      voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);
    }
  };

  const handleIntroComplete = () => {
    setShowIntro(false);
    if (!isPlaybackDeactivated && !roomState?.isPaused) {
      playDemoSound();
    }
  };

  // Reset state on sound change & show round intro
  useEffect(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    setProgress(0);
    localStartMsRef.current = Date.now();
    setTimeLeft(LISTEN_TIME_LIMIT);
    setShowIntro(true);
    hasAutoStartedRef.current = false;
    setCountdownToStart(null);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);

    return () => {
      stopCurrentAudio();
      isPlayingRef.current = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);
    };
  }, [currentSoundIndex, currentSound?.title]);

  // Stop playback immediately if game is paused
  useEffect(() => {
    if (roomState?.isPaused) {
      stopCurrentAudio();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      isPlayingRef.current = false;
      setIsPlaying(false);
      voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);
    }
  }, [roomState?.isPaused]);

  // Mark player as ready & deactivate playback
  const handleMarkReady = () => {
    if (isMyPlayerReady) return;

    // Immediately stop audio if currently playing
    stopCurrentAudio();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    isPlayingRef.current = false;
    setIsPlaying(false);
    voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);

    // Sync ready state across room
    peerManager.setListenReady(true);
  };

  // 30-second countdown ticker (freezes if paused, begins after 2.4s intro finishes)
  useEffect(() => {
    const checkTimer = () => {
      if (roomState?.isPaused) return;

      const baseStart = listenPhaseStartTime || localStartMsRef.current;
      const effectiveStart = baseStart + 1800;
      const now = Date.now();
      if (now < effectiveStart) {
        setTimeLeft(LISTEN_TIME_LIMIT);
        return;
      }

      const elapsed = Math.max(0, (now - effectiveStart) / 1000);
      const remaining = Math.max(0, Math.ceil(LISTEN_TIME_LIMIT - elapsed));
      setTimeLeft(remaining);

      if (remaining <= 0) {
        // Whichever reaches first (30s timer or ready button) deactivates playback
        stopCurrentAudio();
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        isPlayingRef.current = false;
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
  }, [listenPhaseStartTime, isMyPlayerReady, roomState?.isPaused]);

  const handleStartRecordingRound = () => {
    hasAutoStartedRef.current = true;

    stopCurrentAudio();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    isPlayingRef.current = false;
    setProgress(0);
    setIsPlaying(false);
    voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);

    onStartRecordingPhase();
  };

  // Host sets 5-second countdown timestamp when all players become ready
  useEffect(() => {
    if (!isHost || !allReady || hasAutoStartedRef.current) return;

    if (!roomState?.recordingCountdownEndTime) {
      peerManager.updateRoomState({
        recordingCountdownEndTime: Date.now() + 5000
      });
    }
  }, [isHost, allReady, roomState?.recordingCountdownEndTime]);

  // Synchronized 5-second countdown ticker for all players
  useEffect(() => {
    if (!allReady) {
      setCountdownToStart(null);
      return;
    }

    const checkCountdown = () => {
      const endTime = roomState?.recordingCountdownEndTime;
      const now = Date.now();
      let remaining = 5;
      if (endTime) {
        remaining = Math.max(0, Math.ceil((endTime - now) / 1000));
      }
      setCountdownToStart(remaining);

      if (remaining <= 0 && isHost && !hasAutoStartedRef.current) {
        hasAutoStartedRef.current = true;
        handleStartRecordingRound();
      }
    };

    checkCountdown();
    const interval = setInterval(checkCountdown, 200);
    return () => clearInterval(interval);
  }, [allReady, roomState?.recordingCountdownEndTime, isHost]);

  // Timer color states (high contrast)
  const isUrgent = timeLeft <= 5;
  const isWarning = timeLeft <= 10 && !isUrgent;
  const timerBadgeColor = isUrgent
    ? '#dc2626'
    : isWarning
      ? '#b45309'
      : '#c2410c';
  const timerBadgeBg = isUrgent
    ? 'rgba(239, 68, 68, 0.12)'
    : isWarning
      ? 'rgba(245, 158, 11, 0.12)'
      : 'rgba(244, 132, 95, 0.12)';

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
            background: timerBadgeBg,
            padding: '0.15rem 0.65rem',
            borderRadius: '12px',
            border: `1.5px solid ${timerBadgeColor}`,
            animation: isUrgent ? 'pulse 1s infinite' : 'none'
          }}>
            {timeLeft > 0 ? `${timeLeft}s` : 'Time Expired'}
          </span>
        </div>

        {/* Visual countdown track */}
        <div style={{
          width: '100%',
          height: '7px',
          background: 'var(--border-color)',
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${Math.max(0, Math.min(100, (timeLeft / LISTEN_TIME_LIMIT) * 100))}%`,
            height: '100%',
            background: isUrgent
              ? 'linear-gradient(90deg, #dc2626, #ef4444)'
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
        {/* Replay Demo Sound button */}
        <button
          className="btn btn-secondary"
          onClick={playDemoSound}
          disabled={isPlaying || isPlaybackDeactivated || roomState?.isPaused}
          style={{
            padding: '0.85rem 1.8rem',
            fontSize: '1rem',
            opacity: (isPlaybackDeactivated || roomState?.isPaused) ? 0.45 : 1,
            cursor: (isPlaybackDeactivated || roomState?.isPaused) ? 'not-allowed' : 'pointer',
            border: isPlaying ? '1.5px solid var(--primary)' : undefined,
            color: isPlaying ? 'var(--primary)' : undefined
          }}
          title={
            roomState?.isPaused
              ? 'Game is currently paused'
              : isPlaybackDeactivated
                ? 'Playback deactivated because ready status was set'
                : 'Replay'
          }
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
              <IconReplay size={18} /> Replay
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
                  padding: '0.35rem 0.75rem',
                  borderRadius: '20px',
                  background: isReady ? 'rgba(61, 191, 123, 0.15)' : 'var(--bg-card)',
                  border: `1.5px solid ${isReady ? '#3dbf7b' : 'var(--border-color)'}`,
                  fontSize: '0.82rem',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.05)'
                }}
              >
                <PlayerAvatar name={p.name} avatar={p.avatar} size={22} />
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{p.name} {isMe ? '(you)' : ''}</span>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.2rem',
                  color: isReady ? '#166534' : 'var(--text-muted)'
                }}>
                  {isReady ? <IconCheck size={14} color="#166534" /> : <IconHeadphones size={14} />}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Host & Client Action Status Area (High Contrast) ── */}
      {allReady ? (
        <div style={{
          padding: '1.1rem 1.5rem',
          background: 'linear-gradient(135deg, #ea580c, #f97316)',
          borderRadius: 'var(--radius-sm)',
          border: '2px solid #c2410c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.85rem',
          boxShadow: '0 6px 24px rgba(234, 88, 12, 0.35)',
          animation: 'popIn 0.3s ease-out'
        }}>
          <span style={{
            fontSize: '1.4rem',
            fontWeight: 900,
            color: '#c2410c',
            fontFamily: 'var(--font-display)',
            background: '#ffffff',
            padding: '0.25rem 0.85rem',
            borderRadius: '14px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '50px',
            animation: 'pulse 1s infinite'
          }}>
            {countdownToStart !== null ? `${countdownToStart}s` : '5s'}
          </span>
          <span style={{
            fontSize: '1.1rem',
            fontWeight: 800,
            color: '#ffffff',
            textShadow: '0 1px 3px rgba(0,0,0,0.3)',
            letterSpacing: '0.01em'
          }}>
            All players ready! Recording starts in {countdownToStart !== null ? `${countdownToStart}s` : '5s'}...
          </span>
        </div>
      ) : (
        <div style={{
          padding: '0.9rem 1.3rem',
          background: 'var(--bg-card-2)',
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--border-color)',
          color: 'var(--text-main)',
          fontWeight: 700,
          fontSize: '0.92rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem'
        }}>
          {isHost ? (
            <>
              <IconClock size={16} color="var(--primary)" />
              <span>Waiting for players (<strong style={{ color: 'var(--primary)' }}>{readyPlayersCount} / {players.length}</strong> ready)...</span>
            </>
          ) : (
            <>
              <IconHeadphones size={16} color="var(--secondary)" />
              <span>Listening &amp; practicing... (<strong style={{ color: 'var(--secondary)' }}>{readyPlayersCount} / {players.length}</strong> players ready)</span>
            </>
          )}
        </div>
      )}

      {showIntro && (
        <PhaseIntroOverlay
          type="ROUND_START"
          roundNumber={currentSoundIndex + 1}
          durationMs={1800}
          onComplete={handleIntroComplete}
        />
      )}
    </div>
  );
}
