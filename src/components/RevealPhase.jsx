import React, { useState, useEffect, useRef } from 'react';
import { playAudioDataUrl, stopCurrentAudio } from '../utils/audioPlayer';
import { getFunnyTitle } from '../utils/audioAnalyzer';
import { PlayerAvatar } from '../utils/avatarUtils';
import { IconTrophy, IconCrown, IconVolume, IconMic, IconSparkles, IconArrowRight } from './Icons';
import ScoreEffectsOverlay from './ScoreEffectsOverlay';

export default function RevealPhase({ roomState, onNextReveal, onGoToLeaderboard }) {
  const [stage, setStage] = useState('IDLE'); // 'TARGET_PLAYING' | 'PLAYER_PLAYING' | 'SCORE_REVEALED' | 'PAUSED'
  const [animatedScore, setAnimatedScore] = useState(0);

  const isHost = roomState?.isHost;
  const players = roomState?.players || [];
  const soundPack = roomState?.soundPack || [];
  const totalSounds = soundPack.length || 5;

  const currentRevealIndex = roomState?.currentRevealIndex || 0; // index from 0 to (players.length * totalSounds - 1)
  
  // Calculate which player and which sound index we are currently revealing
  const playerIndex = currentRevealIndex % players.length;
  const soundIndex = Math.floor(currentRevealIndex / players.length);

  const currentPlayer = players[playerIndex] || players[0];
  const currentSound = soundPack[soundIndex] || soundPack[0];
  const playerRecording = currentPlayer?.recordings?.[soundIndex];

  const currentScore = playerRecording?.scoreResult?.overallScore || 0;
  const funnyBadge = playerRecording?.scoreResult?.funnyTitle || getFunnyTitle(currentScore);

  // Maintain revealed scores for live leaderboard at the top
  const revealedMap = useRef({});

  useEffect(() => {
    // When switching reveal step, start automatic sequence
    let isCancelled = false;
    setStage('IDLE');
    setAnimatedScore(0);

    const runAutomaticSequence = async () => {
      // 1. Play Target Audio automatically
      setStage('TARGET_PLAYING');
      if (currentSound?.targetAudioUrl) {
        await playAudioDataUrl(currentSound.targetAudioUrl);
      }
      if (isCancelled) return;

      // Small pause between target and player sound
      await new Promise(r => setTimeout(r, 600));
      if (isCancelled) return;

      // 2. Play Player's Recorded Voice automatically
      setStage('PLAYER_PLAYING');
      if (playerRecording?.audioDataUrl) {
        await playAudioDataUrl(playerRecording.audioDataUrl);
      }
      if (isCancelled) return;

      // 3. Reveal Score & Update Live Leaderboard
      setStage('SCORE_REVEALED');
      
      // Animate score count-up
      let current = 0;
      const stepTime = 20;
      const steps = 1000 / stepTime;
      const increment = currentScore / steps;
      const timer = setInterval(() => {
        current += increment;
        if (current >= currentScore) {
          setAnimatedScore(currentScore);
          clearInterval(timer);
        } else {
          setAnimatedScore(Math.round(current));
        }
      }, stepTime);

      // Record revealed score into live leaderboard map
      revealedMap.current[currentPlayer.id] = (revealedMap.current[currentPlayer.id] || 0) + currentScore;

      // Wait 3 seconds for everyone to laugh & view score
      await new Promise(r => setTimeout(r, 3200));
      if (isCancelled) return;

      // 4. Host automatically advances to next reveal step
      if (isHost) {
        const totalSteps = players.length * totalSounds;
        if (currentRevealIndex < totalSteps - 1) {
          onNextReveal();
        } else {
          onGoToLeaderboard();
        }
      }
    };

    runAutomaticSequence();

    return () => {
      isCancelled = true;
      stopCurrentAudio();
    };
  }, [currentRevealIndex]);

  // Live Leaderboard Data sorted descending
  const liveLeaderboard = [...players].map(p => {
    const totalScore = revealedMap.current[p.id] || 0;
    return { ...p, liveScore: totalScore };
  }).sort((a, b) => b.liveScore - a.liveScore);

  const totalSteps = players.length * totalSounds;
  const isLastStep = currentRevealIndex >= totalSteps - 1;
  const cardRef = useRef(null);

  return (
    <div ref={cardRef} className="card" style={{ position: 'relative', overflow: 'hidden' }}>
      <ScoreEffectsOverlay
        score={currentScore}
        isActive={stage === 'SCORE_REVEALED'}
        containerRef={cardRef}
      />
      {/* 🏆 LIVE LEADERBOARD AT THE TOP */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.4)',
        border: '1px solid var(--border-active)',
        borderRadius: 'var(--radius-sm)',
        padding: '0.8rem 1rem',
        marginBottom: '1.25rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <IconTrophy size={15} /> LIVE LEADERBOARD (UPDATED REAL-TIME)
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            REVEAL {currentRevealIndex + 1} OF {totalSteps}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
          {liveLeaderboard.map((p, rank) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.3rem 0.6rem',
                background: p.id === currentPlayer?.id ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${p.id === currentPlayer?.id ? 'var(--primary)' : 'var(--border-color)'}`,
                borderRadius: '20px',
                fontSize: '0.85rem',
                whiteSpace: 'nowrap'
              }}
            >
              <span>{rank === 0 ? <IconCrown size={13} color="var(--warning)" /> : `#${rank + 1}`}</span>
              <PlayerAvatar name={p.name} avatar={p.avatar} size={22} fontSize="0.65rem" />
              <strong>{p.name}</strong>
              <span style={{ color: 'var(--secondary)', fontWeight: 800 }}>{p.liveScore} pts</span>
            </div>
          ))}
        </div>
      </div>

      {/* MAIN REVEAL STAGE */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--secondary)', fontWeight: 700, marginBottom: '0.4rem' }}>
          SOUND {soundIndex + 1} OF {totalSounds}: "{currentSound?.title}"
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '0.6rem 0' }}>
          <PlayerAvatar
            name={currentPlayer?.name}
            avatar={currentPlayer?.avatar}
            size={72}
            fontSize="1.9rem"
            style={{ boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}
          />
        </div>
        <h2 style={{ fontSize: '1.6rem', fontWeight: 800 }}>{currentPlayer?.name}</h2>

        {/* Status Banner */}
        <div style={{ margin: '1rem 0', minHeight: '40px' }}>
          {stage === 'TARGET_PLAYING' && (
            <div style={{ padding: '0.6rem 1rem', background: 'rgba(6, 182, 212, 0.15)', border: '1px solid var(--secondary)', borderRadius: '20px', color: 'var(--secondary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <IconVolume size={16} /> Playing Target Demo Sound...
            </div>
          )}

          {stage === 'PLAYER_PLAYING' && (
            <div style={{ padding: '0.6rem 1rem', background: 'rgba(139, 92, 246, 0.2)', border: '1px solid var(--primary)', borderRadius: '20px', color: 'var(--primary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <IconMic size={16} /> Playing {currentPlayer?.name}'s Recorded Voice!
            </div>
          )}

          {stage === 'SCORE_REVEALED' && (
            <div style={{ padding: '0.6rem 1rem', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--success)', borderRadius: '20px', color: 'var(--success)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <IconSparkles size={16} /> Score Revealed! Updating Leaderboard...
            </div>
          )}
        </div>

        {/* Big Score Badge */}
        {stage === 'SCORE_REVEALED' && (
          <div className="big-score-badge">
            <div className="score-number">{animatedScore}%</div>
            <div className="funny-title">{funnyBadge}</div>

            <div style={{ marginTop: '1.25rem', textAlign: 'left' }}>
              <div className="score-row">
                <div className="score-label-bar">
                  <span>Pitch Accuracy</span>
                  <strong>{playerRecording?.scoreResult?.pitchScore ?? 0}%</strong>
                </div>
                <div className="score-bar-bg">
                  <div className="score-bar-fill" style={{ width: `${playerRecording?.scoreResult?.pitchScore ?? 0}%`, background: 'var(--primary)' }} />
                </div>
              </div>

              <div className="score-row">
                <div className="score-label-bar">
                  <span>Rhythm &amp; Timing</span>
                  <strong>{playerRecording?.scoreResult?.rhythmScore ?? 0}%</strong>
                </div>
                <div className="score-bar-bg">
                  <div className="score-bar-fill" style={{ width: `${playerRecording?.scoreResult?.rhythmScore ?? 0}%`, background: 'var(--secondary)' }} />
                </div>
              </div>

              <div className="score-row">
                <div className="score-label-bar">
                  <span>Voice Timbre</span>
                  <strong>{playerRecording?.scoreResult?.timbreScore ?? 0}%</strong>
                </div>
                <div className="score-bar-bg">
                  <div className="score-bar-fill" style={{ width: `${playerRecording?.scoreResult?.timbreScore ?? 0}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Host Manual Controls Override */}
        {isHost && (
          <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.5rem' }}>
            {!isLastStep ? (
              <button className="btn btn-secondary" onClick={onNextReveal} style={{ flex: 1, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                Skip to Next Sound <IconArrowRight size={16} />
              </button>
            ) : (
              <button className="btn btn-success" onClick={onGoToLeaderboard} style={{ flex: 1, fontSize: '1rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                <IconTrophy size={18} /> Declare Final Winner!
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
