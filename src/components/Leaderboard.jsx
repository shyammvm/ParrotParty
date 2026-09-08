import React, { useState } from 'react';
import { playAudioDataUrl, stopCurrentAudio } from '../utils/audioPlayer';
import { PlayerAvatar } from '../utils/avatarUtils';
import { IconCrown, IconTrophy, IconStop, IconVolume, IconRefresh, IconClock } from './Icons';

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

  // Fallbacks if soundScores array wasn't available
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

export default function Leaderboard({ roomState, onPlayAgain }) {
  const [playingPlayerId, setPlayingPlayerId] = useState(null);

  const isHost = roomState?.isHost;
  const players = roomState?.players || [];

  // Calculate scores and sort players by overall total score descending
  const playersWithScores = players.map(p => ({
    ...p,
    ...calculatePlayerScores(p)
  }));

  const sortedPlayers = [...playersWithScores].sort((a, b) => b.totalScore - a.totalScore);

  const winner = sortedPlayers[0];
  const runnerUp = sortedPlayers[1];
  const thirdPlace = sortedPlayers[2];

  const handleReplayPlayer = async (player) => {
    if (playingPlayerId === player.id) {
      stopCurrentAudio();
      setPlayingPlayerId(null);
      return;
    }

    // Find the first available recording
    const firstRecording = (player.recordings || []).find(r => r?.audioDataUrl)?.audioDataUrl;
    if (firstRecording) {
      try {
        setPlayingPlayerId(player.id);
        await playAudioDataUrl(firstRecording);
      } catch (err) {
        console.warn('Replay failed:', err);
      } finally {
        setPlayingPlayerId(null);
      }
    }
  };

  return (
    <div className="card">
      <div className="card-title" style={{ justifyContent: 'center', gap: '0.5rem' }}>
        <IconCrown size={22} color="var(--warning)" /> GRAND WINNER CELEBRATION
      </div>
      <p className="card-subtitle" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        All sound packs completed! Here are the final total scores and champions!
      </p>

      {/* Winner Spotlight Card */}
      {winner && (
        <div style={{
          textAlign: 'center',
          padding: '1.75rem 1.25rem',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.3), rgba(139, 92, 246, 0.25))',
          border: '2.5px solid var(--warning)',
          borderRadius: 'var(--radius)',
          margin: '0 0 2rem 0',
          boxShadow: '0 0 40px rgba(245, 158, 11, 0.35)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem', animation: 'bounce 1s infinite' }}>
            <IconCrown size={48} color="var(--warning)" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '0.5rem 0' }}>
            <PlayerAvatar
              name={winner.name}
              avatar={winner.avatar}
              size={84}
              fontSize="2.2rem"
              style={{ boxShadow: '0 8px 26px rgba(0,0,0,0.4)', border: '3.5px solid #fff' }}
            />
          </div>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 900, color: '#fff', margin: '0.2rem 0' }}>{winner.name}</h2>
          
          <div style={{
            display: 'inline-block',
            margin: '0.5rem 0',
            padding: '0.4rem 1.25rem',
            background: 'rgba(0, 0, 0, 0.35)',
            borderRadius: '30px',
            border: '1.5px solid var(--warning)'
          }}>
            <span style={{
              fontSize: '1.45rem',
              color: 'var(--warning)',
              fontWeight: 900,
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.04em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem'
            }}>
              <IconTrophy size={22} /> {winner.totalScore} TOTAL POINTS
            </span>
          </div>

          <div style={{
            fontSize: '0.9rem',
            color: 'rgba(255,255,255,0.85)',
            fontWeight: 700,
            marginTop: '0.25rem'
          }}>
            {winner.averageScore}% Avg Match Accuracy across {winner.completedCount} sound{winner.completedCount !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Podium Display (2nd & 3rd Place) */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: '0.75rem',
        marginBottom: '2rem'
      }}>
        {/* 2nd Place */}
        {runnerUp && (
          <div style={{
            flex: 1,
            background: 'rgba(255,255,255,0.06)',
            border: '1.5px solid rgba(255,255,255,0.22)',
            borderRadius: 'var(--radius-sm)',
            padding: '1.1rem 0.6rem',
            textAlign: 'center'
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'linear-gradient(135deg, #e2e8f0, #94a3b8)',
              color: '#0f172a', fontWeight: 900, fontSize: '0.9rem',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)', marginBottom: '0.3rem'
            }}>2</div>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '0.4rem 0' }}>
              <PlayerAvatar name={runnerUp.name} avatar={runnerUp.avatar} size={50} fontSize="1.3rem" />
            </div>
            <strong style={{ display: 'block', fontSize: '0.95rem', color: '#fff' }}>{runnerUp.name}</strong>
            <div style={{
              fontSize: '1.35rem',
              fontWeight: 900,
              color: 'var(--secondary)',
              fontFamily: 'var(--font-display)',
              marginTop: '0.2rem'
            }}>
              {runnerUp.totalScore} pts
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {runnerUp.averageScore}% avg
            </span>
          </div>
        )}

        {/* 3rd Place */}
        {thirdPlace && (
          <div style={{
            flex: 1,
            background: 'rgba(255,255,255,0.06)',
            border: '1.5px solid rgba(255,255,255,0.22)',
            borderRadius: 'var(--radius-sm)',
            padding: '1.1rem 0.6rem',
            textAlign: 'center'
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'linear-gradient(135deg, #f59e0b, #b45309)',
              color: '#fff', fontWeight: 900, fontSize: '0.9rem',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)', marginBottom: '0.3rem'
            }}>3</div>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '0.4rem 0' }}>
              <PlayerAvatar name={thirdPlace.name} avatar={thirdPlace.avatar} size={50} fontSize="1.3rem" />
            </div>
            <strong style={{ display: 'block', fontSize: '0.95rem', color: '#fff' }}>{thirdPlace.name}</strong>
            <div style={{
              fontSize: '1.35rem',
              fontWeight: 900,
              color: 'var(--accent)',
              fontFamily: 'var(--font-display)',
              marginTop: '0.2rem'
            }}>
              {thirdPlace.totalScore} pts
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {thirdPlace.averageScore}% avg
            </span>
          </div>
        )}
      </div>

      {/* Full Leaderboard Table */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h3 style={{
          fontSize: '0.9rem',
          fontWeight: 800,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '0.75rem'
        }}>
          Final Standings &amp; Round Breakdown
        </h3>

        <div className="player-list">
          {sortedPlayers.map((p, rank) => {
            const hasRec = (p.recordings || []).some(r => r?.audioDataUrl);
            const isPlaying = playingPlayerId === p.id;

            return (
              <div key={p.id} className="player-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div className="player-info">
                    <span style={{ fontWeight: 900, width: '26px', color: rank === 0 ? 'var(--warning)' : 'var(--text-muted)', fontSize: '1rem' }}>
                      #{rank + 1}
                    </span>
                    <PlayerAvatar name={p.name} avatar={p.avatar} size={38} />
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.95rem' }}>{p.name}</strong>
                      <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        {p.completedCount} Sounds Completed • {p.averageScore}% avg accuracy
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{
                        fontSize: '1.3rem',
                        color: 'var(--primary)',
                        fontFamily: 'var(--font-display)',
                        display: 'block',
                        lineHeight: 1
                      }}>
                        {p.totalScore} PTS
                      </strong>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                        TOTAL SCORE
                      </span>
                    </div>

                    {hasRec && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleReplayPlayer(p)}
                        style={{
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.75rem',
                          minWidth: '70px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}
                      >
                        {isPlaying ? <><IconStop size={13} /> Stop</> : <><IconVolume size={13} /> Replay</>}
                      </button>
                    )}
                  </div>
                </div>

                {/* Per-sound score tags */}
                {p.soundScores && p.soundScores.length > 0 && (
                  <div style={{
                    display: 'flex',
                    gap: '0.4rem',
                    flexWrap: 'wrap',
                    paddingTop: '0.3rem',
                    borderTop: '1px solid rgba(255,255,255,0.06)'
                  }}>
                    {p.soundScores.map((score, sIdx) => (
                      <span
                        key={sIdx}
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          background: 'rgba(244, 132, 95, 0.12)',
                          color: 'var(--primary)',
                          border: '1px solid rgba(244, 132, 95, 0.3)',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '12px'
                        }}
                      >
                        Sound {sIdx + 1}: {score} pts
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Host Option */}
      {isHost ? (
        <button className="btn btn-primary" onClick={onPlayAgain} style={{ width: '100%', padding: '0.95rem', fontSize: '1.1rem' }}>
          <IconRefresh size={18} /> Play Next Sound Pack Round
        </button>
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
          <IconClock size={14} /> Waiting for Host to start the next round...
        </div>
      )}
    </div>
  );
}
