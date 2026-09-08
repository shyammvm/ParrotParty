/**
 * WebRTC Voice Chat Manager (PeerJS Mesh)
 * Features:
 * - Auto-enabled P2P audio mesh across room players with self-healing watchdog.
 * - Universal microphone integration with on-the-fly track replacement.
 * - Silent fallback audio track to eliminate caller/callee race conditions on join.
 * - Pure HTML5 audio playback for zero-echo, pristine audio with robust mute/deafen.
 * - Auto-pause / auto-mute safety timeouts to prevent stuck mute states.
 * - Real-time Voice Activity Detection (VAD) for avatar speaking indicators.
 */

import { audioDeviceManager } from './audioDeviceManager';

/**
 * Creates a silent audio stream using Web Audio API so WebRTC negotiates
 * an active audio sender even if mic permission is pending.
 */
function createSilentMediaStream() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0; // complete silence
    oscillator.connect(gain);
    const dst = ctx.createMediaStreamDestination();
    gain.connect(dst);
    oscillator.start();
    return dst.stream;
  } catch (e) {
    return null;
  }
}

class VoiceChatManager {
  constructor() {
    this.peer = null;
    this.myPeerId = null;
    this.myPlayerId = null;
    this.localStream = null;
    this.calls = new Map(); // remotePeerId -> MediaConnection
    this.remoteAudioElements = new Map(); // remotePeerId -> HTMLAudioElement
    this.remoteStreams = new Map(); // remotePeerId -> MediaStream
    this.remoteSources = new Map(); // remotePeerId -> MediaStreamAudioSourceNode (retained to prevent GC)
    this.remoteAnalysers = new Map(); // remotePeerId -> AnalyserNode

    // State
    this.isManuallyMuted = false;
    this.isManuallyDeafened = false;
    this.autoMuteReasons = new Set();
    this.autoMuteTimeouts = new Map(); // reason -> timerId
    this.speakingMap = {}; // playerId/peerId -> boolean
    this.listeners = new Set();

    // VAD & Web Audio
    this.audioContext = null;
    this.localSource = null;
    this.localAnalyser = null;
    this.vadInterval = null;
    this.speakingHoldTimes = new Map(); // id -> timestamp
    this.localVolumeLevel = 0;

    // Mesh Watchdog & Timing
    this.meshWatchdogInterval = null;
    this.lastRoomPlayers = [];
    this.callAttemptTimestamps = new Map(); // remotePeerId -> timestamp
    this.callListenerRegistered = false;

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

    const peerChanged = this.peer !== peerInstance;
    this.peer = peerInstance;
    this.myPeerId = myPeerId;
    this.myPlayerId = myPlayerId;
    this.lastRoomPlayers = roomPlayers || [];

    // 1. Register incoming call listener (rebind if peer instance changed)
    if (peerChanged || !this.callListenerRegistered) {
      this.callListenerRegistered = true;
      this.peer.on('call', (incomingCall) => {
        this.handleIncomingCall(incomingCall);
      });
    }

    // 2. Acquire local audio stream from universal mic manager
    if (!this.localStream) {
      this.acquireStreamPromise = audioDeviceManager.getUniversalAudioStream()
        .then((stream) => {
          this.localStream = stream;
          this.acquireStreamPromise = null;

          // Swap track on all active peer senders if calls were answered with placeholder
          const track = stream.getAudioTracks()[0];
          if (track) {
            this.calls.forEach((call) => {
              try {
                const pc = call.peerConnection;
                if (pc) {
                  const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio') ||
                                 pc.getSenders().find((s) => s.dtlsTransport);
                  if (sender) sender.replaceTrack(track);
                }
              } catch (e) {}
            });
          }

          this.updateTrackAndAudioStates();

          // Connect local analyser
          if (this.audioContext && this.localAnalyser && !this.localSource) {
            try {
              this.localSource = this.audioContext.createMediaStreamSource(this.localStream);
              this.localSource.connect(this.localAnalyser);
            } catch (e) {}
          }

          return stream;
        })
        .catch((err) => {
          console.warn('[voiceChatManager] Microphone access warning:', err);
          this.acquireStreamPromise = null;
          return null;
        });
    }

    // Apply mute states
    this.updateTrackAndAudioStates();

    // Setup VAD
    this.setupAudioContextAndVad();

    // Start self-healing mesh watchdog
    this.startMeshWatchdog();

    // Mesh call with known room players
    this.syncRoomPlayers(roomPlayers);
    this.emitState();
  }

