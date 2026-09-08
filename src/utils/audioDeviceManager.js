/**
 * Universal Audio Device Manager
 * Centralizes microphone selection, persistence, and stream acquisition
 * across both Game Recording and Voice Chat.
 */

const STORAGE_KEY = 'tintom_universal_mic_id';

class AudioDeviceManager {
  constructor() {
    this.selectedDeviceId = localStorage.getItem(STORAGE_KEY) || '';
    this.listeners = new Set();
    this.devices = [];
    this.hasPermission = false;

    if (typeof window !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.ondevicechange = () => {
        this.enumerateDevices().catch(() => {});
      };
    }
  }

  /**
   * Subscribe to microphone device selection changes
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners() {
    this.listeners.forEach((fn) => {
      try {
        fn(this.selectedDeviceId, this.devices);
      } catch (e) {
        console.error('[audioDeviceManager] Listener error:', e);
      }
    });
  }

  /**
   * Retrieve available audio input devices. Requests permission if labels are empty.
   */
  async enumerateDevices(promptIfEmpty = false) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }

    try {
      let devs = await navigator.mediaDevices.enumerateDevices();
      let audioInputs = devs.filter((d) => d.kind === 'audioinput');

      // If devices have no label, request a momentary stream to populate device labels
      const needsLabel = audioInputs.length > 0 && audioInputs.some((d) => !d.label);
      if ((needsLabel || promptIfEmpty) && !this.hasPermission) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.hasPermission = true;
          stream.getTracks().forEach((t) => t.stop());
          devs = await navigator.mediaDevices.enumerateDevices();
          audioInputs = devs.filter((d) => d.kind === 'audioinput');
        } catch (err) {
          console.warn('[audioDeviceManager] Microphone permission denied or dismissed:', err);
        }
      }

      this.devices = audioInputs;

      // Validate selectedDeviceId is still present
      if (this.selectedDeviceId && !audioInputs.some((d) => d.deviceId === this.selectedDeviceId)) {
        // Fallback to first available if saved device is disconnected
        if (audioInputs.length > 0) {
          this.setSelectedDeviceId(audioInputs[0].deviceId);
        }
      } else if (!this.selectedDeviceId && audioInputs.length > 0) {
        this.selectedDeviceId = audioInputs[0].deviceId;
      }

      this.notifyListeners();
      return this.devices;
    } catch (e) {
      console.error('[audioDeviceManager] enumerateDevices error:', e);
      return [];
    }
  }

  getSelectedDeviceId() {
    return this.selectedDeviceId;
  }

  setSelectedDeviceId(deviceId) {
    if (this.selectedDeviceId === deviceId) return;
    this.selectedDeviceId = deviceId || '';
    if (deviceId) {
      localStorage.setItem(STORAGE_KEY, deviceId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    this.notifyListeners();
  }

  /**
   * Acquire a MediaStream using the universal microphone and high-quality constraints
   */
  async getUniversalAudioStream(extraConstraints = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access is not supported in this browser.');
    }

    // Ensure we have enumerated devices
    if (this.devices.length === 0) {
      await this.enumerateDevices(true);
    }

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...extraConstraints
    };

    if (this.selectedDeviceId) {
      audioConstraints.deviceId = { exact: this.selectedDeviceId };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });
      this.hasPermission = true;
      return stream;
    } catch (err) {
      // If exact device failed (e.g. unplugged), fallback to default audio
      if (this.selectedDeviceId) {
        console.warn('[audioDeviceManager] Exact mic request failed, trying default audio:', err);
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...extraConstraints
          }
        });
        this.hasPermission = true;
        return fallbackStream;
      }
      throw err;
    }
  }
}

export const audioDeviceManager = new AudioDeviceManager();
