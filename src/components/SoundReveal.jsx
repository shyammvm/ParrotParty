import React, { useState, useEffect, useRef } from 'react';
import { playAudioDataUrl, stopCurrentAudio } from '../utils/audioPlayer';
import { getFunnyTitle } from '../utils/audioAnalyzer';
import { PlayerAvatar } from '../utils/avatarUtils';
import { peerManager } from '../utils/peerManager';
import { voiceChatManager } from '../utils/voiceChatManager';
import { IconPlay, IconVolume, IconReplay, IconArrowRight, IconTrophy, IconWaveform, IconClock, IconHeadphones } from './Icons';

/**
 * SoundReveal – Per-sound synchronized reveal phase.
 *
 * Requirements:
 * 1. Voice chat is LIVE and active so players can react, banter, and laugh!
 * 2. Voice chat auto-pauses when audio (recording or demo) plays, and resumes IMMEDIATELY when finished.
 * 3. NO automatic timer rushing to the next player.
 * 4. Option to replay recording and target demo sound as many times as desired.
 * 5. Synchronized live emoji reactions floating on screen.
 */
const REVEAL_DISCUSSION_LIMIT = 30; // 30 seconds review timer per player

export default function SoundReveal({ roomState, onNextSound, onFinishAllSounds }) {
  const [stage, setStage] = useState('PLAYER_PLAYING'); // 'PLAYER_PLAYING' | 'SCORE_REVEALED'
  const [animatedScore, setAnimatedScore] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [playingAudioType, setPlayingAudioType] = useState(null); // 'recording' | 'demo' | null
  const [floatingReactions, setFloatingReactions] = useState([]); // [{ id, emoji, senderName, x, y }]
  const [timeLeft, setTimeLeft] = useState(REVEAL_DISCUSSION_LIMIT);

  const revealTimerStartMsRef = useRef(null);
  const hasAutoAdvancedRef = useRef(false);

  const isHost = roomState?.isHost;
  const myPlayerId = roomState?.myPlayerId;
  const players = roomState?.players || [];
  const soundPack = roomState?.soundPack || [];
  const currentSoundIndex = roomState?.currentSoundIndex || 0;
  const currentSound = soundPack[currentSoundIndex];
  const totalSounds = soundPack.length;

  const revealPlayerIndex = roomState?.revealPlayerIndex || 0;
  const currentPlayer = players[revealPlayerIndex] || players[0];

  const myPlayer = players.find(p => p.id === myPlayerId);
  const playerRecording = currentPlayer?.recordings?.[currentSoundIndex] ||
    (currentPlayer?.id === myPlayerId ? myPlayer?.recordings?.[currentSoundIndex] : null);

  const playerScore = playerRecording?.scoreResult?.overallScore ?? 0;
  const funnyBadge = playerRecording?.scoreResult?.funnyTitle || getFunnyTitle(playerScore);

  const isLastPlayer = revealPlayerIndex >= players.length - 1;
  const isLastSound = currentSoundIndex >= totalSounds - 1;

  // Listen for broadcast emoji reactions
  useEffect(() => {
    const unsub = peerManager.onReaction((msg) => {
      if (!msg || !msg.emoji) return;
      const reactionId = `react-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const randomLeft = 15 + Math.random() * 70; // 15% to 85% width

      setFloatingReactions(prev => [
        ...prev,
        {
          id: reactionId,
          emoji: msg.emoji,
          senderName: msg.senderName,
          left: randomLeft
        }
      ]);

      // Remove after 2.5s animation
      setTimeout(() => {
        setFloatingReactions(prev => prev.filter(r => r.id !== reactionId));
      }, 2500);
    });

    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Run initial reveal sequence when revealPlayerIndex or sound changes
  useEffect(() => {
    if (!currentPlayer) return;
    let cancelled = false;

    setStage('PLAYER_PLAYING');
    setAnimatedScore(0);
    setIsPlayingAudio(true);
    setPlayingAudioType('recording');
    revealTimerStartMsRef.current = null;
    hasAutoAdvancedRef.current = false;
    setTimeLeft(REVEAL_DISCUSSION_LIMIT);

    // Auto-pause voice chat during recording playback
    voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', true);

    const run = async () => {
      try {
        // Brief pause before playback for smooth visual transition
        await new Promise(r => setTimeout(r, 250));
        if (cancelled) return;

        // Play this player's recorded voice
        if (playerRecording?.audioDataUrl && !roomState?.isPaused) {
          await playAudioDataUrl(playerRecording.audioDataUrl);
        }
      } catch (err) {
        console.warn('[SoundReveal] Playback error:', err);
      } finally {
        // Immediately unpause voice chat once audio playback ends so players can react!
        voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', false);
        setIsPlayingAudio(false);
        setPlayingAudioType(null);
      }

      if (cancelled) return;

      await new Promise(r => setTimeout(r, 200));
      if (cancelled) return;

      // Reveal score + animate count-up
      setStage('SCORE_REVEALED');

      // Start the 30-second review timer
      revealTimerStartMsRef.current = Date.now();
      if (isHost && !roomState?.revealTimerStartTime) {
        peerManager.updateRoomState({
          revealTimerStartTime: Date.now()
        });
      }

      let current = 0;
      const target = playerScore;
      const stepTime = 20;
      const steps = 800 / stepTime;
      const increment = target / steps;
      await new Promise(resolve => {
        const timer = setInterval(() => {
          current += increment;
          if (current >= target) {
            setAnimatedScore(target);
            clearInterval(timer);
            resolve();
          } else {
            setAnimatedScore(Math.round(current));
          }
        }, stepTime);
      });
    };

    run();

    return () => {
      cancelled = true;
      stopCurrentAudio();
      voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', false);
      setIsPlayingAudio(false);
      setPlayingAudioType(null);
    };
  }, [revealPlayerIndex, currentSoundIndex, currentPlayer?.id]);

  // Stop playback if paused
  useEffect(() => {
    if (roomState?.isPaused) {
      stopCurrentAudio();
      voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', false);
      setIsPlayingAudio(false);
      setPlayingAudioType(null);
    }
  }, [roomState?.isPaused]);

  // 30-second countdown ticker after first playback is over
  useEffect(() => {
    if (stage !== 'SCORE_REVEALED') return;

    if (!revealTimerStartMsRef.current) {
      revealTimerStartMsRef.current = Date.now();
      if (isHost && !roomState?.revealTimerStartTime) {
        peerManager.updateRoomState({
          revealTimerStartTime: Date.now()
        });
      }
    }

    const checkTimer = () => {
      if (roomState?.isPaused) return;

      const effectiveStart = roomState?.revealTimerStartTime || revealTimerStartMsRef.current || Date.now();
      const elapsed = Math.max(0, (Date.now() - effectiveStart) / 1000);
      const remaining = Math.max(0, Math.ceil(REVEAL_DISCUSSION_LIMIT - elapsed));
      setTimeLeft(remaining);

      if (remaining <= 0) {
        if (isHost && !hasAutoAdvancedRef.current) {
          hasAutoAdvancedRef.current = true;
          triggerAutoAdvance();
        }
      }
    };

    checkTimer();
    const interval = setInterval(checkTimer, 250);
    return () => clearInterval(interval);
  }, [stage, isHost, roomState?.revealTimerStartTime, roomState?.isPaused, revealPlayerIndex, currentSoundIndex]);

  const triggerAutoAdvance = () => {
    stopCurrentAudio();
    voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', false);

    if (!isLastPlayer) {
      handleAdvanceNextPlayer();
    } else if (!isLastSound) {
      onNextSound();
    } else {
      onFinishAllSounds();
    }
  };

  // Replay this player's voice recording
  const handleReplayRecording = async () => {
    if (isPlayingAudio || !playerRecording?.audioDataUrl || roomState?.isPaused) return;
    setIsPlayingAudio(true);
    setPlayingAudioType('recording');

    // Auto-pause voice chat while audio is playing
    voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', true);

    try {
      await playAudioDataUrl(playerRecording.audioDataUrl);
    } catch (e) {
      console.warn('[SoundReveal] Replay failed:', e);
    } finally {
      // Resume voice chat immediately!
      voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', false);
      setIsPlayingAudio(false);
      setPlayingAudioType(null);
    }
  };

  // Replay original demo prompt sound
  const handlePlayTargetDemo = async () => {
    const demoSource = currentSound?.targetAudioUrl || currentSound?.soundUrl;
    if (isPlayingAudio || !demoSource || roomState?.isPaused) return;
    setIsPlayingAudio(true);
    setPlayingAudioType('demo');

    // Auto-pause voice chat while demo audio is playing
    voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', true);

    try {
      await playAudioDataUrl(demoSource);
    } catch (e) {
      console.warn('[SoundReveal] Target demo play failed:', e);
    } finally {
      // Resume voice chat immediately!
      voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', false);
      setIsPlayingAudio(false);
      setPlayingAudioType(null);
    }
  };

  // Trigger emoji reaction
  const handleTriggerReaction = (emoji) => {
    peerManager.sendReaction(emoji);
  };

  // Host advance to next player
  const handleAdvanceNextPlayer = () => {
    if (!isHost) return;
    hasAutoAdvancedRef.current = true;
    stopCurrentAudio();
    voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', false);
    const nextIdx = revealPlayerIndex + 1;
    if (nextIdx < players.length) {
      peerManager.updateRoomState({
        revealPlayerIndex: nextIdx,
        revealTimerStartTime: null
      });
    }
  };

  // Deterministic Live Leaderboard sorted by cumulative score revealed so far
  const leaderboard = [...players].map(p => {
    let cum = 0;
    // Add scores from previous sounds
    for (let s = 0; s < currentSoundIndex; s++) {
      cum += p.recordings?.[s]?.scoreResult?.overallScore || 0;
    }
    // Add score for current sound if already revealed or is currentPlayer
    const pIdx = players.findIndex(x => x.id === p.id);
    if (pIdx < revealPlayerIndex) {
      cum += p.recordings?.[currentSoundIndex]?.scoreResult?.overallScore || 0;
    } else if (pIdx === revealPlayerIndex) {
      cum += stage === 'SCORE_REVEALED' ? playerScore : 0;
    }
    return { ...p, cumulativeScore: cum };
  }).sort((a, b) => b.cumulativeScore - a.cumulativeScore);

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {/* Floating Reaction Particles */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        overflow: 'hidden'
      }}>
        {floatingReactions.map(r => (
          <div
            key={r.id}
            className="floating-reaction"
            style={{
              position: 'absolute',
              bottom: '15%',
              left: `${r.left}%`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              animation: 'floatUpAndFade 2.5s ease-out forwards'
            }}
          >
            <span style={{ fontSize: '2.5rem' }}>{r.emoji}</span>
            <span style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              background: 'rgba(0,0,0,0.65)',
              color: '#fff',
              padding: '0.1rem 0.4rem',
              borderRadius: '8px',
              marginTop: '0.1rem'
            }}>
              {r.senderName}
            </span>
          </div>
        ))}
      </div>

      {/* ── Compact Live Leaderboard Bar ── */}
      <div className="card" style={{ padding: '0.35rem 0.75rem', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <IconTrophy size={13} /> LIVE STANDINGS (Sound {currentSoundIndex + 1}/{totalSounds})
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 700 }}>
            Revealing {revealPlayerIndex + 1} of {players.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.15rem' }}>
          {leaderboard.map((p, idx) => {
            const isCurrentRevealed = p.id === currentPlayer?.id;
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '16px',
                  background: isCurrentRevealed ? 'rgba(244, 132, 95, 0.18)' : 'var(--bg-card-2)',
                  border: isCurrentRevealed ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                  flexShrink: 0
                }}
              >
                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                  #{idx + 1}
                </span>
                <PlayerAvatar name={p.name} avatar={p.avatar} size={20} />
                <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{p.name}</span>
                <strong style={{ fontSize: '0.8rem', color: 'var(--primary)', fontFamily: 'var(--font-display)' }}>
                  {p.cumulativeScore}
                </strong>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main Player Reveal Card (Compact 1-Page Design) ── */}
      <div className="card" style={{ textAlign: 'center', position: 'relative', padding: '0.75rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {/* Header: Sound Pill + Player Info */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{
              padding: '0.18rem 0.6rem',
              background: 'rgba(244, 132, 95, 0.1)',
              border: '1.5px solid rgba(244, 132, 95, 0.35)',
              borderRadius: '20px',
              fontSize: '0.72rem',
              color: 'var(--primary)',
              fontWeight: 800,
              fontFamily: 'var(--font-display)'
            }}>
              SOUND {currentSoundIndex + 1}: {currentSound?.title}
            </span>
          </div>

          {funnyBadge && stage === 'SCORE_REVEALED' && (
            <span style={{
              background: 'rgba(244,132,95,0.15)',
              color: 'var(--primary)',
              fontWeight: 700,
              fontSize: '0.76rem',
              padding: '0.15rem 0.65rem',
              borderRadius: '16px',
              border: '1px solid rgba(244,132,95,0.35)'
            }}>
              {funnyBadge}
            </span>
          )}
        </div>

        {/* Current Player Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', margin: '0.1rem 0' }}>
          <div style={{ position: 'relative' }}>
            <PlayerAvatar
              name={currentPlayer?.name || 'Player'}
              avatar={currentPlayer?.avatar}
              size={48}
              style={{
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                border: '2.5px solid rgba(255,255,255,0.9)'
              }}
            />
            {isPlayingAudio && playingAudioType === 'recording' && (
              <span style={{
                position: 'absolute',
                bottom: -2,
                right: -3,
                background: 'var(--primary)',
                color: '#fff',
                borderRadius: '50%',
                width: 18,
                height: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                animation: 'pulseGreen 1.2s infinite'
              }}>
                <IconVolume size={11} />
              </span>
            )}
          </div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.35rem',
            fontWeight: 800,
            margin: 0,
            color: 'var(--text-main)'
          }}>
            {currentPlayer?.name}'s Mimic
          </h2>
        </div>

        {/* Audio status banner */}
        {isPlayingAudio && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
            background: 'rgba(244, 132, 95, 0.12)',
            padding: '0.25rem 0.8rem',
            borderRadius: '16px',
            color: 'var(--primary)',
            fontWeight: 700,
            fontSize: '0.78rem'
          }}>
            <IconWaveform size={14} />
            <span>
              {playingAudioType === 'demo' ? 'Playing Target Reference Sound...' : `Listening to ${currentPlayer?.name}...`}
            </span>
          </div>
        )}

        {/* Replay Controls & Target Comparison */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap'
        }}>
          <button
            className="btn btn-secondary"
            onClick={handleReplayRecording}
            disabled={isPlayingAudio || !playerRecording?.audioDataUrl || roomState?.isPaused}
            style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
          >
            {isPlayingAudio && playingAudioType === 'recording' ? (
              <>
                <IconVolume size={14} /> Playing Voice...
              </>
            ) : (
              <>
                <IconReplay size={14} /> Replay Recording
              </>
            )}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handlePlayTargetDemo}
            disabled={isPlayingAudio || !currentSound?.targetAudioUrl || roomState?.isPaused}
            style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
          >
            {isPlayingAudio && playingAudioType === 'demo' ? (
              <>
                <IconVolume size={14} /> Playing Demo...
              </>
            ) : (
              <>
                <IconPlay size={13} fill="currentColor" /> Play Target Demo
              </>
            )}
          </button>
        </div>

        {/* Floating Emoji Reactions Bar */}
        <div style={{
          background: 'var(--bg-card-2)',
          border: '1.5px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.3rem 0.6rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.4rem',
          flexWrap: 'wrap'
        }}>
          {['😂', '👏', '💀', '🔥', '🏆', '😱', '💩'].map(emoji => (
            <button
              key={emoji}
              onClick={() => handleTriggerReaction(emoji)}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '1.2rem',
                cursor: 'pointer',
                padding: '0.15rem 0.35rem',
                borderRadius: '6px',
                transition: 'transform 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.25)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              title={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* ── Score display (Compact & punchy) ── */}
        {stage === 'SCORE_REVEALED' && (
          <div style={{
            background: 'var(--bg-card-2)',
            border: '1.5px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.65rem 0.9rem'
          }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2.4rem',
              fontWeight: 800,
              color: 'var(--primary)',
              lineHeight: 1,
              marginBottom: '0.2rem'
            }}>
              {animatedScore}
              <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-muted)', marginLeft: '0.2rem' }}>
                /100
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.45rem' }}>
              Sound Match Accuracy
            </p>

            {/* Breakdown Bars (compact height: 5px) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxWidth: 360, margin: '0 auto' }}>
              <div className="score-row">
                <div className="score-label-bar" style={{ fontSize: '0.72rem' }}>
                  <span>Pitch Accuracy</span>
                  <strong>{playerRecording?.scoreResult?.pitchScore ?? 0}%</strong>
                </div>
                <div className="score-bar-bg" style={{ height: '5px' }}>
                  <div className="score-bar-fill" style={{ width: `${playerRecording?.scoreResult?.pitchScore ?? 0}%`, background: 'var(--primary)' }} />
                </div>
              </div>
              <div className="score-row">
                <div className="score-label-bar" style={{ fontSize: '0.72rem' }}>
                  <span>Rhythm &amp; Timing</span>
                  <strong>{playerRecording?.scoreResult?.rhythmScore ?? 0}%</strong>
                </div>
                <div className="score-bar-bg" style={{ height: '5px' }}>
                  <div className="score-bar-fill" style={{ width: `${playerRecording?.scoreResult?.rhythmScore ?? 0}%`, background: 'var(--secondary)' }} />
                </div>
              </div>
              <div className="score-row">
                <div className="score-label-bar" style={{ fontSize: '0.72rem' }}>
                  <span>Voice Timbre</span>
                  <strong>{playerRecording?.scoreResult?.timbreScore ?? 0}%</strong>
                </div>
                <div className="score-bar-bg" style={{ height: '5px' }}>
                  <div className="score-bar-fill" style={{ width: `${playerRecording?.scoreResult?.timbreScore ?? 0}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Host action button & non-host waiting message ── */}
        {stage === 'SCORE_REVEALED' && (
          <div>
            {isHost ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {!isLastPlayer ? (
                  <button
                    className="btn btn-primary"
                    onClick={handleAdvanceNextPlayer}
                    style={{ width: '100%', padding: '0.65rem 1.2rem', fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}
                  >
                    <span>Next Player ({revealPlayerIndex + 2}/{players.length})</span>
                    <span style={{
                      fontSize: '0.78rem',
                      opacity: 0.85,
                      background: 'rgba(0,0,0,0.2)',
                      padding: '0.1rem 0.45rem',
                      borderRadius: '8px'
                    }}>
                      {timeLeft}s
                    </span>
                    <IconArrowRight size={16} />
                  </button>
                ) : !isLastSound ? (
                  <button
                    className="btn btn-primary"
                    onClick={onNextSound}
                    style={{ width: '100%', padding: '0.65rem 1.2rem', fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}
                  >
                    <span>Proceed to Next Sound ({currentSoundIndex + 2}/{totalSounds})</span>
                    <span style={{
                      fontSize: '0.78rem',
                      opacity: 0.85,
                      background: 'rgba(0,0,0,0.2)',
                      padding: '0.1rem 0.45rem',
                      borderRadius: '8px'
                    }}>
                      {timeLeft}s
                    </span>
                    <IconArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    className="btn btn-success"
                    onClick={onFinishAllSounds}
                    style={{ width: '100%', padding: '0.65rem 1.2rem', fontSize: '0.98rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}
                  >
                    <IconTrophy size={18} />
                    <span>View Final Leaderboard</span>
                    <span style={{
                      fontSize: '0.78rem',
                      opacity: 0.85,
                      background: 'rgba(0,0,0,0.2)',
                      padding: '0.1rem 0.45rem',
                      borderRadius: '8px'
                    }}>
                      {timeLeft}s
                    </span>
                  </button>
                )}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0.2rem 0', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'center' }}>
                <IconClock size={14} />
                {!isLastPlayer
                  ? `Next player advancing in ${timeLeft}s (or when host clicks next)...`
                  : (!isLastSound ? `Round finished — next sound in ${timeLeft}s...` : `All sounds finished — final results in ${timeLeft}s...`)
                }
              </p>
            )}
          </div>
        )}

        {stage !== 'SCORE_REVEALED' && !isHost && (
          <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'center' }}>
            <IconHeadphones size={14} /> Listening to playback... (Voice chat will resume right after)
          </p>
        )}
      </div>
    </div>
  );
}
