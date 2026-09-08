/**
 * Web Audio API Direct PCM Audio Player
 * Works with DataURLs, Blobs, and Object URLs.
 * Does NOT use fetch() on data URLs — converts base64 directly to ArrayBuffer.
 */

import { getAudioContext } from './audioAnalyzer';

let currentPlayingSource = null;

export function stopCurrentAudio() {
  if (currentPlayingSource) {
    try { currentPlayingSource.stop(); } catch (e) {}
    currentPlayingSource = null;
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
 * Play audio from a DataURL, Blob, or object URL.
 * Returns a Promise that resolves when audio finishes playing.
 */
export async function playAudioDataUrl(source) {
  stopCurrentAudio();

  const audioCtx = getAudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  let arrayBuffer;

  try {
    if (source instanceof Blob) {
      arrayBuffer = await source.arrayBuffer();
    } else if (typeof source === 'string' && source.startsWith('data:')) {
      // Base64 data URL – decode without fetch
      arrayBuffer = dataUrlToArrayBuffer(source);
    } else if (typeof source === 'string') {
      // Object URL (blob:...) – fetch is fine here
      const res = await fetch(source);
      arrayBuffer = await res.arrayBuffer();
    } else {
      console.warn('[audioPlayer] Unknown source type:', typeof source);
      return;
    }

    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
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
      source_.start(0);
      // Safety timeout
      setTimeout(finish, (audioBuffer.duration + 1.0) * 1000);
    });

  } catch (err) {
    console.error('[audioPlayer] Playback failed:', err);
    currentPlayingSource = null;
  }
}
