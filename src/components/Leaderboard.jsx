import React, { useState, useEffect, useMemo, useRef } from 'react';
import { playAudioDataUrl, stopCurrentAudio } from '../utils/audioPlayer';
import { PlayerAvatar } from '../utils/avatarUtils';
import ParrotMascot from './ParrotMascot';
import {
  IconCrown,
  IconTrophy,
  IconStop,
  IconVolume,
  IconRefresh,
  IconClock,
  IconArrowRight,
  IconArrowUp,
  IconArrowDown,
  IconSparkles
} from './Icons';

/**
 * Robust helper to calculate cumulative total scores, sound breakdowns, and accuracy averages
 */
export function calculatePlayerScores(player) {
  let soundScores = [];

  if (Array.isArray(player?.recordings) && player.recordings.length > 0) {
    soundScores = player.recordings
      .filter(Boolean)
      .map(r => Number(r?.scoreResult?.overallScore) || 0);
  } else if (Array.isArray(player?.scoreData?.soundScores) && player.scoreData.soundScores.length > 0) {
    soundScores = player.scoreData.soundScores.map(s => Number(s) || 0);
  }

  let totalScore = soundScores.reduce((sum, s) => sum + s, 0);

  if (totalScore === 0) {
    if (typeof player?.scoreData?.totalScore === 'number' && player.scoreData.totalScore > 0) {
      totalScore = player.scoreData.totalScore;
    } else if (typeof player?.scoreData?.overallScore === 'number' && player.scoreData.overallScore > 0) {
      totalScore = player.scoreData.overallScore;
    }
  }

  const completedCount = soundScores.length || (player?.recordings?.filter(Boolean).length) || 0;
  const countForAvg = Math.max(completedCount, 1);
  const averageScore = Math.round(totalScore / countForAvg);

  return {
    totalScore,
    averageScore,
    soundScores,
    completedCount
  };
}

const CARD_HEIGHT = 80;
const CARD_GAP = 12;
const TOTAL_STEP = CARD_HEIGHT + CARD_GAP;
const LEADERBOARD_TIMER_LIMIT = 15; // 15 seconds to view standings before advancing