  /**
   * Synchronize active calls with the current list of room players
   */
  syncRoomPlayers(roomPlayers = []) {
    if (!this.peer || !this.myPeerId) return;
    this.lastRoomPlayers = roomPlayers || [];

    const activeRemotePeerIds = new Set();

    roomPlayers.forEach((player) => {
      const remotePeerId = player.peerId || player.id;
      if (!remotePeerId || remotePeerId === this.myPeerId) return;

      activeRemotePeerIds.add(remotePeerId);

      // Primary initiator: Peer with smaller ID initiates call
      if (this.myPeerId < remotePeerId && !this.calls.has(remotePeerId)) {
        this.callPeer(remotePeerId);
      }
    });

    // Prune calls for players who have left the room
    this.calls.forEach((_, peerId) => {
      if (!activeRemotePeerIds.has(peerId)) {
        this.cleanupPeer(peerId);
      }
    });
  }

  /**
   * Self-healing watchdog: checks every 3.5s for dropped calls,
   * stale connections, or deadlocked callers
   */
  startMeshWatchdog() {
    if (this.meshWatchdogInterval) return;

    this.meshWatchdogInterval = setInterval(() => {
      if (!this.peer || !this.myPeerId || this.lastRoomPlayers.length === 0) return;

      const now = Date.now();
      const activeRemotePeerIds = new Set();

      this.lastRoomPlayers.forEach((player) => {
        const remotePeerId = player.peerId || player.id;
        if (!remotePeerId || remotePeerId === this.myPeerId) return;
        activeRemotePeerIds.add(remotePeerId);

        const call = this.calls.get(remotePeerId);
        const lastAttempt = this.callAttemptTimestamps.get(remotePeerId) || 0;
        const timeSinceAttempt = now - lastAttempt;

        // Check if existing call is in a dead or failed ICE state
        let isDead = false;
        if (call && call.peerConnection) {
          const iceState = call.peerConnection.iceConnectionState;
          const connState = call.peerConnection.connectionState;
          if (iceState === 'failed' || iceState === 'disconnected' || connState === 'failed') {
            isDead = true;
          }
        }

        if (isDead) {
          console.warn(`[voiceChatManager] Watchdog detected dead call with ${remotePeerId}. Reconnecting...`);
          this.cleanupPeer(remotePeerId);
        }

        // Check if missing a call
        const hasCall = this.calls.has(remotePeerId);
        if (!hasCall && timeSinceAttempt > 3500) {
          // If smaller ID, dial immediately
          // If larger ID, dial if > 5.5s has elapsed (breaks initial race condition deadlock)
          if (this.myPeerId < remotePeerId || timeSinceAttempt > 5500) {
            this.callPeer(remotePeerId);
          }
        }
      });

      // Clean up peers who left
      this.calls.forEach((_, peerId) => {
        if (!activeRemotePeerIds.has(peerId)) {
          this.cleanupPeer(peerId);
        }
      });
    }, 3500);
  }

  callPeer(remotePeerId) {
    if (!this.peer || this.calls.has(remotePeerId)) return;

    this.callAttemptTimestamps.set(remotePeerId, Date.now());

    try {
      // Use local mic or silent fallback stream
      const streamToSend = this.localStream || createSilentMediaStream();
      if (!streamToSend) return;

      const call = this.peer.call(remotePeerId, streamToSend);
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

      if (call.peerConnection) {
        call.peerConnection.oniceconnectionstatechange = () => {
          const s = call.peerConnection.iceConnectionState;
          if (s === 'failed' || s === 'disconnected') {
            this.cleanupPeer(remotePeerId);
          }
        };
      }

      this.emitState();
    } catch (e) {
      console.warn(`[voiceChatManager] Failed to call ${remotePeerId}:`, e);
    }
  }

