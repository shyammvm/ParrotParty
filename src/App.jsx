import React, { useState, useEffect } from 'react';
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
  }, [roomState?.roomId, peerManager.getMyPeerId()]);

  // Sync new players into the voice chat mesh
  useEffect(() => {
    if (roomState?.roomId && roomState?.players) {
      voiceChatManager.syncRoomPlayers(roomState.players);
    }
  }, [roomState?.players]);

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
    const resetPlayers = roomState.players.map(p => ({
      ...p,
      recordings: [],
      scoreData: { overallScore: 0, soundScores: [] }
    }));

    peerManager.updateRoomState({
      gamePhase: 'LISTEN',
      soundPackTitle,
      soundPack: soundPackItems,
      currentSoundIndex: 0,
      revealPlayerIndex: 0,
      players: resetPlayers
    });
  };

  const handleStartRecordingPhase = () => {
    peerManager.updateRoomState({ gamePhase: 'RECORDING' });
  };

  // All players finished recording sound N → jump to SOUND_REVEAL for that sound
  const handleSoundComplete = () => {
    peerManager.updateRoomState({
      gamePhase: 'SOUND_REVEAL',
      revealPlayerIndex: 0
    });
  };

  // SoundReveal finished showing all players for sound N → go to next sound's LISTEN
  const handleNextSound = () => {
    const nextSoundIdx = (roomState.currentSoundIndex || 0) + 1;
    peerManager.updateRoomState({
      gamePhase: 'LISTEN',
      currentSoundIndex: nextSoundIdx,
      revealPlayerIndex: 0
    });
  };

  // SoundReveal finished the last sound → final LEADERBOARD
  const handleFinishAllSounds = () => {
    peerManager.updateRoomState({ gamePhase: 'LEADERBOARD' });
  };

  const handlePlayAgainNextRound = () => {
    peerManager.updateRoomState({ gamePhase: 'PROMPT_SELECT' });
  };

  const gamePhase = roomState?.gamePhase || 'LOBBY';

  return (
    <>
      <Header
        roomState={roomState}
        myPlayerId={roomState?.myPlayerId}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {roomState?.roomId && (
        <VoiceChatBar
          roomState={roomState}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}

      <main style={{ width: '100%' }}>
        {gamePhase === 'LOBBY' && (
          <Lobby
            roomState={roomState}
            onStartSelectPrompt={handleHostStartPromptSelect}
            onOpenSettings={() => setIsSettingsOpen(true)}
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
    </>
  );
}
