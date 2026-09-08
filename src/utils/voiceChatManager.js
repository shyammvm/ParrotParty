/**
 * WebRTC Voice Chat Manager (PeerJS Mesh)
 * Features:
 * - Auto-enabled P2P audio mesh across room players.
 * - Universal microphone integration with on-the-fly track replacement.
 * - Auto-pause / auto-mute during recording and audio playback, resuming immediately.
 * - Real-time Voice Activity Detection (VAD) for speaking indicators on avatars.
 * - Manual Mute / Deafen controls.
 */

import { audioDeviceManager } from './audioDeviceManager';

class VoiceChatManager {
  constructor() {
    this.peer = null;
    this.myPeerId = null;
    this.myPlayerId = null;
    this.localStream = null;
    this.calls = new Map(); // remotePeerId -> MediaConnection
    this.remoteAudioElements = new Map(); // remotePeerId -> HTMLAudioElement
    this.remoteStreams = new Map(); // remotePeerId -> MediaStream

    // State
    this.isManuallyMuted = false;
    this.isManuallyDeafened = false;
    this.autoMuteReasons = new Set();
    this.speakingMap = {}; // playerId/peerId -> boolean
    this.listeners = new Set();

    // VAD (Voice Activity Detection)
    this.audioContext = null;
    this.localAnalyser = null;
    this.remoteAnalysers = new Map(); // remotePeerId -> AnalyserNode
    this.vadInterval = null;
    this.speakingHoldTimes = new Map(); // id -> timestamp

    // Subscribe to universal mic changes
    this.unsubscribeMic = audioDeviceManager.subscribe((deviceId) => {
      this.handleDeviceChange(deviceId);
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    this.emitState();
    return () => this.listeners.delete(listener);
  }

  emitState() {
    const isAutoMuted = this.autoMuteReasons.size > 0;
    const effectiveMuted = this.isManuallyMuted || isAutoMuted;
    const effectiveDeafened = this.isManuallyDeafened || isAutoMuted;

    const state = {
      isAutoMuted,
      autoMuteReasons: Array.from(this.autoMuteReasons),
      isManuallyMuted: this.isManuallyMuted,
      isManuallyDeafened: this.isManuallyDeafened,
      effectiveMuted,
      effectiveDeafened,
      connectedPeersCount: this.calls.size,
      speakingMap: { ...this.speakingMap },
      localVolumeLevel: this.localVolumeLevel || 0
    };

    this.listeners.forEach((fn) => {
      try { fn(state); } catch (e) { console.error('[voiceChatManager] Listener error:', e); }
    });
  }

  /**
   * Start auto-enabled voice chat for the given room
   */
  async startVoiceChat(peerInstance, myPeerId, myPlayerId, roomPlayers = []) {
    if (!peerInstance) return;

    this.peer = peerInstance;
    this.myPeerId = myPeerId;
    this.myPlayerId = myPlayerId;

    // 1. Register incoming call listener IMMEDIATELY so no calls are missed
    if (!this.callListenerRegistered) {
      this.callListenerRegistered = true;
      this.peer.on('call', async (incomingCall) => {
        // If local mic is still acquiring, wait for it so we never answer with null!
        if (this.acquireStreamPromise) {
          try { await this.acquireStreamPromise; } catch (e) {}
        }
        this.handleIncomingCall(incomingCall);
      });
    }

    // 2. Acquire local audio stream from universal mic manager
    if (!this.localStream) {
      this.acquireStreamPromise = audioDeviceManager.getUniversalAudioStream()
        .then((stream) => {
          this.localStream = stream;
          this.acquireStreamPromise = null;
          return stream;
        })
        .catch((err) => {
          console.warn('[voiceChatManager] Microphone access warning:', err);
          this.acquireStreamPromise = null;
          return null;
        });
      await this.acquireStreamPromise;
    }

    // Apply mute states
    this.updateTrackAndAudioStates();

    // Setup VAD
    this.setupAudioContextAndVad();

    // Mesh call with known room players
    this.syncRoomPlayers(roomPlayers);
    this.emitState();
  }

  /**
   * Synchronize active calls with the current list of room players
   */
  syncRoomPlayers(roomPlayers = []) {
    if (!this.peer || !this.myPeerId || !this.localStream) return;

    roomPlayers.forEach((player) => {
      const remotePeerId = player.peerId || player.id;
      if (!remotePeerId || remotePeerId === this.myPeerId) return;

      // To avoid duplicate simultaneous calls, peer with smaller ID initiates
      if (this.myPeerId < remotePeerId && !this.calls.has(remotePeerId)) {
        this.callPeer(remotePeerId);
      }
    });
  }

  callPeer(remotePeerId) {
    if (!this.peer || !this.localStream || this.calls.has(remotePeerId)) return;

    try {
      const call = this.peer.call(remotePeerId, this.localStream);
      if (!call) return;

      this.calls.set(remotePeerId, call);

      call.on('stream', (remoteStream) => {
        this.attachRemoteStream(remotePeerId, remoteStream);
      });

      call.on('close', () => {
        this.cleanupPeer(remotePeerId);
      });

      call.on('error', (err) => {
        console.warn(`[voiceChatManager] Call error with ${remotePeerId}:`, err);
        this.cleanupPeer(remotePeerId);
      });
    } catch (e) {
      console.warn(`[voiceChatManager] Failed to call ${remotePeerId}:`, e);
    }
  }

  handleIncomingCall(incomingCall) {
    const remotePeerId = incomingCall.peer;
    this.calls.set(remotePeerId, incomingCall);

    if (this.localStream) {
      incomingCall.answer(this.localStream);
    } else {
      incomingCall.answer();
    }

    incomingCall.on('stream', (remoteStream) => {
      this.attachRemoteStream(remotePeerId, remoteStream);
    });

    incomingCall.on('close', () => {
      this.cleanupPeer(remotePeerId);
    });

    incomingCall.on('error', (err) => {
      console.warn(`[voiceChatManager] Incoming call error from ${remotePeerId}:`, err);
      this.cleanupPeer(remotePeerId);
    });

    this.emitState();
  }

  attachRemoteStream(remotePeerId, remoteStream) {
    this.remoteStreams.set(remotePeerId, remoteStream);

    // Ensure audio element is created and mounted in DOM
    let audioEl = this.remoteAudioElements.get(remotePeerId);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.id = `tintom-remote-audio-${remotePeerId}`;
      audioEl.style.position = 'fixed';
      audioEl.style.left = '-9999px';
      audioEl.style.top = '-9999px';
      audioEl.style.width = '1px';
      audioEl.style.height = '1px';
      audioEl.style.opacity = '0';
      document.body.appendChild(audioEl);
      this.remoteAudioElements.set(remotePeerId, audioEl);
    }

    audioEl.srcObject = remoteStream;
    audioEl.muted = this.isManuallyDeafened || this.autoMuteReasons.size > 0;
    audioEl.volume = 1.0;

    const playAudio = () => {
      audioEl.play().catch((err) => {
        console.log(`[voiceChatManager] Audio play pending user interaction:`, err);
        const resumeOnUserAction = () => {
          audioEl.play().catch(() => {});
          window.removeEventListener('click', resumeOnUserAction);
          window.removeEventListener('keydown', resumeOnUserAction);
        };
        window.addEventListener('click', resumeOnUserAction, { once: true });
        window.addEventListener('keydown', resumeOnUserAction, { once: true });
      });
    };
    playAudio();

    // Dual audio pipeline: also route through Web Audio destination with Gain control!
    if (this.audioContext) {
      try {
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
        const source = this.audioContext.createMediaStreamSource(remoteStream);

        // Analyser for remote speaking detection
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        this.remoteAnalysers.set(remotePeerId, analyser);

        // GainNode connected to destination
        const gainNode = this.audioContext.createGain();
        const effectiveDeafened = this.isManuallyDeafened || this.autoMuteReasons.size > 0;
        gainNode.gain.setValueAtTime(effectiveDeafened ? 0 : 1, this.audioContext.currentTime);
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        this.remoteGainNodes = this.remoteGainNodes || new Map();
        this.remoteGainNodes.set(remotePeerId, gainNode);
      } catch (e) {
        console.warn('[voiceChatManager] Remote stream Web Audio setup warning:', e);
      }
    }

    this.emitState();
  }

  cleanupPeer(remotePeerId) {
    const call = this.calls.get(remotePeerId);
    if (call) {
      try { call.close(); } catch (e) {}
      this.calls.delete(remotePeerId);
    }

    const audioEl = this.remoteAudioElements.get(remotePeerId);
    if (audioEl) {
      audioEl.pause();
      audioEl.srcObject = null;
      if (audioEl.parentNode) {
        audioEl.parentNode.removeChild(audioEl);
      }
      this.remoteAudioElements.delete(remotePeerId);
    }

    if (this.remoteGainNodes && this.remoteGainNodes.has(remotePeerId)) {
      try {
        this.remoteGainNodes.get(remotePeerId).disconnect();
      } catch (e) {}
      this.remoteGainNodes.delete(remotePeerId);
    }

    this.remoteStreams.delete(remotePeerId);
    this.remoteAnalysers.delete(remotePeerId);
    delete this.speakingMap[remotePeerId];

    this.emitState();
  }

  /**
   * Universal mic changed in settings -> swap audio track in-place across active calls
   */
  async handleDeviceChange(deviceId) {
    if (!this.peer || !this.localStream) return;

    try {
      const newStream = await audioDeviceManager.getUniversalAudioStream();
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      const oldTrack = this.localStream.getAudioTracks()[0];
      if (oldTrack) {
        oldTrack.stop();
        this.localStream.removeTrack(oldTrack);
      }
      this.localStream.addTrack(newTrack);

      // In-place replace track on all active peer connections
      this.calls.forEach((call) => {
        try {
          const pc = call.peerConnection;
          if (pc) {
            const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
            if (sender) {
              sender.replaceTrack(newTrack);
            }
          }
        } catch (e) {}
      });

      this.updateTrackAndAudioStates();
    } catch (err) {
      console.warn('[voiceChatManager] Error updating mic track:', err);
    }
  }

  /**
   * Auto-pause / auto-mute hook.
   * reason: 'RECORDING' | 'DEMO_PLAYBACK' | 'REVEAL_PLAYBACK'
   * enabled: true to pause, false to resume immediately
   */
  setAutoMuted(reason, enabled) {
    if (enabled) {
      this.autoMuteReasons.add(reason);
    } else {
      this.autoMuteReasons.delete(reason);
    }
    this.updateTrackAndAudioStates();
    this.emitState();
  }

  toggleMute() {
    this.isManuallyMuted = !this.isManuallyMuted;
    this.updateTrackAndAudioStates();
    this.emitState();
  }

  toggleDeafen() {
    this.isManuallyDeafened = !this.isManuallyDeafened;
    this.updateTrackAndAudioStates();
    this.emitState();
  }

  updateTrackAndAudioStates() {
    const isAutoMuted = this.autoMuteReasons.size > 0;
    const effectiveMuted = this.isManuallyMuted || isAutoMuted;
    const effectiveDeafened = this.isManuallyDeafened || isAutoMuted;

    // Local microphone track
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !effectiveMuted;
      });
    }

    // Remote audio elements
    this.remoteAudioElements.forEach((audioEl) => {
      audioEl.muted = effectiveDeafened;
    });
  }

  setupAudioContextAndVad() {
    if (this.vadInterval) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
        const unlock = () => {
          this.audioContext.resume().catch(() => {});
          window.removeEventListener('click', unlock);
          window.removeEventListener('keydown', unlock);
        };
        window.addEventListener('click', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
      }

      if (this.localStream) {
        const localSource = this.audioContext.createMediaStreamSource(this.localStream);
        this.localAnalyser = this.audioContext.createAnalyser();
        this.localAnalyser.fftSize = 256;
        localSource.connect(this.localAnalyser);
      }

      const timeBuffer = new Float32Array(256);
      const SPEAKING_THRESHOLD = 0.025; // Responsive time-domain peak threshold for normal speech

      this.vadInterval = setInterval(() => {
        if (!this.audioContext) return;
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
        const now = Date.now();
        let changed = false;

        const effectiveMuted = this.isManuallyMuted || this.autoMuteReasons.size > 0;
        const effectiveDeafened = this.isManuallyDeafened || this.autoMuteReasons.size > 0;

        // Check local speaking
        if (this.localAnalyser && !effectiveMuted && this.myPlayerId) {
          this.localAnalyser.getFloatTimeDomainData(timeBuffer);
          let peak = 0;
          for (let i = 0; i < timeBuffer.length; i++) {
            const abs = Math.abs(timeBuffer[i]);
            if (abs > peak) peak = abs;
          }

          const currentVol = Math.min(100, Math.round(Math.pow(peak, 0.55) * 100));
          if (this.localVolumeLevel !== currentVol) {
            this.localVolumeLevel = currentVol;
            changed = true;
          }

          const isSpeakingNow = peak > SPEAKING_THRESHOLD;
          if (isSpeakingNow) {
            this.speakingHoldTimes.set(this.myPlayerId, now + 400); // 400ms hold for speech cadence
          }

          const isSpeaking = (this.speakingHoldTimes.get(this.myPlayerId) || 0) > now;
          if (this.speakingMap[this.myPlayerId] !== isSpeaking) {
            this.speakingMap[this.myPlayerId] = isSpeaking;
            changed = true;
          }
        } else if (this.myPlayerId && this.speakingMap[this.myPlayerId]) {
          this.speakingMap[this.myPlayerId] = false;
          this.localVolumeLevel = 0;
          changed = true;
        }

        // Check remote peers speaking
        if (!effectiveDeafened) {
          this.remoteAnalysers.forEach((analyser, peerId) => {
            analyser.getFloatTimeDomainData(timeBuffer);
            let peak = 0;
            for (let i = 0; i < timeBuffer.length; i++) {
              const abs = Math.abs(timeBuffer[i]);
              if (abs > peak) peak = abs;
            }

            const isSpeakingNow = peak > SPEAKING_THRESHOLD;
            if (isSpeakingNow) {
              this.speakingHoldTimes.set(peerId, now + 400);
            }

            const isSpeaking = (this.speakingHoldTimes.get(peerId) || 0) > now;
            if (this.speakingMap[peerId] !== isSpeaking) {
              this.speakingMap[peerId] = isSpeaking;
              changed = true;
            }
          });
        }

        if (changed) {
          this.emitState();
        }
      }, 60);
    } catch (e) {
      console.warn('[voiceChatManager] VAD setup error:', e);
    }
  }

  destroy() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.audioContext) {
      try { this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }

    this.calls.forEach((call) => {
      try { call.close(); } catch (e) {}
    });
    this.calls.clear();

    this.remoteAudioElements.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
      if (audio.parentNode) {
        audio.parentNode.removeChild(audio);
      }
    });
    this.remoteAudioElements.clear();

    if (this.remoteGainNodes) {
      this.remoteGainNodes.forEach((gain) => {
        try { gain.disconnect(); } catch (e) {}
      });
      this.remoteGainNodes.clear();
    }
    this.remoteStreams.clear();
    this.remoteAnalysers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    if (this.unsubscribeMic) {
      this.unsubscribeMic();
    }

    this.autoMuteReasons.clear();
    this.speakingMap = {};
    this.listeners.clear();
  }
}

export const voiceChatManager = new VoiceChatManager();
