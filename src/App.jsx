import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import VoiceChatBar from './components/VoiceChatBar';
import AudioSettingsModal from './components/AudioSettingsModal';
import Lobby from './components/Lobby';
import PromptSelector from './components/PromptSelector';
import ListenPhase from './components/ListenPhase';
import RecordPhase from './components/RecordPhase';
import SoundReveal from './components/SoundReveal';
import Leaderboard from './components/Leaderboard';
import { peerManager } from './utils/peerManager';
import { voiceChatManager } from './utils/voiceChatManager';
import { stopCurrentAudio } from './utils/audioPlayer';
import { IconPause, IconPlay } from './components/Icons';

/**
 * Game Phase Flow (per sound in pack):
 *   LOBBY → PROMPT_SELECT → LISTEN → RECORDING → SOUND_REVEAL
 *              ↑                           (repeat for next sound)
 *              └─────── LISTEN (next sound) ←── SoundReveal.onNextSound
 *
 *   After all sounds are revealed → LEADERBOARD
 */
export default function App() {
  const [roomState, setRoomState] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    peerManager.init((updatedState) => {
      setRoomState(updatedState);
    });
  }, []);

  // Auto-enable voice chat as soon as player enters a room
  useEffect(() => {
    const peer = peerManager.getPeer();
    if (roomState?.roomId && peer) {
      voiceChatManager.startVoiceChat(
        peer,
        peerManager.getMyPeerId(),
        roomState.myPlayerId,
        roomState.players || []
      );
    }
  }, [roomState?.roomId, peerManager.getMyPeerId(), roomState?.myPlayerId]);

  // Re-bind voice chat if peer connection reconnects/recovers
  useEffect(() => {
    const unsub = peerManager.onConnectionStatus((status) => {
      if (status === 'connected' && roomState?.roomId) {
        const peer = peerManager.getPeer();
        if (peer) {
          voiceChatManager.startVoiceChat(
            peer,
            peerManager.getMyPeerId(),
            roomState.myPlayerId,
            roomState.players || []
          );
        }
      }
    });
    return () => unsub();
  }, [roomState?.roomId, roomState?.myPlayerId]);

  // Sync new players into the voice chat mesh
  useEffect(() => {
    if (roomState?.roomId && roomState?.players) {
      voiceChatManager.syncRoomPlayers(roomState.players);
    }
  }, [roomState?.players]);

  // Clear any stuck auto-mutes whenever game phase or sound transitions
  useEffect(() => {
    if (roomState?.gamePhase) {
      voiceChatManager.clearAllAutoMutes();
    }
  }, [roomState?.gamePhase, roomState?.currentSoundIndex]);

  // Avoid accidental refresh & warn on refresh when in a room or active game
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (roomState?.roomId) {
        e.preventDefault();
        e.returnValue = 'You are currently in a game room! Reloading will disconnect you.';
        return e.returnValue;
      }
    };

    const handleKeyDown = (e) => {
      const isReloadKey = (e.key === 'r' && (e.metaKey || e.ctrlKey)) || e.key === 'F5';
      if (isReloadKey && roomState?.roomId) {
        const confirmed = window.confirm(
          `⚠️ You are currently in room ${roomState.roomId}!\n\nReloading will disconnect you and reset the game. Are you sure you want to refresh?`
        );
        if (!confirmed) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [roomState?.roomId]);

  const handleHostStartPromptSelect = () => {
    peerManager.updateRoomState({ gamePhase: 'PROMPT_SELECT' });
  };

  const handleHostSelectSoundPack = (soundPackTitle, soundPackItems) => {
    const resetPlayers = (roomState?.players || []).map(p => ({
      ...p,
      recordings: [],
      scoreData: { overallScore: 0, totalScore: 0, averageScore: 0, soundScores: [] }
    }));

    peerManager.updateRoomState({
      gamePhase: 'LISTEN',
      soundPackTitle,
      soundPack: soundPackItems,
      currentSoundIndex: 0,
      revealPlayerIndex: 0,
      revealTimerStartTime: null,
      recordingCountdownEndTime: null,
      isPaused: false,
      pausedAt: null,
      listenReadyMap: {},
      listenPhaseStartTime: Date.now(),
      players: resetPlayers
    });
  };

  const handleStartRecordingPhase = useCallback(() => {
    peerManager.updateRoomState({
      gamePhase: 'RECORDING',
      recordPhaseStartTime: Date.now(),
      recordingCountdownEndTime: null,
      isPaused: false,
      pausedAt: null
    });
  }, []);

  // All players finished recording sound N → jump to SOUND_REVEAL for that sound
  const handleSoundComplete = useCallback(() => {
    peerManager.updateRoomState({
      gamePhase: 'SOUND_REVEAL',
      revealPlayerIndex: 0,
      revealTimerStartTime: null,
      recordPhaseStartTime: null,
      isPaused: false,
      pausedAt: null
    });
  }, []);

  // SoundReveal finished showing all players for sound N → go to next sound's LISTEN
  const handleNextSound = () => {
    const nextSoundIdx = (roomState.currentSoundIndex || 0) + 1;
    peerManager.updateRoomState({
      gamePhase: 'LISTEN',
      currentSoundIndex: nextSoundIdx,
      revealPlayerIndex: 0,
      revealTimerStartTime: null,
      recordingCountdownEndTime: null,
      isPaused: false,
      pausedAt: null,
      listenReadyMap: {},
      listenPhaseStartTime: Date.now()
    });
  };

  // SoundReveal finished the last sound → final LEADERBOARD with finalized total scores
  const handleFinishAllSounds = () => {
    const finalizedPlayers = (roomState?.players || []).map(p => {
      const validScores = (p.recordings || []).filter(Boolean).map(r => r.scoreResult?.overallScore || 0);
      const totalScore = validScores.reduce((a, b) => a + b, 0);
      const averageScore = validScores.length > 0 ? Math.round(totalScore / validScores.length) : (p.scoreData?.averageScore || 0);
      return {
        ...p,
        scoreData: {
          totalScore: totalScore || p.scoreData?.totalScore || p.scoreData?.overallScore || 0,
          overallScore: totalScore || p.scoreData?.overallScore || 0,
          averageScore,
          soundScores: validScores.length > 0 ? validScores : (p.scoreData?.soundScores || [])
        }
      };
    });

    peerManager.updateRoomState({
      gamePhase: 'LEADERBOARD',
      revealTimerStartTime: null,
      isPaused: false,
      pausedAt: null,
      players: finalizedPlayers
    });
  };

  const handleTogglePause = () => {
    if (!roomState?.isHost) return;

    if (!roomState.isPaused) {
      // Pause
      stopCurrentAudio();
      peerManager.updateRoomState({
        isPaused: true,
        pausedAt: Date.now()
      });
    } else {
      // Resume: offset timers by pause duration
      const pausedAt = roomState.pausedAt || Date.now();
      const pauseDuration = Math.max(0, Date.now() - pausedAt);

      const updates = {
        isPaused: false,
        pausedAt: null
      };

      if (roomState.listenPhaseStartTime) {
        updates.listenPhaseStartTime = roomState.listenPhaseStartTime + pauseDuration;
      }

      if (roomState.recordPhaseStartTime) {
        updates.recordPhaseStartTime = roomState.recordPhaseStartTime + pauseDuration;
      }

      if (roomState.revealTimerStartTime) {
        updates.revealTimerStartTime = roomState.revealTimerStartTime + pauseDuration;
      }

      peerManager.updateRoomState(updates);
    }
  };

  const handlePlayAgainNextRound = () => {
    peerManager.updateRoomState({
      gamePhase: 'PROMPT_SELECT',
      revealTimerStartTime: null,
      recordPhaseStartTime: null,
      isPaused: false,
      pausedAt: null
    });
  };

  const handleLeaveRoom = () => {
    if (!roomState?.roomId) return;
    const isGameActive = roomState.gamePhase && roomState.gamePhase !== 'LOBBY';
    const confirmText = isGameActive
      ? `Are you sure you want to leave room ${roomState.roomId}?\nThe game is currently in progress!`
      : `Are you sure you want to leave room ${roomState.roomId}?`;

    if (window.confirm(confirmText)) {
      voiceChatManager.leaveVoiceChat();
      peerManager.leaveRoom(true);
      setRoomState(null);
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  };

  const gamePhase = roomState?.gamePhase || 'LOBBY';

  return (
    <>
      <Header
        roomState={roomState}
        myPlayerId={roomState?.myPlayerId}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLeaveRoom={handleLeaveRoom}
        onTogglePause={handleTogglePause}
      />

      {roomState?.roomId && (
        <VoiceChatBar
          roomState={roomState}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}

      <main
        key={`${gamePhase}-${roomState?.currentSoundIndex || 0}`}
        className="phase-view-transition"
        style={{ width: '100%' }}
      >
        {gamePhase === 'LOBBY' && (
          <Lobby
            roomState={roomState}
            onStartSelectPrompt={handleHostStartPromptSelect}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onLeaveRoom={handleLeaveRoom}
          />
        )}

        {gamePhase === 'PROMPT_SELECT' && (
          <PromptSelector roomState={roomState} onSelectSoundPack={handleHostSelectSoundPack} />
        )}

        {gamePhase === 'LISTEN' && (
          <ListenPhase roomState={roomState} onStartRecordingPhase={handleStartRecordingPhase} />
        )}

        {gamePhase === 'RECORDING' && (
          <RecordPhase
            roomState={roomState}
            onSoundComplete={handleSoundComplete}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}

        {gamePhase === 'SOUND_REVEAL' && (
          <SoundReveal
            roomState={roomState}
            onNextSound={handleNextSound}
            onFinishAllSounds={handleFinishAllSounds}
          />
        )}

        {gamePhase === 'LEADERBOARD' && (
          <Leaderboard roomState={roomState} onPlayAgain={handlePlayAgainNextRound} />
        )}
      </main>

      <AudioSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* ── Synchronized Game Paused Overlay ── */}
      {roomState?.isPaused && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.78)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 9000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div className="card" style={{
            maxWidth: 440,
            width: '100%',
            textAlign: 'center',
            padding: '2.2rem 1.8rem',
            border: '2px solid var(--warning)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5), 0 0 35px rgba(245, 158, 11, 0.25)'
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'rgba(245, 158, 11, 0.15)',
              color: 'var(--warning)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1.1rem',
              boxShadow: '0 0 20px rgba(245, 158, 11, 0.3)'
            }}>
              <IconPause size={32} />
            </div>

            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.8rem',
              fontWeight: 800,
              marginBottom: '0.6rem',
              color: '#fff'
            }}>
              Game Paused
            </h2>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.94rem', lineHeight: 1.55, marginBottom: '1.5rem' }}>
              {roomState.isHost
                ? 'You have paused the game. Timers and audio are frozen. Voice chat remains LIVE so you can discuss with everyone!'
                : `${roomState.players?.find(p => p.isHost)?.name || 'The host'} has paused the game. Voice chat is active — feel free to talk!`
              }
            </p>

            {roomState.isHost ? (
              <button
                className="btn btn-primary"
                onClick={handleTogglePause}
                style={{
                  width: '100%',
                  padding: '0.95rem',
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 0 24px rgba(244, 132, 95, 0.4)'
                }}
              >
                <IconPlay size={18} fill="currentColor" /> Resume Game
              </button>
            ) : (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.88rem',
                color: 'var(--warning)',
                fontWeight: 700
              }}>
                <span className="status-dot status-connected" style={{ background: 'var(--warning)' }} />
                Waiting for host to resume...
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
