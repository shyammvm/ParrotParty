/**
 * Web Audio API Direct PCM Audio Player
 * Works with DataURLs, Blobs, and Object URLs.
 * Does NOT use fetch() on data URLs — converts base64 directly to ArrayBuffer.
 */

import { getAudioContext } from './audioAnalyzer';

let currentPlayingSource = null;
const audioBufferCache = new Map();

export function stopCurrentAudio() {
  if (currentPlayingSource) {
    try { currentPlayingSource.stop(); } catch (e) {}
    currentPlayingSource = null;
  }
}

/**
 * Cache a decoded AudioBuffer by key/URL
 */
export function cacheAudioBuffer(key, audioBuffer) {
  if (key && audioBuffer) {
    audioBufferCache.set(key, audioBuffer);
  }
}

/**
 * Convert a base64 data URL to ArrayBuffer without using fetch().
 * fetch() on data: URLs is unreliable in many browsers.
 */
function dataUrlToArrayBuffer(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Preload and decode audio into memory so playback starts instantaneously with 0ms latency.
 */
export async function preloadAudio(source) {
  if (!source) return null;
  const cacheKey = typeof source === 'string' ? source : null;
  if (cacheKey && audioBufferCache.has(cacheKey)) {
    return audioBufferCache.get(cacheKey);
  }

  const audioCtx = getAudioContext();
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch (e) {}
  }

  let arrayBuffer;
  try {
    if (source instanceof Blob) {
      arrayBuffer = await source.arrayBuffer();
    } else if (typeof source === 'string' && source.startsWith('data:')) {
      arrayBuffer = dataUrlToArrayBuffer(source);
    } else if (typeof source === 'string') {
      const res = await fetch(source);
      arrayBuffer = await res.arrayBuffer();
    } else {
      return null;
    }

    // Slice to prevent detachment issues
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    if (cacheKey) {
      audioBufferCache.set(cacheKey, audioBuffer);
    }
    return audioBuffer;
  } catch (err) {
    console.warn('[audioPlayer] Preload failed:', err);
    return null;
  }
}

/**
 * Play audio from a DataURL, Blob, or object URL.
 * Optional onStart({ audioCtx, startTime, duration }) callback fires at the EXACT
 * millisecond Web Audio starts emitting sound through the speakers.
 * Returns a Promise that resolves when audio finishes playing.
 */
export async function playAudioDataUrl(source, onStart) {
  stopCurrentAudio();

  const audioCtx = getAudioContext();
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch (e) {}
  }

  let audioBuffer;
  const cacheKey = typeof source === 'string' ? source : null;
  if (cacheKey && audioBufferCache.has(cacheKey)) {
    audioBuffer = audioBufferCache.get(cacheKey);
  } else {
    audioBuffer = await preloadAudio(source);
  }

  if (!audioBuffer) {
    console.warn('[audioPlayer] Playback failed: audio buffer could not be loaded');
    currentPlayingSource = null;
    return;
  }

  try {
    const source_ = audioCtx.createBufferSource();
    source_.buffer = audioBuffer;
    source_.connect(audioCtx.destination);
    currentPlayingSource = source_;

    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          currentPlayingSource = null;
          resolve();
        }
      };
      source_.onended = finish;

      // Start playback and trigger onStart with exact audio context timestamp
      const startTime = audioCtx.currentTime;
      source_.start(0);

      if (typeof onStart === 'function') {
        try {
          onStart({ audioCtx, startTime, duration: audioBuffer.duration });
        } catch (callbackErr) {
          console.error('[audioPlayer] onStart callback error:', callbackErr);
        }
      }

      // Safety timeout
      setTimeout(finish, (audioBuffer.duration + 0.3) * 1000);
    });

  } catch (err) {
    console.error('[audioPlayer] Playback failed:', err);
    currentPlayingSource = null;
  }
}
