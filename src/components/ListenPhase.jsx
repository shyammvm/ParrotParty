import React, { useState, useRef, useEffect } from 'react';
import { playAudioDataUrl, stopCurrentAudio } from '../utils/audioPlayer';
import { getAudioContext } from '../utils/audioAnalyzer';
import { voiceChatManager } from '../utils/voiceChatManager';
import { peerManager } from '../utils/peerManager';
import { PlayerAvatar } from '../utils/avatarUtils';
import WaveformDisplay from './WaveformDisplay';
import PhaseIntroOverlay from './PhaseIntroOverlay';
import ParrotMascot from './ParrotMascot';
import { IconPlay, IconVolume, IconLock, IconCheck, IconHeadphones, IconMic, IconClock, IconReplay, IconMusic, IconWaveform, IconUsers } from './Icons';

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
    <div className="card arcade-stage-card" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.42rem', padding: '0.75rem 1.1rem' }}>
      {/* ── Top Header Row: Mascot + Sound Title + Timer ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <ParrotMascot mode="LISTEN" size={44} />
          <div style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{
                padding: '0.15rem 0.6rem',
                background: 'rgba(244,132,95,0.14)',
                border: '1.5px solid rgba(244,132,95,0.45)',
                borderRadius: '20px',
                fontSize: '0.7rem',
                color: 'var(--primary)',
                fontWeight: 800,
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.04em'
              }}>
                SOUND {currentSoundIndex + 1}/{totalSounds}
              </span>
              <h2 style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.3rem',
                fontWeight: 800,
                color: 'var(--text-main)',
                margin: 0,
                lineHeight: 1.15
              }}>
                {currentSound?.title || ''}
              </h2>
            </div>
            <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {isPlaying ? (
                <>
                  <IconMusic size={13} color="#8b5cf6" />
                  <span>Groove to the demo sound!</span>
                </>
              ) : isPlaybackDeactivated ? (
                <>
                  <IconLock size={13} color="var(--warning)" />
                  <span>Playback locked — ready for mimics!</span>
                </>
              ) : (
                <>
                  <IconHeadphones size={13} color="var(--primary)" />
                  <span>Listen carefully — practice your mimic!</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* 30-Second Listening Timer Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.92rem',
            fontWeight: 800,
            color: timerBadgeColor,
            background: timerBadgeBg,
            padding: '0.18rem 0.65rem',
            borderRadius: '12px',
            border: `1.5px solid ${timerBadgeColor}`,
            animation: isUrgent ? 'pulse 1s infinite' : 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem'
          }}>
            <IconClock size={13} /> {timeLeft > 0 ? `${timeLeft}s` : '0s'}
          </span>
        </div>
      </div>

      {/* ── Sleek Progress Indicator ── */}
      <div style={{
        width: '100%',
        height: '4px',
        background: 'rgba(0,0,0,0.06)',
        borderRadius: '2px',
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

      {/* ── Glowing Waveform Stage Box (Compact 65px height) ── */}
      <div className="waveform-stage-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#7c3aed', fontWeight: 800, marginBottom: '0.2rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <IconWaveform size={13} color="#7c3aed" />
            <span>TARGET WAVEFORM</span>
          </span>
          <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>{duration.toFixed(1)}s Sound</span>
        </div>
        <WaveformDisplay
          bars={bars}
          progress={progress}
          color="#7c3aed"
          height={65}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
          <span>0s</span>
          <span>{(duration / 2).toFixed(1)}s</span>
          <span>{duration.toFixed(1)}s</span>
        </div>
      </div>

      {/* ── Action Buttons: 3D Tactile Arcade Feel ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '0.65rem',
        flexWrap: 'wrap'
      }}>
        <button
          className="btn-arcade-secondary"
          onClick={playDemoSound}
          disabled={isPlaying || isPlaybackDeactivated || roomState?.isPaused}
          style={{
            padding: '0.52rem 1.3rem',
            fontSize: '0.9rem',
            opacity: (isPlaybackDeactivated || roomState?.isPaused) ? 0.45 : 1,
            cursor: (isPlaybackDeactivated || roomState?.isPaused) ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem'
          }}
          title={
            roomState?.isPaused
              ? 'Game is currently paused'
              : isPlaybackDeactivated
                ? 'Playback deactivated'
                : 'Replay'
          }
        >
          {isPlaying ? (
            <>
              <IconVolume size={16} /> Playing Demo...
            </>
          ) : isPlaybackDeactivated ? (
            <>
              <IconLock size={15} /> Playback Locked
            </>
          ) : (
            <>
              <IconReplay size={16} /> Replay Demo
            </>
          )}
        </button>

        <button
          className={isMyPlayerReady ? 'btn btn-secondary' : 'btn-arcade-success'}
          onClick={handleMarkReady}
          disabled={isMyPlayerReady}
          style={{
            padding: '0.52rem 1.6rem',
            fontSize: '0.92rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            cursor: isMyPlayerReady ? 'default' : 'pointer'
          }}
        >
          {isMyPlayerReady ? (
            <>
              <IconCheck size={16} /> Ready
            </>
          ) : (
            <>
              <IconCheck size={16} /> Ready
            </>
          )}
        </button>
      </div>

      {/* ── Arcade Player Readiness Tokens ── */}
      <div style={{
        background: 'rgba(255, 248, 240, 0.65)',
        border: '1.5px solid rgba(232, 221, 208, 0.75)',
        borderRadius: '16px',
        padding: '0.35rem 0.65rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <IconUsers size={12} /> SQUAD STATUS
          </span>
          <span style={{
            fontSize: '0.74rem',
            fontWeight: 800,
            color: allReady ? '#16a34a' : 'var(--primary)'
          }}>
            {readyPlayersCount} / {players.length} Ready
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {players.map(p => {
            const isReady = Boolean(listenReadyMap[p.id]);
            const isMe = p.id === myPlayerId;
            return (
              <div
                key={p.id}
                className={`arcade-player-token ${isReady ? 'ready' : ''}`}
              >
                <PlayerAvatar name={p.name} avatar={p.avatar} size={18} />
                <span style={{ color: 'var(--text-main)' }}>{p.name}{isMe ? ' (you)' : ''}</span>
                {isReady ? <IconCheck size={12} color="#16a34a" /> : <IconHeadphones size={12} color="var(--text-muted)" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Countdown or Waiting Status Banner ── */}
      {allReady ? (
        <div style={{
          padding: '0.65rem 1.2rem',
          background: 'linear-gradient(135deg, #ea580c, #f97316)',
          borderRadius: 'var(--radius-sm)',
          border: '2px solid #c2410c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.55rem',
          boxShadow: '0 4px 18px rgba(234, 88, 12, 0.35)',
          animation: 'popIn 0.3s ease-out'
        }}>
          <span style={{
            fontSize: '1.15rem',
            fontWeight: 900,
            color: '#ffffff',
            letterSpacing: '0.02em',
            fontFamily: 'var(--font-display)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem'
          }}>
            Recording starts in{' '}
            <span style={{
              display: 'inline-block',
              fontSize: '1.5rem',
              fontWeight: 900,
              minWidth: '1.2ch',
              textAlign: 'center',
              color: '#ffffff',
              textShadow: '0 2px 8px rgba(0,0,0,0.25)',
              animation: 'popIn 0.25s ease-out'
            }}>
              {countdownToStart !== null ? countdownToStart : 5}
            </span>
          </span>
        </div>
      ) : (
        <div style={{
          padding: '0.45rem 0.8rem',
          background: 'var(--bg-card-2)',
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--border-color)',
          color: 'var(--text-main)',
          fontWeight: 700,
          fontSize: '0.8rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.4rem'
        }}>
          {isHost ? (
            <>
              <IconClock size={14} color="var(--primary)" />
              <span>Waiting for players (<strong style={{ color: 'var(--primary)' }}>{readyPlayersCount} / {players.length}</strong> ready)...</span>
            </>
          ) : (
            <>
              <IconHeadphones size={14} color="var(--secondary)" />
              <span>Listening &amp; practicing... (<strong style={{ color: 'var(--secondary)' }}>{readyPlayersCount} / {players.length}</strong> ready)</span>
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
