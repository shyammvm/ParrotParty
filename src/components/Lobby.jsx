import React, { useState, useEffect } from 'react';
import { peerManager } from '../utils/peerManager';
import { PlayerAvatar } from '../utils/avatarUtils';
import tintomLogo from '../assets/tintom.png';

export default function Lobby({ roomState, onStartSelectPrompt, onOpenSettings }) {
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('tintom_player_name') || '');
  const [inputRoomId, setInputRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) setInputRoomId(roomParam.toUpperCase());

    peerManager.setOnError((err) => {
      setErrorMsg(err);
      setLoading(false);
    });
  }, []);

  const handleCreate = async () => {
    if (!playerName.trim()) { setErrorMsg('Please enter your player name!'); return; }
    setErrorMsg(''); setLoading(true);
    localStorage.setItem('tintom_player_name', playerName.trim());
    try { await peerManager.createRoom(playerName.trim()); }
    catch (e) { setErrorMsg('Error creating room: ' + e.message); }
    finally { setLoading(false); }
  };

  const handleJoin = async () => {
    if (!playerName.trim()) { setErrorMsg('Please enter your player name!'); return; }
    if (!inputRoomId.trim()) { setErrorMsg('Please enter a Room Code!'); return; }
    setErrorMsg(''); setLoading(true);
    localStorage.setItem('tintom_player_name', playerName.trim());
    try { await peerManager.joinRoom(inputRoomId.trim(), playerName.trim()); }
    catch (e) { setErrorMsg(e.message || 'Error joining room'); }
    finally { setLoading(false); }
  };

  const openSecondTabTest = () => {
    if (roomState?.roomId && roomState.players.length < 10) {
      const url = `${window.location.origin}${window.location.pathname}?room=${roomState.roomId}`;
      window.open(url, '_blank');
    }
  };

  // ── In-room lobby ──
  if (roomState?.roomId) {
    const isHost = roomState.isHost;
    const isFull = roomState.players.length >= 10;

    return (
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
          <h2 className="card-title" style={{ marginBottom: 0 }}>Party Lobby</h2>
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: '0.85rem',
            color: isFull ? 'var(--accent)' : 'var(--primary)',
            fontWeight: 700,
            background: isFull ? 'rgba(255,107,107,0.12)' : 'rgba(244,132,95,0.1)',
            padding: '0.2rem 0.7rem',
            borderRadius: '20px',
            border: isFull ? '1.5px solid rgba(255,107,107,0.35)' : '1.5px solid rgba(244,132,95,0.3)'
          }}>
            {roomState.players.length} / 10 players {isFull ? '(Room Full)' : ''}
          </span>
        </div>
        <p className="card-subtitle">
          Share room code <strong style={{ color: 'var(--primary)', fontFamily: 'var(--font-display)', fontSize: '1rem' }}>{roomState.roomId}</strong> with friends! (Max 10 players)
        </p>

        <div className="player-list" style={{ marginBottom: '1.25rem' }}>
          {roomState.players.map(p => (
            <div key={p.id} className="player-item">
              <div className="player-info">
                <PlayerAvatar name={p.name} avatar={p.avatar} size={36} />
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {p.id === roomState.myPlayerId && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>(you)</span>
                )}
              </div>
              {p.isHost && <span className="badge-host">Host</span>}
            </div>
          ))}
        </div>

        {/* Audio setup trigger in lobby */}
        {onOpenSettings && (
          <div style={{ marginBottom: '1.25rem' }}>
            <button
              className="btn btn-secondary"
              onClick={onOpenSettings}
              style={{ width: '100%', padding: '0.65rem', fontSize: '0.88rem' }}
            >
              🎙️ Test Mic &amp; Audio Settings
            </button>
          </div>
        )}

        {isHost ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <button className="btn btn-primary" onClick={onStartSelectPrompt}
              style={{ width: '100%', padding: '0.9rem', fontSize: '1rem' }}>
              Pick a Sound Pack &amp; Start!
            </button>
            <button className="btn btn-secondary" onClick={openSecondTabTest}
              disabled={isFull}
              style={{ width: '100%', fontSize: '0.85rem', opacity: isFull ? 0.6 : 1 }}>
              {isFull ? 'Room Full (10/10 Players Max)' : 'Open a 2nd Tab to Test Locally'}
            </button>
          </div>
        ) : (
          <div style={{
            textAlign: 'center', padding: '1rem 1.25rem',
            background: 'var(--bg-card-2)', borderRadius: 'var(--radius-sm)',
            border: '1.5px solid var(--border-color)'
          }}>
            <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
              Waiting for the host to pick a sound pack...
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Create / Join screen ──
  return (
    <div className="card">
      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <img
          src={tintomLogo}
          alt="TinTom Simulator"
          onError={(e) => {
            e.currentTarget.src = `${import.meta.env.BASE_URL}images/tintom.png`;
          }}
          style={{
            width: 76,
            height: 76,
            borderRadius: 20,
            objectFit: 'cover',
            objectPosition: 'top center',
            boxShadow: '0 8px 24px rgba(244, 132, 95, 0.28)',
            border: '3px solid rgba(255, 255, 255, 0.9)',
            marginBottom: '0.6rem'
          }}
        />
        <h2 className="card-title" style={{ justifyContent: 'center', textAlign: 'center', marginBottom: '0.25rem' }}>Join TinTom Simulator</h2>
        <p className="card-subtitle" style={{ marginBottom: 0 }}>Create or join a room (up to 10 players)!</p>
      </div>

      {errorMsg && (
        <div style={{
          padding: '0.75rem 1rem', marginBottom: '1rem',
          background: 'rgba(240,82,82,0.08)', border: '1.5px solid rgba(240,82,82,0.3)',
          borderRadius: 'var(--radius-sm)', color: 'var(--danger)',
          fontSize: '0.88rem', fontWeight: 600
        }}>
          {errorMsg}
        </div>
      )}

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>
          Your username
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <PlayerAvatar
            name={playerName || 'Player'}
            size={48}
            style={{
              boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
              border: '2.5px solid rgba(255,255,255,0.9)'
            }}
          />
          <input
            type="text"
            className="input-field"
            placeholder="TinTom, MicMaster, SoundNinja..."
            value={playerName}
            maxLength={18}
            style={{ margin: 0, flex: 1 }}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            autoFocus
          />
        </div>
      </div>

      {onOpenSettings && (
        <div style={{ marginBottom: '1.25rem', textAlign: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onOpenSettings}
            style={{ width: '100%', padding: '0.6rem', fontSize: '0.84rem' }}
          >
            🎙️ Test Microphone &amp; Audio Before Playing
          </button>
        </div>
      )}

      <div className="grid-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading}
            style={{ width: '100%', padding: '0.85rem' }}>
            {loading ? 'Creating...' : 'Create Room'}
          </button>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', fontWeight: 600 }}>
            Host a game for friends
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <input type="text" className="input-field"
            placeholder="Room code (e.g. ABCD-1234)"
            value={inputRoomId}
            onChange={e => setInputRoomId(e.target.value.toUpperCase())}
          />
          <button className="btn btn-secondary" onClick={handleJoin} disabled={loading}
            style={{ width: '100%' }}>
            {loading ? 'Joining...' : 'Join Room'}
          </button>
        </div>
      </div>
    </div>
  );
}
