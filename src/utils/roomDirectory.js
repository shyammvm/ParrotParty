/**
 * Room Directory & Discovery Manager
 * Broadcasts and discovers active game rooms across tabs and networks.
 * Protects 4-digit room codes via salted SHA-256 hashes so codes are never exposed in plaintext in lobby listings.
 */

const BROADCAST_CHANNEL_NAME = 'TINTOM_LOBBY_ROOMS_V1';
const LOCAL_STORAGE_KEY = 'tintom_active_rooms';
const NTFY_TOPIC = 'tintom_active_rooms_lobby_v1';
const HEARTBEAT_INTERVAL_MS = 4000;
const ROOM_EXPIRY_MS = 12000;

async function hashRoomCode(code, salt) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${code.trim()}:${salt}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    // Simple fallback if crypto.subtle is unavailable
    let hash = 0;
    const str = `${code.trim()}:${salt}`;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }
}

class RoomDirectory {
  constructor() {
    this.broadcastChannel = null;
    this.listeners = new Set();
    this.activeRoomsMap = new Map(); // advertId -> roomObj
    this.advertTimer = null;
    this.pruneTimer = null;
    this.currentAdvert = null;
    this.eventSource = null;

    this.init();
  }

  init() {
    // 1. Setup BroadcastChannel for instantaneous same-origin cross-tab discovery
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.broadcastChannel.onmessage = (e) => {
          this.handleIncomingMessage(e.data);
        };
      } catch (e) {
        console.warn('[roomDirectory] BroadcastChannel init error:', e);
      }
    }

    // 2. Storage event for cross-tab sync fallback
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === LOCAL_STORAGE_KEY) {
          this.loadFromLocalStorage();
        }
      });
      // Initial load
      this.loadFromLocalStorage();
    }

    // 3. Connect to open pub/sub relay (ntfy.sh SSE) for WAN/network rooms
    this.initNetworkDiscovery();

    // 4. Periodic prune timer to purge rooms whose host heartbeats have timed out
    this.pruneTimer = setInterval(() => {
      this.pruneExpiredRooms();
    }, 3000);
  }

  initNetworkDiscovery() {
    if (typeof window === 'undefined') return;
    try {
      this.eventSource = new EventSource(`https://ntfy.sh/${NTFY_TOPIC}/sse`);
      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.message) {
            const parsed = JSON.parse(data.message);
            this.handleIncomingMessage(parsed);
          }
        } catch (e) {
          // Ignore keepalive or non-JSON messages
        }
      };
      this.eventSource.onerror = () => {
        // SSE network error or offline - silently continues with BroadcastChannel & LocalStorage
      };
    } catch (e) {
      console.warn('[roomDirectory] Network discovery unavailable:', e);
    }
  }

  loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const now = Date.now();
        let changed = false;
        Object.entries(parsed).forEach(([id, room]) => {
          if (now - room.lastSeen <= ROOM_EXPIRY_MS) {
            this.activeRoomsMap.set(id, room);
            changed = true;
          }
        });
        if (changed) this.emitRooms();
      }
    } catch (e) {}
  }

  saveToLocalStorage() {
    try {
      const obj = {};
      this.activeRoomsMap.forEach((val, key) => {
        obj[key] = val;
      });
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {}
  }

  handleIncomingMessage(msg) {
    if (!msg || !msg.action) return;

    if (msg.action === 'HEARTBEAT' && msg.advertId) {
      this.activeRoomsMap.set(msg.advertId, {
        advertId: msg.advertId,
        hostName: msg.hostName || 'Player',
        playerCount: msg.playerCount || 1,
        maxPlayers: msg.maxPlayers || 10,
        gamePhase: msg.gamePhase || 'LOBBY',
        salt: msg.salt,
        codeHash: msg.codeHash,
        lastSeen: Date.now()
      });
      this.saveToLocalStorage();
      this.emitRooms();
      return;
    }

    if (msg.action === 'DELETE' && msg.advertId) {
      if (this.activeRoomsMap.has(msg.advertId)) {
        this.activeRoomsMap.delete(msg.advertId);
        this.saveToLocalStorage();
        this.emitRooms();
      }
      return;
    }
  }

  pruneExpiredRooms() {
    const now = Date.now();
    let changed = false;
    for (const [id, room] of this.activeRoomsMap.entries()) {
      if (now - room.lastSeen > ROOM_EXPIRY_MS) {
        this.activeRoomsMap.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.saveToLocalStorage();
      this.emitRooms();
    }
  }

  emitRooms() {
    const list = Array.from(this.activeRoomsMap.values()).sort(
      (a, b) => b.lastSeen - a.lastSeen
    );
    this.listeners.forEach((listener) => {
      try {
        listener(list);
      } catch (e) {
        console.error('[roomDirectory] Listener error:', e);
      }
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    // Immediately emit current known active rooms
    listener(
      Array.from(this.activeRoomsMap.values()).sort(
        (a, b) => b.lastSeen - a.lastSeen
      )
    );
    return () => this.listeners.delete(listener);
  }

  /**
   * Start advertising an active room (host only)
   */
  async startAdvertising({ roomCode, hostName, playerCount, maxPlayers = 10, gamePhase = 'LOBBY' }) {
    this.stopAdvertising();

    const advertId = `ad_${roomCode}`;
    const salt = Math.random().toString(36).slice(2, 8);
    const codeHash = await hashRoomCode(roomCode, salt);

    this.currentAdvert = {
      advertId,
      roomCode,
      hostName,
      playerCount,
      maxPlayers,
      gamePhase,
      salt,
      codeHash
    };

    const broadcastPulse = () => {
      if (!this.currentAdvert) return;

      const payload = {
        action: 'HEARTBEAT',
        advertId: this.currentAdvert.advertId,
        hostName: this.currentAdvert.hostName,
        playerCount: this.currentAdvert.playerCount,
        maxPlayers: this.currentAdvert.maxPlayers,
        gamePhase: this.currentAdvert.gamePhase,
        salt: this.currentAdvert.salt,
        codeHash: this.currentAdvert.codeHash,
        lastSeen: Date.now()
      };

      // 1. BroadcastChannel
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage(payload);
        } catch (e) {}
      }

      // 2. Local active rooms map & LocalStorage
      this.activeRoomsMap.set(payload.advertId, payload);
      this.saveToLocalStorage();
      this.emitRooms();

      // 3. Network relay publish (throttled/non-blocking)
      try {
        fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
      } catch (e) {}
    };

    // First pulse immediately
    broadcastPulse();
    this.advertTimer = setInterval(broadcastPulse, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Update active room statistics (player count, phase changes)
   */
  updateAdvertising(updates) {
    if (!this.currentAdvert) return;
    Object.assign(this.currentAdvert, updates);
    // Instant pulse with new values
    if (this.currentAdvert) {
      const payload = {
        action: 'HEARTBEAT',
        advertId: this.currentAdvert.advertId,
        hostName: this.currentAdvert.hostName,
        playerCount: this.currentAdvert.playerCount,
        maxPlayers: this.currentAdvert.maxPlayers,
        gamePhase: this.currentAdvert.gamePhase,
        salt: this.currentAdvert.salt,
        codeHash: this.currentAdvert.codeHash,
        lastSeen: Date.now()
      };

      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage(payload);
        } catch (e) {}
      }

      this.activeRoomsMap.set(payload.advertId, payload);
      this.saveToLocalStorage();
      this.emitRooms();

      try {
        fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
      } catch (e) {}
    }
  }

  /**
   * Stop advertising and explicitly delete the room from directory
   */
  stopAdvertising() {
    if (this.advertTimer) {
      clearInterval(this.advertTimer);
      this.advertTimer = null;
    }

    if (this.currentAdvert) {
      const advertId = this.currentAdvert.advertId;
      this.currentAdvert = null;

      const deletePayload = {
        action: 'DELETE',
        advertId
      };

      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage(deletePayload);
        } catch (e) {}
      }

      this.activeRoomsMap.delete(advertId);
      this.saveToLocalStorage();
      this.emitRooms();

      try {
        fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
          method: 'POST',
          body: JSON.stringify(deletePayload),
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
      } catch (e) {}
    }
  }

  /**
   * Explicitly delete a room by code/advertId (e.g., if everyone leaves)
   */
  deleteRoomByCode(roomCode) {
    const advertId = `ad_${roomCode}`;
    const deletePayload = { action: 'DELETE', advertId };

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(deletePayload);
      } catch (e) {}
    }

    this.activeRoomsMap.delete(advertId);
    this.saveToLocalStorage();
    this.emitRooms();

    try {
      fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
        method: 'POST',
        body: JSON.stringify(deletePayload),
        headers: { 'Content-Type': 'application/json' }
      }).catch(() => {});
    } catch (e) {}
  }

  /**
   * Verifies an entered 4-digit code against an active room advertisement.
   * Returns true if correct, false otherwise.
   */
  async verifyRoomCode(advert, enteredCode) {
    if (!advert || !enteredCode) return false;
    const computed = await hashRoomCode(enteredCode.trim(), advert.salt);
    return computed === advert.codeHash;
  }
}

export const roomDirectory = new RoomDirectory();
