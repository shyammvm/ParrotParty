/**
 * PeerJS (WebRTC P2P) & BroadcastChannel Multiplayer Room Manager
 * 100% Free - Works with 0 backend servers!
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
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

export const MAX_ROOM_PLAYERS = 10;

export class RoomPeerManager {
  constructor() {
    this.peer = null;
    this.connections = new Map();
    this.hostConnection = null;
    this.broadcastChannel = null;
    this.roomId = null;
    this.playerId = null;
    this.isHost = false;
    this.onStateChangeCallback = null;
    this.onErrorCallback = null;
    this.onReactionCallback = null;
    this.pendingJoinResolve = null;
    this.pendingJoinReject = null;
    this.roomState = null;
    this.chunkBuffers = new Map();
  }

  getPeer() {
    return this.peer;
  }

  getMyPeerId() {
    return this.isHost ? this.roomId : this.playerId;
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

  sendOverConn(conn, payload) {
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
        revealedScoresMap: {} // playerId -> revealedScore
      };

      this.setupBroadcastChannel();

      try {
        this.peer = new Peer(this.roomId, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });

        this.peer.on('open', (id) => {
          this.emitState();
          resolve(this.roomId);
        });

        this.peer.on('connection', (conn) => {
          this.handleIncomingConnection(conn);
        });

        this.peer.on('error', () => {
          this.emitState();
          resolve(this.roomId);
        });
      } catch (e) {
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
          resolve(true);
        }
      };
      const finishReject = (err) => {
        if (!settled) {
          settled = true;
          this.pendingJoinResolve = null;
          this.pendingJoinReject = null;
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

      this.setupBroadcastChannel();

      this.broadcastChannel.postMessage({
        type: 'JOIN_ROOM',
        roomId: this.roomId,
        player: newPlayer
      });

      try {
        this.peer = new Peer(this.playerId);

        this.peer.on('open', () => {
          const conn = this.peer.connect(this.roomId);
          this.hostConnection = conn;

          conn.on('open', () => {
            this.sendOverConn(conn, {
              type: 'JOIN_ROOM',
              player: newPlayer
            });
          });

          conn.on('data', (data) => {
            this.handleIncomingData(data);
          });

          conn.on('error', () => {
            // Keep broadcast channel path intact
          });
        });

        this.peer.on('error', () => {});
      } catch (e) {}

      // Fallback timeout: if neither error nor state update arrived after 3s, resolve
      setTimeout(() => {
        finishResolve();
      }, 3000);
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

  handleReceivedMessage(msg) {
    if (!msg || !msg.type) return;

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

          // Enforce 10 player room capacity limit
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
          player.recordings = msg.recordings;
          player.scoreData = msg.scoreData;
          this.broadcastState();
        }
      }
    } else {
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

        // Preserve local recordings if incoming state has missing or fewer recordings for this player
        if (this.roomState?.players && msg.roomState.players) {
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
    this.roomState = { ...this.roomState, ...updates };
    this.broadcastState();
  }

  submitPlayerAudioPack(recordings, scoreData) {
    const myPlayer = this.roomState?.players.find(p => p.id === this.playerId);
    if (myPlayer) {
      myPlayer.recordings = recordings;
      myPlayer.scoreData = scoreData;
    }

    if (this.isHost) {
      this.broadcastState();
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
    if (this.peer) this.peer.destroy();
    if (this.broadcastChannel) this.broadcastChannel.close();
  }
}

export const peerManager = new RoomPeerManager();
