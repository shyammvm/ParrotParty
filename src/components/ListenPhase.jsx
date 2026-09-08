import React, { useState, useRef, useEffect } from 'react';
import { playAudioDataUrl, stopCurrentAudio } from '../utils/audioPlayer';
import { getAudioContext } from '../utils/audioAnalyzer';
import { voiceChatManager } from '../utils/voiceChatManager';
import WaveformDisplay from './WaveformDisplay';

export default function ListenPhase({ roomState, onStartRecordingPhase }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState(null);

  const animFrameRef = useRef(null);
  const startTimeRef = useRef(null);

  const isHost = roomState?.isHost;
  const currentSoundIndex = roomState?.currentSoundIndex || 0;
  const soundPack = roomState?.soundPack || [];
  const currentSound = soundPack[currentSoundIndex] || soundPack[0];
  const totalSounds = soundPack.length || 5;

  const bars = currentSound?.waveformBars || [];
  const duration = currentSound?.duration || 3;

  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);

    return () => {
      stopCurrentAudio();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      voiceChatManager.setAutoMuted('DEMO_PLAYBACK', false);
    };
  }, [currentSoundIndex]);

  const playDemoSound = async () => {
    const demoSource = currentSound?.targetAudioUrl || currentSound?.soundUrl;
    if (!demoSource || isPlaying) return;
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

  const triggerRecordingCountdown = () => {
    stopCurrentAudio();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setProgress(0);
    setIsPlaying(false);

    let count = 3;
    setCountdown(count);
    const interval = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(interval);
        setCountdown('GO!');
        setTimeout(() => onStartRecordingPhase(), 500);
      }
    }, 1000);
  };

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
        Listen carefully — then imitate it exactly!
      </p>

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

      {/* Play button */}
      <div style={{ marginBottom: '1.25rem' }}>
        <button
          className="btn btn-primary"
          onClick={playDemoSound}
          disabled={isPlaying}
          style={{ padding: '1rem 2.75rem', fontSize: '1.1rem' }}
        >
          {isPlaying ? 'Playing...' : 'Play Demo Sound'}
        </button>
        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontWeight: 600 }}>
          Replay as many times as you like before recording
        </p>
      </div>

      {countdown !== null ? (
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '5rem', fontWeight: 700,
          color: 'var(--primary)', lineHeight: 1, margin: '0.5rem 0'
        }}>
          {countdown}
        </div>
      ) : isHost ? (
        <button
          className="btn btn-accent"
          onClick={triggerRecordingCountdown}
          style={{ width: '100%', padding: '0.9rem', fontSize: '1rem' }}
        >
          Start Recording Round
        </button>
      ) : (
        <div style={{
          padding: '0.85rem 1.25rem',
          background: 'var(--bg-card-2)', borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--border-color)',
          color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.88rem'
        }}>
          Waiting for host to start the recording timer...
        </div>
      )}
    </div>
  );
}
