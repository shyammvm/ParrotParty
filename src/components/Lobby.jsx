import React, { useState, useEffect } from 'react';
import { peerManager } from '../utils/peerManager';
import { roomDirectory } from '../utils/roomDirectory';
import { PlayerAvatar } from '../utils/avatarUtils';
import parrotLogo from '../assets/parrot-party.png';
import { IconLogOut, IconRefresh, IconLock, IconSettings, IconX } from './Icons';

export default function Lobby({ roomState, onStartSelectPrompt, onOpenSettings, onLeaveRoom }) {
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('parrot_player_name') || localStorage.getItem('tintom_player_name') || '');
  const [inputRoomId, setInputRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Active rooms discovery & saved room session
  const [activeRooms, setActiveRooms] = useState([]);
  const [savedRoom, setSavedRoom] = useState(null);

  // Passcode modal state for joining active room with code
  const [passcodeModalRoom, setPasscodeModalRoom] = useState(null);
  const [passcodeModalCode, setPasscodeModalCode] = useState('');
  const [passcodeModalError, setPasscodeModalError] = useState('');

  useEffect(() => {
    // 1. Check URL parameters for 4-digit room code
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      const sanitized = roomParam.replace(/[^0-9]/g, '').slice(0, 4);
      if (sanitized) setInputRoomId(sanitized);
    }

    // 2. Error callback from peerManager
    peerManager.setOnError((err) => {
      setErrorMsg(err);
      setLoading(false);
    });

    // 3. Check for recently saved room session (last 2 hours)
    try {
      const rawSaved = localStorage.getItem('tintom_last_room');
      if (rawSaved) {
        const parsed = JSON.parse(rawSaved);
        if (parsed && parsed.roomId && Date.now() - (parsed.timestamp || 0) < 2 * 60 * 60 * 1000) {
          setSavedRoom(parsed);
        }
      }
    } catch (e) {}

    // 4. Subscribe to live active rooms directory
    const unsubscribe = roomDirectory.subscribe((rooms) => {
      setActiveRooms(rooms);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleCreate = async () => {
    if (!playerName.trim()) { setErrorMsg('Please enter your player name!'); return; }
    setErrorMsg(''); setLoading(true);
    localStorage.setItem('tintom_player_name', playerName.trim());
    try {
      await peerManager.createRoom(playerName.trim());
    } catch (e) {
      setErrorMsg('Error creating room: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!playerName.trim()) { setErrorMsg('Please enter your player name!'); return; }
    const cleanCode = inputRoomId.replace(/[^0-9]/g, '').slice(0, 4);
    if (!cleanCode || cleanCode.length !== 4) {
      setErrorMsg('Please enter a valid 4-digit Room Code!');
      return;
    }
    setErrorMsg(''); setLoading(true);
    localStorage.setItem('tintom_player_name', playerName.trim());
    try {
      await peerManager.joinRoom(cleanCode, playerName.trim());
    } catch (e) {
      setErrorMsg(e.message || 'Error joining room');
    } finally {
      setLoading(false);
    }
  };

  const handleRejoin = async (saved) => {
    if (!saved || !saved.roomId) return;
    setErrorMsg('');
    setLoading(true);
    const useName = playerName.trim() || saved.playerName || 'Player';
    localStorage.setItem('tintom_player_name', useName);

    try {
      await peerManager.rejoinRoom(
        saved.roomId,
        useName,
        saved.playerId,
        saved.avatar
      );
    } catch (e) {
      setErrorMsg(`Could not rejoin Room #${saved.roomId}: ${e.message || 'Host offline or room deleted.'}`);
      try {
        localStorage.removeItem('tintom_last_room');
      } catch (err) {}
      setSavedRoom(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDismissRejoin = () => {
    try {
      localStorage.removeItem('tintom_last_room');
    } catch (e) {}
    setSavedRoom(null);
  };

  const handleOpenPasscodeModal = (room) => {
    setPasscodeModalRoom(room);
    setPasscodeModalCode('');
    setPasscodeModalError('');
  };

  const handlePasscodeJoin = async () => {
    if (!playerName.trim()) {
      setPasscodeModalError('Please enter your username above first!');
      return;
    }
    const cleanCode = passcodeModalCode.replace(/[^0-9]/g, '').slice(0, 4);
    if (!cleanCode || cleanCode.length !== 4) {
      setPasscodeModalError('Please enter the 4-digit room code!');
      return;
    }

    setPasscodeModalError('');
    setLoading(true);

    try {
      const isVerified = await roomDirectory.verifyRoomCode(passcodeModalRoom, cleanCode);
      if (!isVerified) {
        setPasscodeModalError('Incorrect room code! Please ask the host for the 4-digit code.');
        setLoading(false);
        return;
      }

      localStorage.setItem('tintom_player_name', playerName.trim());
      await peerManager.joinRoom(cleanCode, playerName.trim());
      setPasscodeModalRoom(null);
      setPasscodeModalCode('');
    } catch (e) {
      setPasscodeModalError(e.message || 'Error joining room');
    } finally {
      setLoading(false);
    }
  };

  const openSecondTabTest = () => {
    if (roomState?.roomId && roomState.players.length < 10) {
      const url = `${window.location.origin}${window.location.pathname}?room=${roomState.roomId}`;
      window.open(url, '_blank');
    }
  };

  // ── In-room lobby view ──
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
          Share 4-digit room code <strong style={{ color: 'var(--primary)', fontFamily: 'var(--font-display)', fontSize: '1.1rem', letterSpacing: '2px' }}>{roomState.roomId}</strong> with friends! (Max 10 players)
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
              style={{ width: '100%', padding: '0.65rem', fontSize: '0.88rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
            >
              <IconSettings size={14} /> Test Mic &amp; Audio Settings
            </button>
          </div>
        )}

        {isHost ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <button className="btn btn-primary" onClick={onStartSelectPrompt}
              style={{ width: '100%', padding: '0.9rem', fontSize: '1rem' }}>
              Pick a Sound Pack &amp; Start!
            </button>
            {import.meta.env.DEV && (
              <button className="btn btn-secondary" onClick={openSecondTabTest}
                disabled={isFull}
                style={{ width: '100%', fontSize: '0.85rem', opacity: isFull ? 0.6 : 1 }}>
                {isFull ? 'Room Full (10/10 Players Max)' : 'Open a 2nd Tab to Test Locally'}
              </button>
            )}
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

        {/* Leave Room option in lobby */}
        {onLeaveRoom && (
          <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border-color)' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onLeaveRoom}
              style={{
                width: '100%',
                padding: '0.6rem',
                fontSize: '0.84rem',
                color: 'var(--danger)',
                borderColor: 'rgba(240, 82, 82, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem'
              }}
            >
              <IconLogOut size={14} /> Leave Room
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Main Create / Join / Active Rooms Screen ──
  return (
    <div className="card">
      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <img
          src={parrotLogo}
          alt="Parrot Party"
          onError={(e) => {
            e.currentTarget.src = `${import.meta.env.BASE_URL}images/parrot-party.png`;
          }}
          style={{
            width: 76,
            height: 76,
            borderRadius: 20,
            objectFit: 'cover',
            objectPosition: 'center',
            boxShadow: '0 8px 24px rgba(56, 189, 248, 0.25)',
            border: '3px solid rgba(255, 255, 255, 0.9)',
            marginBottom: '0.6rem'
          }}
        />
        <h2 className="card-title" style={{ justifyContent: 'center', textAlign: 'center', marginBottom: '0.2rem' }}>
          Join Parrot Party
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--primary)', fontWeight: 700, margin: '0 0 0.35rem 0', letterSpacing: '0.01em' }}>
          Good vibes, terrible impressions.
        </p>
        <p className="card-subtitle" style={{ marginBottom: 0 }}>
          Create or join a room with a 4-digit code (up to 10 players)!
        </p>
      </div>

      {/* Rejoin Previous Game Banner */}
      {savedRoom && (
        <div className="rejoin-banner">
          <div className="rejoin-info">
            <PlayerAvatar name={savedRoom.playerName || 'Player'} avatar={savedRoom.avatar} size={40} />
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                Rejoin Previous Session
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Room <strong style={{ color: 'var(--primary)', letterSpacing: '1px' }}>#{savedRoom.roomId}</strong> as <strong>{savedRoom.playerName}</strong>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleRejoin(savedRoom)}
              disabled={loading}
              style={{ padding: '0.45rem 0.95rem', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <IconRefresh size={13} /> Rejoin Room
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDismissRejoin}
              style={{ padding: '0.45rem 0.65rem', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              title="Dismiss saved room"
            >
              <IconX size={12} />
            </button>
          </div>
        </div>
      )}

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
            placeholder="PartyParrot, MicMaster, SoundNinja..."
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
        <div style={{ marginBottom: '1.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onOpenSettings}
            style={{ width: '100%', padding: '0.6rem', fontSize: '0.84rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
          >
            <IconSettings size={14} /> Test Microphone &amp; Audio Before Playing
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
            Generates a 4-digit code
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <input
            type="text"
            inputMode="numeric"
            className="input-field"
            placeholder="4-digit code (e.g. 4821)"
            maxLength={4}
            value={inputRoomId}
            style={{ letterSpacing: '3px', fontWeight: 700, textAlign: 'center' }}
            onChange={e => setInputRoomId(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            onKeyDown={e => { if (e.key === 'Enter') handleJoin(); }}
          />
          <button className="btn btn-secondary" onClick={handleJoin} disabled={loading}
            style={{ width: '100%' }}>
            {loading ? 'Joining...' : 'Join with Code'}
          </button>
        </div>
      </div>

      {/* ── Active Rooms Browser (Lobby Discovery) ── */}
      <div className="active-rooms-section">
        <div className="active-rooms-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#10b981',
              boxShadow: '0 0 8px #10b981'
            }} />
            <h3 style={{
              fontFamily: 'var(--font-display)', fontSize: '1.05rem',
              fontWeight: 700, margin: 0, color: 'var(--text-main)'
            }}>
              Active Rooms
            </h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {activeRooms.length} room{activeRooms.length === 1 ? '' : 's'} online
          </span>
        </div>

        {activeRooms.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '1.25rem',
            background: 'var(--bg-card-2)', borderRadius: 'var(--radius-sm)',
            border: '1.5px dashed var(--border-color)', color: 'var(--text-muted)',
            fontSize: '0.85rem', fontWeight: 600
          }}>
            No active rooms discovered right now. Create a room above to start playing!
          </div>
        ) : (
          <div className="active-rooms-list">
            {activeRooms.map((room) => {
              const isFull = room.playerCount >= (room.maxPlayers || 10);
              const inGame = room.gamePhase && room.gamePhase !== 'LOBBY';

              return (
                <div key={room.advertId} className="active-room-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <PlayerAvatar name={room.hostName || 'Host'} size={38} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main)' }}>
                        {room.hostName ? `${room.hostName}'s Room` : 'Party Room'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                        <span style={{
                          fontSize: '0.75rem', fontWeight: 700,
                          color: isFull ? 'var(--accent)' : 'var(--primary)'
                        }}>
                          {room.playerCount} / {room.maxPlayers || 10} players
                        </span>
                        <span className={inGame ? 'active-room-badge-game' : 'active-room-badge-lobby'}>
                          {inGame ? 'In Game' : 'Waiting in Lobby'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <span style={{
                      fontSize: '0.72rem', color: 'var(--text-muted)',
                      fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.25rem'
                    }} title="4-digit room code is required to enter this room">
                      <IconLock size={12} /> Code Required
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleOpenPasscodeModal(room)}
                      disabled={loading || isFull || inGame}
                      style={{ padding: '0.45rem 0.95rem', fontSize: '0.82rem' }}
                    >
                      {inGame ? 'In Progress' : isFull ? 'Full' : 'Join'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Passcode Protected Room Entry Modal ── */}
      {passcodeModalRoom && (
        <div className="passcode-modal-overlay" onClick={() => setPasscodeModalRoom(null)}>
          <div className="passcode-modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem' }}>
              <IconLock size={32} color="var(--primary)" />
            </div>
            <h3 style={{
              fontFamily: 'var(--font-display)', fontSize: '1.25rem',
              fontWeight: 700, marginBottom: '0.25rem', color: 'var(--text-main)'
            }}>
              Enter Room Code
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.8rem' }}>
              Enter the 4-digit code for <strong>{passcodeModalRoom.hostName}'s Room</strong>
            </p>

            {passcodeModalError && (
              <div style={{
                padding: '0.5rem 0.8rem', marginBottom: '0.8rem',
                background: 'rgba(240,82,82,0.08)', border: '1.5px solid rgba(240,82,82,0.3)',
                borderRadius: 'var(--radius-sm)', color: 'var(--danger)',
                fontSize: '0.82rem', fontWeight: 600
              }}>
                {passcodeModalError}
              </div>
            )}

            <input
              type="text"
              inputMode="numeric"
              className="code-input-4digit"
              placeholder="----"
              maxLength={4}
              value={passcodeModalCode}
              onChange={e => setPasscodeModalCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              onKeyDown={e => { if (e.key === 'Enter') handlePasscodeJoin(); }}
              autoFocus
            />

            <div style={{ display: 'flex', gap: '0.65rem', marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPasscodeModalRoom(null)}
                style={{ flex: 1, padding: '0.7rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePasscodeJoin}
                disabled={loading || passcodeModalCode.length !== 4}
                style={{ flex: 1, padding: '0.7rem' }}
              >
                {loading ? 'Verifying...' : 'Enter Room'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
