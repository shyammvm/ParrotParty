import React, { useState, useEffect, useRef } from 'react';
import { playAudioDataUrl, stopCurrentAudio } from '../utils/audioPlayer';
import { getFunnyTitle } from '../utils/audioAnalyzer';
import { PlayerAvatar } from '../utils/avatarUtils';
import { peerManager } from '../utils/peerManager';
import { voiceChatManager } from '../utils/voiceChatManager';

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
export default function SoundReveal({ roomState, onNextSound, onFinishAllSounds }) {
  const [stage, setStage] = useState('PLAYER_PLAYING'); // 'PLAYER_PLAYING' | 'SCORE_REVEALED'
  const [animatedScore, setAnimatedScore] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [playingAudioType, setPlayingAudioType] = useState(null); // 'recording' | 'demo' | null
  const [floatingReactions, setFloatingReactions] = useState([]); // [{ id, emoji, senderName, x, y }]

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

    // Auto-pause voice chat during recording playback
    voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', true);

    const run = async () => {
      // Brief pause before playback for smooth visual transition
      await new Promise(r => setTimeout(r, 250));
      if (cancelled) return;

      // Play this player's recorded voice
      if (playerRecording?.audioDataUrl) {
        await playAudioDataUrl(playerRecording.audioDataUrl);
      }
      if (cancelled) return;

      // Immediately unpause voice chat once audio playback ends so players can react!
      voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', false);
      setIsPlayingAudio(false);
      setPlayingAudioType(null);

      await new Promise(r => setTimeout(r, 200));
      if (cancelled) return;

      // Reveal score + animate count-up
      setStage('SCORE_REVEALED');

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

  // Replay this player's voice recording
  const handleReplayRecording = async () => {
    if (isPlayingAudio || !playerRecording?.audioDataUrl) return;
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
    if (isPlayingAudio || !demoSource) return;
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

  // Host advance to next player (manual, no auto-timer!)
  const handleAdvanceNextPlayer = () => {
    if (!isHost) return;
    stopCurrentAudio();
    voiceChatManager.setAutoMuted('REVEAL_PLAYBACK', false);
    const nextIdx = revealPlayerIndex + 1;
    if (nextIdx < players.length) {
      peerManager.updateRoomState({
        revealPlayerIndex: nextIdx
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
    <div style={{ position: 'relative' }}>
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

      {/* ── Live Leaderboard Bar ── */}
      <div className="card" style={{ padding: '0.75rem 1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            🏆 LIVE STANDINGS (Sound {currentSoundIndex + 1}/{totalSounds})
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 700 }}>
            Revealing: {revealPlayerIndex + 1} of {players.length} Players
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', paddingBottom: '0.2rem' }}>
          {leaderboard.map((p, idx) => {
            const isCurrentRevealed = p.id === currentPlayer?.id;
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.35rem 0.65rem',
                  borderRadius: '20px',
                  background: isCurrentRevealed ? 'rgba(244, 132, 95, 0.18)' : 'var(--bg-card-2)',
                  border: isCurrentRevealed ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                  flexShrink: 0
                }}
              >
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                  #{idx + 1}
                </span>
                <PlayerAvatar name={p.name} avatar={p.avatar} size={24} />
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{p.name}</span>
                <strong style={{ fontSize: '0.88rem', color: 'var(--primary)', fontFamily: 'var(--font-display)' }}>
                  {p.cumulativeScore}
                </strong>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main Player Reveal Card ── */}
      <div className="card" style={{ textAlign: 'center', position: 'relative' }}>
        {/* Sound prompt title pill */}
        <div style={{
          display: 'inline-block',
          padding: '0.25rem 0.85rem',
          background: 'rgba(244, 132, 95, 0.1)',
          border: '1.5px solid rgba(244, 132, 95, 0.35)',
          borderRadius: '20px',
          fontSize: '0.78rem',
          color: 'var(--primary)',
          fontWeight: 700,
          marginBottom: '1rem',
          fontFamily: 'var(--font-display)'
        }}>
          SOUND {currentSoundIndex + 1}: {currentSound?.title}
        </div>

        {/* Current Player Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
            <PlayerAvatar
              name={currentPlayer?.name || 'Player'}
              avatar={currentPlayer?.avatar}
              size={76}
              style={{
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                border: '3px solid rgba(255,255,255,0.9)'
              }}
            />
            {isPlayingAudio && playingAudioType === 'recording' && (
              <span style={{
                position: 'absolute',
                bottom: 0,
                right: -4,
                fontSize: '1.2rem',
                background: 'var(--primary)',
                borderRadius: '50%',
                padding: '2px 4px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                animation: 'pulseGreen 1.2s infinite'
              }}>
                🔊
              </span>
            )}
          </div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.6rem',
            fontWeight: 700,
            marginBottom: '0.2rem',
            color: 'var(--text-main)'
          }}>
            {currentPlayer?.name}'s Mimic
          </h2>
          {funnyBadge && stage === 'SCORE_REVEALED' && (
            <span style={{
              display: 'inline-block',
              background: 'rgba(244,132,95,0.15)',
              color: 'var(--primary)',
              fontWeight: 700,
              fontSize: '0.85rem',
              padding: '0.2rem 0.8rem',
              borderRadius: '20px',
              border: '1px solid rgba(244,132,95,0.35)'
            }}>
              {funnyBadge}
            </span>
          )}
        </div>

        {/* Audio status banner */}
        {isPlayingAudio && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'rgba(244, 132, 95, 0.12)',
            padding: '0.4rem 1rem',
            borderRadius: '20px',
            marginBottom: '1rem',
            color: 'var(--primary)',
            fontWeight: 700,
            fontSize: '0.85rem'
          }}>
            <span style={{ animation: 'spin 1.5s linear infinite' }}>🎵</span>
            <span>
              {playingAudioType === 'demo' ? 'Playing Target Reference Sound...' : `Listening to ${currentPlayer?.name}...`}
            </span>
          </div>
        )}

        {/* Replay Controls & Target Comparison */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '0.6rem',
          flexWrap: 'wrap',
          marginBottom: '1.25rem'
        }}>
          <button
            className="btn btn-secondary"
            onClick={handleReplayRecording}
            disabled={isPlayingAudio || !playerRecording?.audioDataUrl}
            style={{ padding: '0.5rem 1.1rem', fontSize: '0.88rem' }}
          >
            {isPlayingAudio && playingAudioType === 'recording' ? '🔊 Playing Voice...' : '🔁 Replay Recording'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handlePlayTargetDemo}
            disabled={isPlayingAudio || !currentSound?.targetAudioUrl}
            style={{ padding: '0.5rem 1.1rem', fontSize: '0.88rem' }}
          >
            {isPlayingAudio && playingAudioType === 'demo' ? '🎯 Playing Demo...' : '🎯 Play Target Demo'}
          </button>
        </div>

        {/* Floating Emoji Reactions Bar (Players can react anytime!) */}
        <div style={{
          background: 'var(--bg-card-2)',
          border: '1.5px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.6rem 1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginRight: '0.2rem' }}>
            React:
          </span>
          {['😂', '👏', '💀', '🔥', '🏆', '😱'].map(emoji => (
            <button
              key={emoji}
              onClick={() => handleTriggerReaction(emoji)}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '1.4rem',
                cursor: 'pointer',
                padding: '0.2rem 0.4rem',
                borderRadius: '8px',
                transition: 'transform 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.3)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              title={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
            (Voice chat active — talk &amp; laugh together!)
          </span>
        </div>

        {/* ── Score display ── */}
        {stage === 'SCORE_REVEALED' && (
          <div style={{
            background: 'var(--bg-card-2)',
            border: '1.5px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: '1.25rem',
            marginBottom: '1.5rem'
          }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '3.8rem',
              fontWeight: 800,
              color: 'var(--primary)',
              lineHeight: 1,
              marginBottom: '0.4rem'
            }}>
              {animatedScore}
              <span style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-muted)', marginLeft: '0.2rem' }}>
                /100
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '1.25rem' }}>
              Sound Match Accuracy
            </p>

            {/* Breakdown Bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: 360, margin: '0 auto' }}>
              <div className="score-row">
                <div className="score-label-bar">
                  <span>🎵 Pitch Curve</span>
                  <strong>{playerRecording?.scoreResult?.pitchScore ?? 80}%</strong>
                </div>
                <div className="score-bar-bg">
                  <div className="score-bar-fill" style={{ width: `${playerRecording?.scoreResult?.pitchScore ?? 80}%`, background: 'var(--primary)' }} />
                </div>
              </div>
              <div className="score-row">
                <div className="score-label-bar">
                  <span>🥁 Rhythm &amp; Timing</span>
                  <strong>{playerRecording?.scoreResult?.rhythmScore ?? 80}%</strong>
                </div>
                <div className="score-bar-bg">
                  <div className="score-bar-fill" style={{ width: `${playerRecording?.scoreResult?.rhythmScore ?? 80}%`, background: 'var(--secondary)' }} />
                </div>
              </div>
              <div className="score-row">
                <div className="score-label-bar">
                  <span>🗣️ Voice Timbre</span>
                  <strong>{playerRecording?.scoreResult?.timbreScore ?? 80}%</strong>
                </div>
                <div className="score-bar-bg">
                  <div className="score-bar-fill" style={{ width: `${playerRecording?.scoreResult?.timbreScore ?? 80}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Host action button & non-host waiting message (NO auto-advance timer!) ── */}
        {stage === 'SCORE_REVEALED' && (
          <div>
            {isHost ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {!isLastPlayer ? (
                  <button
                    className="btn btn-primary"
                    onClick={handleAdvanceNextPlayer}
                    style={{ width: '100%', padding: '0.95rem', fontSize: '1.05rem' }}
                  >
                    ▶️ Next Player ({revealPlayerIndex + 2}/{players.length})
                  </button>
                ) : !isLastSound ? (
                  <button
                    className="btn btn-primary"
                    onClick={onNextSound}
                    style={{ width: '100%', padding: '0.95rem', fontSize: '1.05rem' }}
                  >
                    ➡️ Proceed to Next Sound ({currentSoundIndex + 2}/{totalSounds})
                  </button>
                ) : (
                  <button
                    className="btn btn-success"
                    onClick={onFinishAllSounds}
                    style={{ width: '100%', padding: '0.95rem', fontSize: '1.1rem' }}
                  >
                    🏆 Declare Final Winner &amp; Leaderboard!
                  </button>
                )}
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Take your time to laugh, react, or replay! Advance when everyone is ready.
                </span>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem', fontWeight: 600 }}>
                {!isLastPlayer
                  ? '⏳ Waiting for host to reveal next player...'
                  : (!isLastSound ? '⏳ Round finished! Waiting for host to start next sound...' : '⏳ All sounds finished! Waiting for final results...')
                }
              </p>
            )}
          </div>
        )}

        {stage !== 'SCORE_REVEALED' && !isHost && (
          <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }}>
            🎧 Listening to playback... (Voice chat will resume right after)
          </p>
        )}
      </div>
    </div>
  );
}
