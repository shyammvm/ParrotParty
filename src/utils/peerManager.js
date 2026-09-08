/**
 * PeerJS (WebRTC P2P) & BroadcastChannel Multiplayer Room Manager
 * 100% Free - Works with 0 backend servers!
 *
 * Robust Multi-player Sync with:
 * - Constant UDP NAT keep-alive heartbeats (prevents 30s router timeouts)
 * - Automatic reconnection with exponential backoff on connection drop
 * - Auto-reconnect on PeerJS cloud signaling disconnect
 * - State versioning & resynchronization catch-up
 * - Visibility change catch-up (when returning to backgrounded tab or screen wake)
 * - Backpressure handling for WebRTC DataChannel
 * - Connection status events (connected / reconnecting / disconnected)
 */

import Peer from 'peerjs';
import { getInitials } from './avatarUtils';
import { SOUND_PACKS } from './soundLibrary';

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function dataURLToBlob(dataurl) {
  if (!dataurl || typeof dataurl !== 'string') return new Blob([]);
  const arr = dataurl.split(',');
  if (arr.length < 2) return new Blob([]);
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Universal helper: accepts either a data: URL or standard http/relative URL
 * and returns a Blob. Avoids decoding huge base64 strings when standard URLs are used.
 */
export async function fetchOrDataUrlToBlob(urlOrDataUrl) {
  if (!urlOrDataUrl) return new Blob([]);
  if (urlOrDataUrl instanceof Blob) return urlOrDataUrl;
  if (typeof urlOrDataUrl === 'string' && urlOrDataUrl.startsWith('data:')) {
    return dataURLToBlob(urlOrDataUrl);
  }
  const res = await fetch(urlOrDataUrl);
  return await res.blob();
}

export const MAX_ROOM_PLAYERS = 10;

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

export class RoomPeerManager {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.hostConnection = null;
    this.broadcastChannel = null;
    this.roomId = null;
    this.playerId = null;
    this.myPlayerInfo = null;
    this.isHost = false;

    this.onStateChangeCallback = null;
    this.onErrorCallback = null;
    this.onReactionCallback = null;
    this.connectionStatusListeners = new Set();
    this.connectionStatus = 'disconnected'; // 'connected' | 'reconnecting' | 'disconnected'

    this.pendingJoinResolve = null;
    this.pendingJoinReject = null;
    this.roomState = null;
    this.chunkBuffers = new Map();

    // Heartbeat & Watchdog
    this.heartbeatTimer = null;
    this.watchdogTimer = null;
    this.lastHeartbeatReceivedAt = 0;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.reconnectTimeout = null;

    // Attach visibility change listener to automatically catch up on tab focus
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.roomId) {
          this.handleTabRefocus();
        }
      });
    }
  }

  getPeer() {
    return this.peer;
  }

  getMyPeerId() {
    return this.isHost ? this.roomId : this.playerId;
  }

  getConnectionStatus() {
    return this.connectionStatus;
  }

  onConnectionStatus(callback) {
    this.connectionStatusListeners.add(callback);
    callback(this.connectionStatus);
    return () => this.connectionStatusListeners.delete(callback);
  }

  setConnectionStatus(status) {
    if (this.connectionStatus === status) return;
    this.connectionStatus = status;
    this.connectionStatusListeners.forEach((fn) => {
      try { fn(status); } catch (e) { console.error(e); }
    });
  }

  onReaction(callback) {
    this.onReactionCallback = callback;
    return () => {
      if (this.onReactionCallback === callback) {
        this.onReactionCallback = null;
      }
    };
  }

  sendReaction(emoji) {
    if (!this.roomState?.roomId) return;
    const myPlayer = this.roomState.players?.find(p => p.id === this.playerId);
    const payload = {
      type: 'EMOJI_REACTION',
      roomId: this.roomId,
      emoji,
      senderId: this.playerId,
      senderName: myPlayer?.name || 'Player',
      timestamp: Date.now()
    };

    if (this.isHost) {
      this.connections.forEach(conn => this.sendOverConn(conn, payload));
      if (this.broadcastChannel) this.broadcastChannel.postMessage(payload);
      if (this.onReactionCallback) this.onReactionCallback(payload);
    } else {
      if (this.hostConnection && this.hostConnection.open) {
        this.sendOverConn(this.hostConnection, payload);
      }
      if (this.broadcastChannel) this.broadcastChannel.postMessage(payload);
      if (this.onReactionCallback) this.onReactionCallback(payload);
    }
  }

  init(onStateChange, onError) {
    this.onStateChangeCallback = onStateChange;
    if (onError) this.onErrorCallback = onError;
  }

  setOnError(onError) {
    this.onErrorCallback = onError;
  }

  /**
   * Send data over WebRTC connection with backpressure and chunking
   */
  async sendOverConn(conn, payload) {
    if (!conn || !conn.open) return;
    const CHUNK_SIZE = 16 * 1024;
    try {
      const str = JSON.stringify(payload);
      if (str.length <= CHUNK_SIZE) {
        conn.send(payload);
      } else {
        const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const total = Math.ceil(str.length / CHUNK_SIZE);
        for (let i = 0; i < total; i++) {
          // Flow control: If DataChannel buffer exceeds 64KB, micro-delay to prevent choking socket
          const dc = conn.dataChannel;
          if (dc && dc.bufferedAmount > 64 * 1024) {
            await new Promise(r => setTimeout(r, 12));
          }
          conn.send({
            __chunk: true,
            msgId,
            index: i,
            total,
            chunk: str.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
          });
        }
      }
    } catch (e) {
      console.warn('[peerManager] sendOverConn error:', e);
    }
  }

  handleIncomingData(data, senderPeer) {
    if (data && data.__chunk) {
      const { msgId, index, total, chunk } = data;
      if (!this.chunkBuffers.has(msgId)) {
        this.chunkBuffers.set(msgId, {
          parts: new Array(total),
          received: 0,
          created: Date.now()
        });
      }
      const buf = this.chunkBuffers.get(msgId);
      if (!buf.parts[index]) {
        buf.parts[index] = chunk;
        buf.received++;
      }
      if (buf.received === total) {
        this.chunkBuffers.delete(msgId);
        try {
          const fullStr = buf.parts.join('');
          const parsed = JSON.parse(fullStr);
          this.handleReceivedMessage(parsed, senderPeer);
        } catch (e) {
          console.error('[peerManager] Chunk reassembly parse error:', e);
        }
      }
      // Periodically clean up stale chunk buffers (> 30s old)
      if (this.chunkBuffers.size > 20) {
        const now = Date.now();
        for (const [id, item] of this.chunkBuffers.entries()) {
          if (now - item.created > 30000) this.chunkBuffers.delete(id);
        }
      }
      return;
    }
    this.handleReceivedMessage(data, senderPeer);
  }

  // ── Host Heartbeat (Runs every 4 seconds to prevent UDP NAT timeouts) ──
  startHostHeartbeat() {
    this.stopHostHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isHost || !this.roomId) return;
      const pingMsg = {
        type: 'HEARTBEAT_PING',
        roomId: this.roomId,
        timestamp: Date.now(),
        stateVersion: this.roomState?.stateVersion || 0
      };

      this.connections.forEach((conn) => {
        if (conn && conn.open) {
          try { conn.send(pingMsg); } catch (e) {}
        }
      });

      if (this.broadcastChannel) {
        try { this.broadcastChannel.postMessage(pingMsg); } catch (e) {}
      }
    }, 4000);
  }

  stopHostHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Client Heartbeat Watchdog (Detects silent drops & triggers recovery) ──
  startClientWatchdog() {
    this.stopClientWatchdog();
    this.lastHeartbeatReceivedAt = Date.now();
    this.watchdogTimer = setInterval(() => {
      if (this.isHost || !this.roomId) return;
      const timeSinceLast = Date.now() - this.lastHeartbeatReceivedAt;

      // If no heartbeat received in 12s and not already reconnecting
      if (timeSinceLast > 12000 && !this.isReconnecting) {
        console.warn(`[peerManager] No heartbeat received for ${(timeSinceLast / 1000).toFixed(1)}s! Initiating reconnect...`);
        this.setConnectionStatus('reconnecting');
        this.reconnectToHost();
      }
    }, 3000);
  }

  stopClientWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  // ── Auto-Reconnect on Tab Refocus ──
  handleTabRefocus() {
    if (this.isHost) return;
    if (!this.roomId || !this.myPlayerInfo) return;

    if (!this.hostConnection || !this.hostConnection.open) {
      console.log('[peerManager] Tab refocused with closed connection. Reconnecting to host...');
      this.reconnectToHost();
    } else {
      console.log('[peerManager] Tab refocused. Requesting latest room state...');
      this.requestStateFromHost();
    }
  }

  requestStateFromHost() {
    if (this.isHost) return;
    const req = {
      type: 'REQUEST_STATE',
      roomId: this.roomId,
      playerId: this.playerId,
      clientVersion: this.roomState?.stateVersion || 0
    };
    if (this.hostConnection && this.hostConnection.open) {
      this.sendOverConn(this.hostConnection, req);
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(req);
    }
  }

  // ── Reconnection Logic with Exponential Backoff ──
  reconnectToHost() {
    if (this.isHost || !this.roomId || !this.myPlayerInfo || this.isReconnecting) return;

    this.isReconnecting = true;
    this.setConnectionStatus('reconnecting');

    const doConnect = () => {
      if (!this.peer || this.peer.destroyed) {
        this.peer = new Peer(this.playerId, {
          debug: 1,
          config: { iceServers: ICE_SERVERS }
        });
        this.bindPeerSignalingEvents(this.peer);
      } else if (this.peer.disconnected) {
        try { this.peer.reconnect(); } catch (e) {}
      }

      console.log(`[peerManager] Attempting to reconnect to host ${this.roomId}... (Attempt ${this.reconnectAttempts + 1})`);
      const conn = this.peer.connect(this.roomId, {
        reliable: true
      });

      let connectionSettled = false;

      const onConnectTimeout = setTimeout(() => {
        if (!connectionSettled) {
          connectionSettled = true;
          this.scheduleNextReconnect();
        }
      }, 5000);

      conn.on('open', () => {
        if (connectionSettled) return;
        connectionSettled = true;
        clearTimeout(onConnectTimeout);

        console.log('[peerManager] Successfully reconnected to host!');
        this.hostConnection = conn;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.lastHeartbeatReceivedAt = Date.now();
        this.setConnectionStatus('connected');

        // Send REJOIN_ROOM with existing player details
        this.sendOverConn(conn, {
          type: 'REJOIN_ROOM',
          roomId: this.roomId,
          player: this.myPlayerInfo,
          lastKnownVersion: this.roomState?.stateVersion || 0
        });
      });

      conn.on('data', (data) => {
        this.handleIncomingData(data);
      });

      conn.on('close', () => {
        console.warn('[peerManager] Host connection closed.');
        this.setConnectionStatus('reconnecting');
        this.scheduleNextReconnect();
      });

      conn.on('error', (err) => {
        console.warn('[peerManager] Host connection error:', err);
        if (!connectionSettled) {
          connectionSettled = true;
          clearTimeout(onConnectTimeout);
          this.scheduleNextReconnect();
        }
      });
    };

    if (this.peer && this.peer.open) {
      doConnect();
    } else {
      setTimeout(doConnect, 400);
    }
  }

  scheduleNextReconnect() {
    this.isReconnecting = false;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 8000);
    console.log(`[peerManager] Scheduling next reconnect in ${delay}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectToHost();
    }, delay);
  }

  // ── Bind PeerJS Cloud Signaling Disconnect Recovery ──
  bindPeerSignalingEvents(peer) {
    peer.on('disconnected', () => {
      console.warn('[peerManager] Disconnected from PeerJS signaling server. Attempting signaling reconnect...');
      this.setConnectionStatus('reconnecting');
      if (peer && !peer.destroyed) {
        try {
          peer.reconnect();
        } catch (e) {
          console.error('[peerManager] peer.reconnect error:', e);
        }
      }
    });

    peer.on('error', (err) => {
      console.warn('[peerManager] Peer error:', err?.type || err?.message || err);
      // If peer is already taken or destroyed
      if (err?.type === 'unavailable-id') {
        // ID clash fallback
      }
    });
  }

  createRoom(hostPlayerName, hostAvatar) {
    return new Promise((resolve) => {
      this.isHost = true;
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      this.roomId = `MIMIC-${code}`;
      this.playerId = `player-host-${Date.now()}`;

      const initialPlayer = {
        id: this.playerId,
        peerId: this.roomId,
        name: hostPlayerName,
        avatar: hostAvatar || getInitials(hostPlayerName),
        isHost: true,
        recordings: [],
        scoreData: { overallScore: 0, soundScores: [] }
      };
      this.myPlayerInfo = initialPlayer;

      this.roomState = {
        roomId: this.roomId,
        gamePhase: 'LOBBY',
        hostId: this.playerId,
        players: [initialPlayer],
        soundPackTitle: '',
        soundPack: [],
        selectedPackId: SOUND_PACKS[0]?.id || '',
        currentSoundIndex: 0,
        revealPlayerIndex: 0,
        currentRevealIndex: 0,
        revealedScoresMap: {},
        stateVersion: 1
      };

      this.setupBroadcastChannel();

      try {
        this.peer = new Peer(this.roomId, {
          debug: 1,
          config: { iceServers: ICE_SERVERS }
        });

        this.bindPeerSignalingEvents(this.peer);

        this.peer.on('open', (id) => {
          this.setConnectionStatus('connected');
          this.startHostHeartbeat();
          this.emitState();
          resolve(this.roomId);
        });

        this.peer.on('connection', (conn) => {
          this.handleIncomingConnection(conn);
        });

        this.peer.on('error', () => {
          this.setConnectionStatus('connected');
          this.startHostHeartbeat();
          this.emitState();
          resolve(this.roomId);
        });
      } catch (e) {
        this.setConnectionStatus('connected');
        this.startHostHeartbeat();
        this.emitState();
        resolve(this.roomId);
      }
    });
  }

  joinRoom(roomId, playerName, playerAvatar) {
    return new Promise((resolve, reject) => {
      this.isHost = false;
      this.roomId = roomId.toUpperCase().trim();
      this.playerId = `player-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      let settled = false;
      const finishResolve = () => {
        if (!settled) {
          settled = true;
          this.pendingJoinResolve = null;
          this.pendingJoinReject = null;
          this.setConnectionStatus('connected');
          this.startClientWatchdog();
          resolve(true);
        }
      };
      const finishReject = (err) => {
        if (!settled) {
          settled = true;
          this.pendingJoinResolve = null;
          this.pendingJoinReject = null;
          this.setConnectionStatus('disconnected');
          reject(err instanceof Error ? err : new Error(err));
        }
      };

      this.pendingJoinResolve = finishResolve;
      this.pendingJoinReject = finishReject;

      const newPlayer = {
        id: this.playerId,
        peerId: this.playerId,
        name: playerName,
        avatar: playerAvatar || getInitials(playerName),
        isHost: false,
        recordings: [],
        scoreData: { overallScore: 0, soundScores: [] }
      };
      this.myPlayerInfo = newPlayer;

      this.setupBroadcastChannel();

      this.broadcastChannel.postMessage({
        type: 'JOIN_ROOM',
        roomId: this.roomId,
        player: newPlayer
      });

      try {
        this.peer = new Peer(this.playerId, {
          debug: 1,
          config: { iceServers: ICE_SERVERS }
        });

        this.bindPeerSignalingEvents(this.peer);

        this.peer.on('open', () => {
          const conn = this.peer.connect(this.roomId, { reliable: true });
          this.hostConnection = conn;

          conn.on('open', () => {
            this.setConnectionStatus('connected');
            this.lastHeartbeatReceivedAt = Date.now();
            this.sendOverConn(conn, {
              type: 'JOIN_ROOM',
              player: newPlayer
            });
          });

          conn.on('data', (data) => {
            this.handleIncomingData(data);
          });

          conn.on('close', () => {
            console.warn('[peerManager] Host connection closed.');
            this.setConnectionStatus('reconnecting');
            this.scheduleNextReconnect();
          });

          conn.on('error', () => {
            // Keep broadcast channel path intact and trigger reconnect
            this.setConnectionStatus('reconnecting');
            this.scheduleNextReconnect();
          });
        });

        this.peer.on('error', (err) => {
          console.warn('[peerManager] Peer open error:', err);
        });
      } catch (e) {}

      // Fallback timeout: if neither error nor state update arrived after 3.5s, resolve
      setTimeout(() => {
        finishResolve();
      }, 3500);
    });
  }

  setupBroadcastChannel() {
    if (this.broadcastChannel) this.broadcastChannel.close();
    this.broadcastChannel = new BroadcastChannel(`MIMIC_ROOM_${this.roomId}`);
    this.broadcastChannel.onmessage = (event) => {
      this.handleReceivedMessage(event.data);
    };
  }

  handleIncomingConnection(conn) {
    this.connections.set(conn.peer, conn);
    conn.on('data', (data) => {
      this.handleIncomingData(data, conn.peer);
    });
    conn.on('close', () => {
      this.connections.delete(conn.peer);
    });
  }

  handleReceivedMessage(msg, senderPeer) {
    if (!msg || !msg.type) return;

    // Heartbeat PING
    if (msg.type === 'HEARTBEAT_PING') {
      if (!this.isHost) {
        this.lastHeartbeatReceivedAt = Date.now();
        this.setConnectionStatus('connected');

        // Catch-up check: if host state version is newer than ours, request state
        const hostVer = msg.stateVersion || 0;
        const myVer = this.roomState?.stateVersion || 0;
        if (hostVer > myVer) {
          this.requestStateFromHost();
        }

        // Reply PONG
        const pong = { type: 'HEARTBEAT_PONG', timestamp: msg.timestamp };
        if (this.hostConnection && this.hostConnection.open) {
          try { this.hostConnection.send(pong); } catch (e) {}
        }
      }
      return;
    }

    // Heartbeat PONG
    if (msg.type === 'HEARTBEAT_PONG') {
      // Host received client pong, connection is healthy
      return;
    }

    if (msg.type === 'EMOJI_REACTION') {
      if (this.isHost) {
        this.connections.forEach((conn) => {
          if (conn.peer !== msg.senderId) {
            this.sendOverConn(conn, msg);
          }
        });
      }
      if (this.onReactionCallback) {
        this.onReactionCallback(msg);
      }
      return;
    }

    if (this.isHost) {
      if (msg.type === 'REQUEST_STATE') {
        // Send state back to the requesting client
        this.broadcastState();
        return;
      }

      if (msg.type === 'REJOIN_ROOM') {
        const existingPlayer = this.roomState.players.find(p => p.id === msg.player.id);
        if (existingPlayer) {
          // Player already exists in room, update connection and send latest state
          if (senderPeer) {
            const conn = this.connections.get(senderPeer);
            if (conn && conn.open) {
              this.sendOverConn(conn, { type: 'STATE_UPDATE', roomState: this.roomState });
            }
          }
          this.broadcastState();
          return;
        } else {
          // If not existing, treat as join
          if (this.roomState.players.length < MAX_ROOM_PLAYERS) {
            this.roomState.players.push(msg.player);
            this.broadcastState();
          }
          return;
        }
      }

      if (msg.type === 'JOIN_ROOM') {
        const existingPlayer = this.roomState.players.find(p => p.id === msg.player.id);
        if (!existingPlayer) {
          // Reject joining if game has already started
          if (this.roomState.gamePhase !== 'LOBBY') {
            const errorPayload = {
              type: 'JOIN_ERROR',
              roomId: this.roomId,
              targetPlayerId: msg.player.id,
              error: 'Game already in progress! Joining is locked once the game has started.'
            };
            if (this.broadcastChannel) {
              this.broadcastChannel.postMessage(errorPayload);
            }
            const conn = this.connections.get(msg.player.id);
            if (conn && conn.open) {
              this.sendOverConn(conn, errorPayload);
            }
            return;
          }

          // Enforce room capacity limit
          if (this.roomState.players.length >= MAX_ROOM_PLAYERS) {
            const errorPayload = {
              type: 'ROOM_FULL',
              roomId: this.roomId,
              targetPlayerId: msg.player.id,
              error: `Room is full! Maximum ${MAX_ROOM_PLAYERS} players allowed.`
            };
            if (this.broadcastChannel) {
              this.broadcastChannel.postMessage(errorPayload);
            }
            const conn = this.connections.get(msg.player.id);
            if (conn && conn.open) {
              this.sendOverConn(conn, errorPayload);
            }
            return;
          }

          this.roomState.players.push(msg.player);
          this.broadcastState();
        }
      } else if (msg.type === 'SUBMIT_PACK_AUDIO') {
        const player = this.roomState.players.find(p => p.id === msg.playerId);
        if (player) {
          // Merge recordings
          player.recordings = msg.recordings;
          player.scoreData = msg.scoreData;
          this.broadcastState();
        }
      }
    } else {
      // ── Client Handlers ──
      if ((msg.type === 'ROOM_FULL' || msg.type === 'JOIN_ERROR') && msg.targetPlayerId === this.playerId) {
        const errMsg = msg.error || `Room is full! Maximum ${MAX_ROOM_PLAYERS} players allowed.`;
        if (this.pendingJoinReject) {
          this.pendingJoinReject(new Error(errMsg));
        }
        if (this.onErrorCallback) {
          this.onErrorCallback(errMsg);
        }
        this.roomState = null;
        return;
      }

      if (msg.type === 'STATE_UPDATE' && msg.roomState.roomId === this.roomId) {
        this.lastHeartbeatReceivedAt = Date.now();
        this.setConnectionStatus('connected');

        const isMeInRoom = msg.roomState.players?.some(p => p.id === this.playerId);
        if (!isMeInRoom && msg.roomState.players?.length >= MAX_ROOM_PLAYERS) {
          const errMsg = `Room is full! Maximum ${MAX_ROOM_PLAYERS} players allowed.`;
          if (this.pendingJoinReject) {
            this.pendingJoinReject(new Error(errMsg));
          }
          if (this.onErrorCallback) {
            this.onErrorCallback(errMsg);
          }
          this.roomState = null;
          return;
        }

        if (!isMeInRoom && msg.roomState.gamePhase !== 'LOBBY') {
          const errMsg = 'Game already in progress! Joining is locked once the game has started.';
          if (this.pendingJoinReject) {
            this.pendingJoinReject(new Error(errMsg));
          }
          if (this.onErrorCallback) {
            this.onErrorCallback(errMsg);
          }
          this.roomState = null;
          return;
        }

        // Only preserve local recordings if we are in the SAME pack, SAME phase, and SAME sound index!
        // This prevents old recordings from an earlier game from overwriting an empty new round.
        if (
          this.roomState?.players &&
          msg.roomState.players &&
          this.roomState.soundPackTitle === msg.roomState.soundPackTitle &&
          this.roomState.gamePhase === msg.roomState.gamePhase &&
          this.roomState.currentSoundIndex === msg.roomState.currentSoundIndex
        ) {
          const myLocalPlayer = this.roomState.players.find(p => p.id === this.playerId);
          const incomingPlayer = msg.roomState.players.find(p => p.id === this.playerId);
          if (myLocalPlayer && incomingPlayer) {
            const localRecCount = myLocalPlayer.recordings?.filter(Boolean).length || 0;
            const incomingRecCount = incomingPlayer.recordings?.filter(Boolean).length || 0;
            if (localRecCount > incomingRecCount) {
              incomingPlayer.recordings = myLocalPlayer.recordings;
              incomingPlayer.scoreData = myLocalPlayer.scoreData;
            }
          }
        }

        this.roomState = msg.roomState;
        this.emitState();
        if (this.pendingJoinResolve && isMeInRoom) {
          this.pendingJoinResolve();
        }
      }
    }
  }

  updateRoomState(updates) {
    if (!this.isHost || !this.roomState) return;
    const nextVersion = (this.roomState.stateVersion || 0) + 1;
    this.roomState = { ...this.roomState, ...updates, stateVersion: nextVersion };
    this.broadcastState();
  }

  submitPlayerAudioPack(recordings, scoreData) {
    const myPlayer = this.roomState?.players.find(p => p.id === this.playerId);
    if (myPlayer) {
      myPlayer.recordings = recordings;
      myPlayer.scoreData = scoreData;
    }

    if (this.isHost) {
      this.updateRoomState({});
    } else {
      const msg = {
        type: 'SUBMIT_PACK_AUDIO',
        playerId: this.playerId,
        recordings,
        scoreData
      };
      if (this.hostConnection && this.hostConnection.open) {
        this.sendOverConn(this.hostConnection, msg);
      }
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage(msg);
      }
    }
  }

  broadcastState() {
    if (!this.isHost || !this.roomState) return;
    const msg = { type: 'STATE_UPDATE', roomState: this.roomState };

    this.connections.forEach((conn) => {
      this.sendOverConn(conn, msg);
    });

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(msg);
    }

    this.emitState();
  }

  emitState() {
    if (this.onStateChangeCallback && this.roomState) {
      this.onStateChangeCallback({
        ...this.roomState,
        myPlayerId: this.playerId,
        isHost: this.isHost
      });
    }
  }

  destroy() {
    this.stopHostHeartbeat();
    this.stopClientWatchdog();
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.peer) this.peer.destroy();
    if (this.broadcastChannel) this.broadcastChannel.close();
    this.setConnectionStatus('disconnected');
  }
}

export const peerManager = new RoomPeerManager();