export default function Leaderboard({ roomState, onNextSound, onPlayAgain }) {
  const [animStage, setAnimStage] = useState('INIT'); // 'INIT' | 'ADDING' | 'REORDER' | 'SETTLED'
  const [displayedScores, setDisplayedScores] = useState({});
  const [playingPlayerId, setPlayingPlayerId] = useState(null);
  const [timeLeft, setTimeLeft] = useState(LEADERBOARD_TIMER_LIMIT);

  const hasAutoAdvancedRef = useRef(false);
  const timerStartMsRef = useRef(null);

  const isHost = roomState?.isHost;
  const myPlayerId = roomState?.myPlayerId;
  const players = roomState?.players || [];
  const soundPack = roomState?.soundPack || [];
  const currentSoundIndex = roomState?.currentSoundIndex || 0;
  const totalSounds = soundPack.length || 5;
  const isLastSound = currentSoundIndex >= totalSounds - 1;

  const currentSound = soundPack[currentSoundIndex];
  const nextSound = soundPack[currentSoundIndex + 1];

  // Calculate detailed stats per player (previous score, round score, new total)
  const playerStats = useMemo(() => {
    return players.map((p, originalIdx) => {
      const recs = p.recordings || [];
      const resolvedName = p.name || p.playerName || p.username || (p.id === myPlayerId ? 'You' : `Player ${originalIdx + 1}`);

      // Scores earned in rounds prior to currentSoundIndex
      const priorScores = recs
        .slice(0, currentSoundIndex)
        .filter(Boolean)
        .map(r => Number(r?.scoreResult?.overallScore) || 0);
      const prevScore = priorScores.reduce((sum, s) => sum + s, 0);

      // Score earned in this sound round
      const roundScore = Number(recs[currentSoundIndex]?.scoreResult?.overallScore) || 0;

      // Cumulative total score after this sound round
      const newTotalScore = prevScore + roundScore;

      // Accuracy across rounds up to this sound
      const allScores = recs
        .slice(0, currentSoundIndex + 1)
        .filter(Boolean)
        .map(r => Number(r?.scoreResult?.overallScore) || 0);
      const avgAccuracy = allScores.length > 0 ? Math.round(newTotalScore / allScores.length) : 0;

      return {
        ...p,
        name: resolvedName,
        originalIdx,
        prevScore,
        roundScore,
        newTotalScore,
        avgAccuracy,
        completedCount: allScores.length
      };
    });
  }, [players, currentSoundIndex, myPlayerId]);

  // Initial ranking: sorted by prevScore descending (ties broken by original order)
  const initialSorted = useMemo(() => {
    return [...playerStats].sort((a, b) => {
      if (b.prevScore !== a.prevScore) return b.prevScore - a.prevScore;
      return a.originalIdx - b.originalIdx;
    });
  }, [playerStats]);

  // Final ranking: sorted by newTotalScore descending (ties broken by prevScore)
  const finalSorted = useMemo(() => {
    return [...playerStats].sort((a, b) => {
      if (b.newTotalScore !== a.newTotalScore) return b.newTotalScore - a.newTotalScore;
      if (b.prevScore !== a.prevScore) return b.prevScore - a.prevScore;
      return a.originalIdx - b.originalIdx;
    });
  }, [playerStats]);

  // Maps to lookup initial and final ranks (0-indexed)
  const initialRankMap = useMemo(() => {
    const map = {};
    initialSorted.forEach((p, idx) => {
      map[p.id] = idx;
    });
    return map;
  }, [initialSorted]);

  const finalRankMap = useMemo(() => {
    const map = {};
    finalSorted.forEach((p, idx) => {
      map[p.id] = idx;
    });
    return map;
  }, [finalSorted]);

  // ── Run Animation Sequence ──
  useEffect(() => {
    hasAutoAdvancedRef.current = false;
    timerStartMsRef.current = null;
    setTimeLeft(LEADERBOARD_TIMER_LIMIT);

    // 1. Stage INIT: display prevScores
    const initScores = {};
    playerStats.forEach(p => {
      initScores[p.id] = p.prevScore;
    });
    setDisplayedScores(initScores);
    setAnimStage('INIT');

    // 2. Stage ADDING: count up score numbers over 1200ms
    const t1 = setTimeout(() => {
      setAnimStage('ADDING');
      const startMs = Date.now();
      const countDuration = 1200;

      const ticker = setInterval(() => {
        const elapsed = Date.now() - startMs;
        const progress = Math.min(1, elapsed / countDuration);
        const ease = 1 - Math.pow(1 - progress, 2);

        const current = {};
        playerStats.forEach(p => {
          current[p.id] = Math.round(p.prevScore + p.roundScore * ease);
        });
        setDisplayedScores(current);

        if (progress >= 1) {
          clearInterval(ticker);
        }
      }, 30);
    }, 650);

    // 3. Stage REORDER: animate position shifts
    const t2 = setTimeout(() => {
      setAnimStage('REORDER');
    }, 2100);

    // 4. Stage SETTLED: finalize standings
    const t3 = setTimeout(() => {
      setAnimStage('SETTLED');
      timerStartMsRef.current = Date.now();
    }, 3200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [playerStats]);

  // ── 15-second countdown timer once settled ──
  useEffect(() => {
    if (animStage !== 'SETTLED' || roomState?.isPaused) return;

    if (!timerStartMsRef.current) {
      timerStartMsRef.current = Date.now();
    }

    const interval = setInterval(() => {
      if (roomState?.isPaused) return;
      const start = timerStartMsRef.current || Date.now();
      const elapsed = Math.max(0, (Date.now() - start) / 1000);
      const remaining = Math.max(0, Math.ceil(LEADERBOARD_TIMER_LIMIT - elapsed));
      setTimeLeft(remaining);

      if (remaining <= 0 && isHost && !hasAutoAdvancedRef.current) {
        hasAutoAdvancedRef.current = true;
        if (!isLastSound && onNextSound) {
          onNextSound();
        }
      }
    }, 250);

    return () => clearInterval(interval);
  }, [animStage, isHost, isLastSound, onNextSound, roomState?.isPaused]);

  // Audio Replay Handler
  const handleReplayPlayer = async (player) => {
    if (playingPlayerId === player.id) {
      stopCurrentAudio();
      setPlayingPlayerId(null);
      return;
    }

    const recording = player.recordings?.[currentSoundIndex]?.audioDataUrl ||
      (player.recordings || []).find(r => r?.audioDataUrl)?.audioDataUrl;

    if (recording) {
      try {
        setPlayingPlayerId(player.id);
        await playAudioDataUrl(recording);
      } catch (err) {
        console.warn('Replay failed:', err);
      } finally {
        setPlayingPlayerId(null);
      }
    }
  };

  const winner = finalSorted[0];
  const runnerUp = finalSorted[1];
  const thirdPlace = finalSorted[2];

  const containerHeight = Math.max(playerStats.length * TOTAL_STEP - CARD_GAP, CARD_HEIGHT);

  return (
    <div className="card arcade-stage-card" style={{ width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.9rem 1.4rem' }}>
      {/* ── Top Header Row: Mascot + Stage Title + Player Count ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <ParrotMascot mode={isLastSound ? 'SUCCESS' : 'DANCE'} size={44} />
          <div style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{
                padding: '0.15rem 0.6rem',
                background: 'rgba(244,132,95,0.14)',
                border: '1.5px solid rgba(244,132,95,0.45)',
                borderRadius: '20px',
                fontSize: '0.72rem',
                color: 'var(--primary)',
                fontWeight: 800,
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.04em'
              }}>
                {!isLastSound ? `ROUND ${currentSoundIndex + 1}/${totalSounds}` : 'FINAL STANDINGS'}
              </span>
              <h2 style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.35rem',
                fontWeight: 900,
                color: 'var(--text-main)',
                margin: 0,
                lineHeight: 1.15
              }}>
                {!isLastSound ? `ROUND ${currentSoundIndex + 1} STANDINGS` : 'GRAND FINAL LEADERBOARD'}
              </h2>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.65rem',
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: '16px',
            fontSize: '0.76rem',
            color: 'var(--warning)',
            fontWeight: 800
          }}>
            <IconTrophy size={14} /> {players.length} Player{players.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Dynamic Animated Leaderboard List ── */}
      <div
        className="leaderboard-anim-container"
        style={{ height: `${containerHeight}px` }}
      >
        {playerStats.map(p => {
          const initRank = initialRankMap[p.id] ?? 0;
          const finRank = finalRankMap[p.id] ?? 0;
          const rankDelta = initRank - finRank; // > 0: climbed, < 0: fell

          const isShifted = animStage === 'REORDER' || animStage === 'SETTLED';
          const currentRank = isShifted ? finRank : initRank;
          const currentTop = currentRank * TOTAL_STEP;

          const isMovingUp = isShifted && rankDelta > 0;
          const isMovingDown = isShifted && rankDelta < 0;
          const isFirst = isShifted && finRank === 0;

          const hasRec = Boolean(p.recordings?.[currentSoundIndex]?.audioDataUrl);
          const isPlaying = playingPlayerId === p.id;
          const isMe = p.id === myPlayerId;
          const isPlayerHost = p.id === roomState?.players?.find(pl => pl.isHost)?.id;

          return (
            <div
              key={p.id}
              className={`leaderboard-player-card ${isMovingUp ? 'moving-up' : ''} ${isMovingDown ? 'moving-down' : ''} ${isFirst ? 'is-first-rank' : ''}`}
              style={{
                top: 0,
                height: `${CARD_HEIGHT}px`,
                transform: `translateY(${currentTop}px)`,
                transition: isShifted
                  ? 'transform 0.85s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.4s ease, border-color 0.4s ease, background 0.4s ease'
                  : 'none'
              }}
            >
              {/* Left Info: Rank + Delta Badge + Avatar + Full Username */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: '1 1 auto' }}>
                {/* Rank Number or Crown */}
                <div style={{
                  width: 34,
                  height: 34,
                  borderRadius: '11px',
                  background: isFirst
                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                    : finRank === 1 && isShifted
                      ? 'linear-gradient(135deg, #cbd5e1, #94a3b8)'
                      : finRank === 2 && isShifted
                        ? 'linear-gradient(135deg, #d97706, #b45309)'
                        : 'rgba(0,0,0,0.06)',
                  color: (isFirst || (isShifted && finRank < 3)) ? '#ffffff' : 'var(--text-main)',
                  fontWeight: 900,
                  fontSize: '0.98rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-display)',
                  flexShrink: 0,
                  boxShadow: isFirst ? '0 2px 8px rgba(245, 158, 11, 0.4)' : 'none'
                }}>
                  {isFirst ? <IconCrown size={18} color="#ffffff" /> : `#${currentRank + 1}`}
                </div>

                {/* Rank Change Indicator Badge */}
                {isShifted && (
                  <div style={{ flexShrink: 0 }}>
                    {rankDelta > 0 ? (
                      <span className="rank-delta-pill rank-up" title={`Climbed ${rankDelta} position${rankDelta > 1 ? 's' : ''}!`}>
                        <IconArrowUp size={11} /> +{rankDelta}
                      </span>
                    ) : rankDelta < 0 ? (
                      <span className="rank-delta-pill rank-down" title={`Dropped ${Math.abs(rankDelta)} position${Math.abs(rankDelta) > 1 ? 's' : ''}`}>
                        <IconArrowDown size={11} /> {rankDelta}
                      </span>
                    ) : (
                      <span className="rank-delta-pill rank-same" title="Maintained rank">
                        –
                      </span>
                    )}
                  </div>
                )}

                {/* Avatar */}
                <PlayerAvatar name={p.name} avatar={p.avatar} size={44} />

                {/* Full Username & Details (Prominently displayed, full name without truncation) */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  textAlign: 'left',
                  minWidth: 0,
                  flex: '1 1 auto',
                  justifyContent: 'center',
                  overflow: 'hidden'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', whiteSpace: 'nowrap' }}>
                    <strong className="leaderboard-full-name" title={p.name}>
                      {p.name}
                    </strong>
                    {isMe && <span className="badge-you-pill">YOU</span>}
                    {isPlayerHost && <span className="badge-host-pill">HOST</span>}
                  </div>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '2px', whiteSpace: 'nowrap' }}>
                    {p.completedCount} sound{p.completedCount !== 1 ? 's' : ''} • {p.avgAccuracy}% avg accuracy
                  </span>
                </div>
              </div>

              {/* Right Side: Score Counter + Animated Round Add Tag + Replay Button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexShrink: 0, marginLeft: '0.5rem' }}>
                <div style={{ textAlign: 'right' }}>
                  <strong className="leaderboard-score-number">
                    {displayedScores[p.id] ?? p.newTotalScore}
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.22rem', fontWeight: 700 }}>
                      PTS
                    </span>
                  </strong>
                </div>

                {/* Round score addition tag */}
                {p.roundScore > 0 && (
                  <span
                    className={`score-round-add-tag ${animStage === 'ADDING' ? 'pulse-add' : ''} ${animStage === 'SETTLED' ? 'faded' : ''}`}
                    title={`+${p.roundScore} points earned this round`}
                  >
                    +{p.roundScore}
                  </span>
                )}

                {/* Mimic audio replay button */}
                {hasRec && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-replay-compact"
                    onClick={() => handleReplayPlayer(p)}
                    title={isPlaying ? 'Stop playback' : 'Listen to mimic'}
                  >
                    {isPlaying ? <IconStop size={13} /> : <IconVolume size={13} />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Final Podium Display if Final Round & Settled ── */}
      {isLastSound && animStage === 'SETTLED' && (
        <div style={{
          marginTop: '1.25rem',
          padding: '1.35rem 1.2rem',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.16), rgba(244, 132, 95, 0.14))',
          borderRadius: '20px',
          border: '2px solid var(--warning)',
          textAlign: 'center',
          boxShadow: '0 8px 30px rgba(245, 158, 11, 0.22)',
          animation: 'popIn 0.4s ease-out'
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
            <IconCrown size={36} color="var(--warning)" />
            <PlayerAvatar name={winner?.name} avatar={winner?.avatar} size={52} />
          </div>
          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--warning)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Grand Mimic Champion
          </div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-main)', margin: '0.25rem 0' }}>
            {winner?.name}
          </h3>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.92rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            Scored <strong style={{ color: 'var(--primary)', fontSize: '1.05rem' }}>{winner?.newTotalScore} PTS</strong> with {winner?.avgAccuracy}% average mimic accuracy!
          </p>

          {/* Mini-Podium for Runner-Up and 3rd Place with Full Usernames */}
          {finalSorted.length > 1 && (
            <div style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              marginTop: '1rem',
              paddingTop: '0.85rem',
              borderTop: '1.5px dashed rgba(245, 158, 11, 0.35)',
              flexWrap: 'wrap'
            }}>
              {runnerUp && (
                <div style={{
                  flex: '1 1 200px',
                  maxWidth: 260,
                  background: 'rgba(255,255,255,0.75)',
                  borderRadius: '14px',
                  padding: '0.6rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  border: '1.5px solid #cbd5e1'
                }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: '#94a3b8', color: '#fff',
                    fontWeight: 900, fontSize: '0.75rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>2</span>
                  <PlayerAvatar name={runnerUp.name} avatar={runnerUp.avatar} size={32} />
                  <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
                    <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-main)', wordBreak: 'break-word' }}>
                      {runnerUp.name}
                    </strong>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      {runnerUp.newTotalScore} pts • {runnerUp.avgAccuracy}%
                    </span>
                  </div>
                </div>
              )}

              {thirdPlace && (
                <div style={{
                  flex: '1 1 200px',
                  maxWidth: 260,
                  background: 'rgba(255,255,255,0.75)',
                  borderRadius: '14px',
                  padding: '0.6rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  border: '1.5px solid #d97706'
                }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: '#d97706', color: '#fff',
                    fontWeight: 900, fontSize: '0.75rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>3</span>
                  <PlayerAvatar name={thirdPlace.name} avatar={thirdPlace.avatar} size={32} />
                  <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
                    <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-main)', wordBreak: 'break-word' }}>
                      {thirdPlace.name}
                    </strong>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      {thirdPlace.newTotalScore} pts • {thirdPlace.avgAccuracy}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Bottom Controls: Next Round or Play Again ── */}
      <div style={{ marginTop: '0.75rem' }}>
        {!isLastSound ? (
          <div>
            {isHost ? (
              <button
                className="btn btn-primary"
                onClick={onNextSound}
                style={{
                  width: '100%',
                  padding: '0.75rem 1.2rem',
                  fontSize: '1rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 4px 18px rgba(244, 132, 95, 0.35)'
                }}
              >
                <span>Proceed to Sound {currentSoundIndex + 2} of {totalSounds}</span>
                {nextSound?.title && <span style={{ opacity: 0.85 }}>({nextSound.title})</span>}
                <span style={{
                  fontSize: '0.82rem',
                  background: 'rgba(0,0,0,0.22)',
                  padding: '0.12rem 0.5rem',
                  borderRadius: '10px'
                }}>
                  {timeLeft}s
                </span>
                <IconArrowRight size={17} />
              </button>
            ) : (
              <p style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.84rem',
                margin: '0.4rem 0',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem'
              }}>
                <IconClock size={14} color="var(--primary)" />
                Next round in <strong>{timeLeft}s</strong>
              </p>
            )}
          </div>
        ) : (
          <div>
            {isHost ? (
              <button
                className="btn btn-primary"
                onClick={onPlayAgain}
                style={{
                  width: '100%',
                  padding: '0.85rem 1.4rem',
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 4px 20px rgba(244, 132, 95, 0.4)'
                }}
              >
                <IconRefresh size={18} /> Play Next Sound Pack Round
              </button>
            ) : (
              <p style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.82rem',
                margin: '0.35rem 0',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem'
              }}>
                <IconClock size={13} /> Waiting for next round...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
