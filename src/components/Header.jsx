import React, { useState, useEffect } from 'react';
import { PlayerAvatar } from '../utils/avatarUtils';
import { peerManager } from '../utils/peerManager';
import parrotLogo from '../assets/parrot-party.png';
import { IconShare, IconCheck, IconLogOut, IconSettings } from './Icons';

export default function Header({ roomState, myPlayerId, onOpenSettings, onLeaveRoom }) {
  const [copied, setCopied] = useState(false);
  const [connStatus, setConnStatus] = useState(() => peerManager.getConnectionStatus());

  useEffect(() => {
    const unsub = peerManager.onConnectionStatus((status) => {
      setConnStatus(status);
    });
    return () => unsub();
  }, []);

  const handleManualReconnect = () => {
    if (!roomState?.isHost) {
      peerManager.reconnectToHost();
    } else {
      peerManager.broadcastState();
    }
  };

  const copyRoomLink = () => {
    if (!roomState?.roomId) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${roomState.roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const myPlayer = roomState?.players?.find(p => p.id === myPlayerId);

  return (
    <header className="card app-header">
      <div className="header-container">

        {/* Brand Group */}
        <div className="header-brand">
          <img
            src={parrotLogo}
            alt="Parrot Party Logo"
            onError={(e) => {
              e.currentTarget.src = `${import.meta.env.BASE_URL}images/parrot-party.png`;
            }}
            className="header-logo"
          />
          <div className="header-title-group">
            <h1 className="header-title">Parrot Party</h1>
            <span className="header-tagline">Good vibes, terrible impressions.</span>
          </div>
        </div>

        {/* Room Info, Connection Badge & Share Link (Active Room) */}
        {roomState?.roomId && (
          <div className="header-room-group">
            <div className="header-room-badge">
              <span className="header-room-badge-label">ROOM</span>
              <strong className="header-room-badge-code">{roomState.roomId}</strong>
              <span className="header-room-badge-count">
                ({roomState.players?.length || 0}/10)
              </span>
            </div>

            {/* Real-time Connection Status Indicator */}
            <div
              className={`header-status-badge status-${connStatus}`}
              title={
                connStatus === 'connected'
                  ? 'Real-time connection is live & synced'
                  : 'Reconnecting to game host...'
              }
            >
              <span className={`status-dot status-${connStatus}`} />
              <span className="status-text">
                {connStatus === 'connected'
                  ? 'Synced'
                  : connStatus === 'reconnecting'
                    ? 'Reconnecting...'
                    : 'Disconnected'}
              </span>

              {connStatus !== 'connected' && !roomState.isHost && (
                <button
                  type="button"
                  onClick={handleManualReconnect}
                  className="status-retry-btn"
                >
                  Retry
                </button>
              )}
            </div>

            {/* Share Link button (Lobby phase) */}
            {(!roomState.gamePhase || roomState.gamePhase === 'LOBBY') && (
              <button
                type="button"
                className="btn btn-secondary header-btn header-share-btn"
                onClick={copyRoomLink}
                title="Copy share link to clipboard"
              >
                {copied ? (
                  <>
                    <IconCheck size={13} />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <IconShare size={13} />
                    <span>Share<span className="btn-label-desktop"> Link</span></span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* User Actions: Mic Setup, Leave, Avatar */}
        <div className={`header-actions-group ${!roomState?.roomId ? 'no-room' : ''}`}>
          {/* Universal Mic Settings Button */}
          {onOpenSettings && (
            <button
              type="button"
              className="btn btn-secondary header-btn header-mic-btn"
              onClick={onOpenSettings}
              title="Microphone & Audio Settings"
            >
              <IconSettings size={13} />
              <span>Mic<span className="btn-label-desktop"> Setup</span></span>
            </button>
          )}

          {/* Leave Button */}
          {roomState?.roomId && onLeaveRoom && (
            <button
              type="button"
              className="btn btn-danger header-btn header-leave-btn"
              onClick={onLeaveRoom}
              title="Leave this game room"
            >
              <IconLogOut size={13} />
              <span>Leave</span>
            </button>
          )}

          {/* Player Avatar */}
          {myPlayer && (
            <div className="header-avatar-wrap" title={myPlayer.name}>
              <PlayerAvatar name={myPlayer.name} avatar={myPlayer.avatar} size={32} />
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