  handleIncomingCall(incomingCall) {
    const remotePeerId = incomingCall.peer;

    // If an existing call is active, close old one
    const existingCall = this.calls.get(remotePeerId);
    if (existingCall && existingCall !== incomingCall) {
      try { existingCall.close(); } catch (e) {}
    }
    this.calls.set(remotePeerId, incomingCall);

    // Answer with localStream or silent fallback stream so WebRTC sender is created
    const streamToAnswer = this.localStream || createSilentMediaStream();
    if (streamToAnswer) {
      incomingCall.answer(streamToAnswer);
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

    if (incomingCall.peerConnection) {
      incomingCall.peerConnection.oniceconnectionstatechange = () => {
        const s = incomingCall.peerConnection.iceConnectionState;
        if (s === 'failed' || s === 'disconnected') {
          this.cleanupPeer(remotePeerId);
        }
      };
    }

    this.emitState();
  }

  attachRemoteStream(remotePeerId, remoteStream) {
    this.remoteStreams.set(remotePeerId, remoteStream);

    // 1. Mount pure HTML5 Audio element for output
    // (Exclusively handles playback: zero echo, zero phasing, no Chromium GC issues)
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
    const effectiveDeafened = this.isManuallyDeafened || this.autoMuteReasons.size > 0;
    audioEl.muted = effectiveDeafened;
    audioEl.volume = 1.0;

    const playAudio = () => {
      audioEl.play().catch((err) => {
        console.log('[voiceChatManager] Audio play pending user interaction:', err);
        const resumeOnUserAction = () => {
          audioEl.play().catch(() => {});
          window.removeEventListener('click', resumeOnUserAction);
          window.removeEventListener('keydown', resumeOnUserAction);
          window.removeEventListener('touchstart', resumeOnUserAction);
        };
        window.addEventListener('click', resumeOnUserAction, { once: true });
        window.addEventListener('keydown', resumeOnUserAction, { once: true });
        window.addEventListener('touchstart', resumeOnUserAction, { once: true });
      });
    };
    playAudio();

    // 2. Web Audio Analyser ONLY for speaking indicators (Avatar glow)
    // NOTE: NOT connected to audioContext.destination to avoid metallic echo / comb filtering!
    if (this.audioContext) {
      try {
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }

        // Clean up any old source
        if (this.remoteSources && this.remoteSources.has(remotePeerId)) {
          try { this.remoteSources.get(remotePeerId).disconnect(); } catch (e) {}
        }

        const source = this.audioContext.createMediaStreamSource(remoteStream);
        this.remoteSources.set(remotePeerId, source); // Retain reference to prevent GC

        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        this.remoteAnalysers.set(remotePeerId, analyser);
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

    if (this.remoteSources && this.remoteSources.has(remotePeerId)) {
      try { this.remoteSources.get(remotePeerId).disconnect(); } catch (e) {}
      this.remoteSources.delete(remotePeerId);
    }

    this.remoteStreams.delete(remotePeerId);
    this.remoteAnalysers.delete(remotePeerId);
    delete this.speakingMap[remotePeerId];

    this.emitState();
  }

  /**
   * Universal mic changed in settings -> swap audio track in-place across active calls
   * and reconnect Web Audio local analyser
   */
  async handleDeviceChange(deviceId) {
    if (!this.peer) return;

    try {
      const newStream = await audioDeviceManager.getUniversalAudioStream();
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      if (this.localStream) {
        const oldTrack = this.localStream.getAudioTracks()[0];
        if (oldTrack) {
          oldTrack.stop();
          this.localStream.removeTrack(oldTrack);
        }
        this.localStream.addTrack(newTrack);
      } else {
        this.localStream = newStream;
      }

      // In-place replace track on all active peer connections
      this.calls.forEach((call) => {
        try {
          const pc = call.peerConnection;
          if (pc) {
            const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio') ||
                           pc.getSenders().find((s) => s.dtlsTransport);
            if (sender) {
              sender.replaceTrack(newTrack);
            }
          }
        } catch (e) {}
      });

      // Reconnect Web Audio local analyser so VAD VU meter continues functioning
      if (this.audioContext && this.localAnalyser) {
        try {
          if (this.localSource) {
            this.localSource.disconnect();
          }
          this.localSource = this.audioContext.createMediaStreamSource(this.localStream);
          this.localSource.connect(this.localAnalyser);
        } catch (e) {
          console.warn('[voiceChatManager] Error reconnecting local analyser:', e);
        }
      }

      this.updateTrackAndAudioStates();
    } catch (err) {
      console.warn('[voiceChatManager] Error updating mic track:', err);
    }
  }

  /**
   * Auto-pause / auto-mute hook with safety expiration timer.
   * reason: 'RECORDING' | 'DEMO_PLAYBACK' | 'REVEAL_PLAYBACK'
   * enabled: true to pause, false to resume immediately
   */
  setAutoMuted(reason, enabled) {
    if (this.autoMuteTimeouts.has(reason)) {
      clearTimeout(this.autoMuteTimeouts.get(reason));
      this.autoMuteTimeouts.delete(reason);
    }

    if (enabled) {
      this.autoMuteReasons.add(reason);
      // Safety auto-expiration timer: auto-release after 12s if anything threw or unmounted
      const timer = setTimeout(() => {
        if (this.autoMuteReasons.has(reason)) {
          console.warn(`[voiceChatManager] Auto-mute reason '${reason}' hit 12s safety timeout. Auto-releasing.`);
          this.setAutoMuted(reason, false);
        }
      }, 12000);
      this.autoMuteTimeouts.set(reason, timer);
    } else {
      this.autoMuteReasons.delete(reason);
    }

    this.updateTrackAndAudioStates();
    this.emitState();
  }

  /**
   * Clears all active auto-mutes (useful on phase transitions)
   */
  clearAllAutoMutes() {
    this.autoMuteTimeouts.forEach((timer) => clearTimeout(timer));
    this.autoMuteTimeouts.clear();
    this.autoMuteReasons.clear();
    this.updateTrackAndAudioStates();
    this.emitState();
  }

  /**
   * Force manual refresh of mesh connections
   */
  refreshMesh() {
    this.callAttemptTimestamps.clear();
    this.syncRoomPlayers(this.lastRoomPlayers);
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
          window.removeEventListener('touchstart', unlock);
        };
        window.addEventListener('click', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
        window.addEventListener('touchstart', unlock, { once: true });
      }

      this.localAnalyser = this.audioContext.createAnalyser();
      this.localAnalyser.fftSize = 256;

      if (this.localStream) {
        try {
          this.localSource = this.audioContext.createMediaStreamSource(this.localStream);
          this.localSource.connect(this.localAnalyser);
        } catch (e) {}
      }

      const timeBuffer = new Float32Array(256);
      const SPEAKING_THRESHOLD = 0.025; // Responsive peak threshold for normal speech

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
    if (this.meshWatchdogInterval) {
      clearInterval(this.meshWatchdogInterval);
      this.meshWatchdogInterval = null;
    }

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

    if (this.remoteSources) {
      this.remoteSources.forEach((src) => {
        try { src.disconnect(); } catch (e) {}
      });
      this.remoteSources.clear();
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

    this.autoMuteTimeouts.forEach((timer) => clearTimeout(timer));
    this.autoMuteTimeouts.clear();
    this.autoMuteReasons.clear();
    this.speakingMap = {};
    this.listeners.clear();
  }

  leaveVoiceChat() {
    if (this.meshWatchdogInterval) {
      clearInterval(this.meshWatchdogInterval);
      this.meshWatchdogInterval = null;
    }

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
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

    if (this.remoteSources) {
      this.remoteSources.forEach((src) => {
        try { src.disconnect(); } catch (e) {}
      });
      this.remoteSources.clear();
    }

    this.remoteStreams.clear();
    this.remoteAnalysers.clear();

    this.autoMuteTimeouts.forEach((timer) => clearTimeout(timer));
    this.autoMuteTimeouts.clear();
    this.autoMuteReasons.clear();
    this.speakingMap = {};
    this.callListenerRegistered = false;
    this.peer = null;
    this.myPeerId = null;
    this.myPlayerId = null;
    this.lastRoomPlayers = [];
    this.callAttemptTimestamps.clear();
    this.emitState();
  }
}

export const voiceChatManager = new VoiceChatManager();
