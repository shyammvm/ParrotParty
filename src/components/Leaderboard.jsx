import React, { useEffect } from 'react';
import { playAudioDataUrl } from '../utils/audioPlayer';
import { PlayerAvatar } from '../utils/avatarUtils';

export default function Leaderboard({ roomState, onPlayAgain }) {
  const isHost = roomState?.isHost;
  const players = roomState?.players || [];

  // Sort players by overall score descending
  const sortedPlayers = [...players].sort((a, b) => {
    const scoreA = a.scoreData?.overallScore || 0;
    const scoreB = b.scoreData?.overallScore || 0;
    return scoreB - scoreA;
  });

  const winner = sortedPlayers[0];
  const runnerUp = sortedPlayers[1];
  const thirdPlace = sortedPlayers[2];

  const handleReplayPlayer = async (player) => {
    const firstRecording = player.recordings?.[0]?.audioDataUrl;
    if (firstRecording) {
      await playAudioDataUrl(firstRecording);
    }
  };

  return (
    <div className="card">
      <div className="card-title" style={{ justifyContent: 'center' }}>
        👑 GRAND WINNER CELEBRATION
      </div>
      <p className="card-subtitle" style={{ textAlign: 'center' }}>
        All sound packs completed! Here are the ultimate party champions!
      </p>

      {/* Winner Spotlight Card */}
      {winner && (
        <div style={{
          textAlign: 'center',
          padding: '1.5rem',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.3), rgba(139, 92, 246, 0.25))',
          border: '2px solid var(--warning)',
          borderRadius: 'var(--radius)',
          margin: '1.25rem 0 2rem 0',
          boxShadow: '0 0 35px rgba(245, 158, 11, 0.3)'
        }}>
          <span style={{ fontSize: '3.5rem', display: 'block', animation: 'bounce 1s infinite' }}>👑</span>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '0.4rem 0' }}>
            <PlayerAvatar
              name={winner.name}
              avatar={winner.avatar}
              size={76}
              fontSize="2rem"
              style={{ boxShadow: '0 6px 22px rgba(0,0,0,0.3)', border: '3px solid #fff' }}
            />
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 900, color: '#fff' }}>{winner.name}</h2>
          <div style={{ fontSize: '1.25rem', color: 'var(--warning)', fontWeight: 800, marginTop: '0.2rem' }}>
            GRAND CHAMPION - {winner.scoreData?.overallScore || 0} POINTS
          </div>
        </div>
      )}

      {/* Podium Display */}
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
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 'var(--radius-sm)',
            padding: '1rem 0.5rem',
            textAlign: 'center'
          }}>
            <span style={{ fontSize: '1.5rem' }}>🥈</span>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '0.4rem 0' }}>
              <PlayerAvatar name={runnerUp.name} avatar={runnerUp.avatar} size={48} fontSize="1.3rem" />
            </div>
            <strong style={{ display: 'block', fontSize: '0.9rem' }}>{runnerUp.name}</strong>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--secondary)' }}>
              {runnerUp.scoreData?.overallScore || 0} pts
            </span>
          </div>
        )}

        {/* 3rd Place */}
        {thirdPlace && (
          <div style={{
            flex: 1,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 'var(--radius-sm)',
            padding: '1rem 0.5rem',
            textAlign: 'center'
          }}>
            <span style={{ fontSize: '1.5rem' }}>🥉</span>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '0.4rem 0' }}>
              <PlayerAvatar name={thirdPlace.name} avatar={thirdPlace.avatar} size={48} fontSize="1.3rem" />
            </div>
            <strong style={{ display: 'block', fontSize: '0.9rem' }}>{thirdPlace.name}</strong>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent)' }}>
              {thirdPlace.scoreData?.overallScore || 0} pts
            </span>
          </div>
        )}
      </div>

      {/* Full Leaderboard Table */}
      <div className="player-list" style={{ marginBottom: '1.5rem' }}>
        {sortedPlayers.map((p, rank) => (
          <div key={p.id} className="player-item">
            <div className="player-info">
              <span style={{ fontWeight: 800, width: '25px', color: 'var(--text-muted)' }}>#{rank + 1}</span>
              <PlayerAvatar name={p.name} avatar={p.avatar} size={36} />
              <div>
                <strong style={{ display: 'block' }}>{p.name}</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {p.recordings?.length || 0} Sounds Completed
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <strong style={{ fontSize: '1.2rem', color: 'var(--primary)' }}>
                {p.scoreData?.overallScore || 0} pts
              </strong>
              {p.recordings?.[0]?.audioDataUrl && (
                <button
                  className="btn btn-secondary"
                  onClick={() => handleReplayPlayer(p)}
                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                >
                  🔊 Replay
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Host Option */}
      {isHost ? (
        <button className="btn btn-primary" onClick={onPlayAgain} style={{ width: '100%', padding: '0.9rem', fontSize: '1.1rem' }}>
          🔄 Play Next Sound Pack Round
        </button>
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          ⏳ Waiting for Host to start the next round...
        </div>
      )}
    </div>
  );
}
