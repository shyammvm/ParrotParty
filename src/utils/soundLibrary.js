/**
 * Sound Library — TinTom Simulator
 *
 * AUTOMATIC SOUND DISCOVERY:
 * Any folder with audio files (.mp3, .wav, .ogg, .m4a, .aac, .flac) placed in
 * public/sounds/<folder>/ is automatically detected and turned into a playable Sound Pack!
 *
 * All sounds are 100% real audio — zero synthetic generators.
 */

import { getAudioContext } from './audioAnalyzer.js';
import { cacheAudioBuffer } from './audioPlayer.js';

// Auto-scan all audio files inside public/sounds/ (and root sounds/ if present)
const rawSoundModules = {
  ...import.meta.glob('/public/sounds/**/*.{mp3,wav,ogg,m4a,aac,flac}', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('/sounds/**/*.{mp3,wav,ogg,m4a,aac,flac}', { eager: true, query: '?url', import: 'default' })
};

// Map popular folder names to theme emojis
const FOLDER_EMOJIS = {
  japanese: '🌸',
  anime: '✨',
  cartoon: '🐥',
  cartoons: '🐥',
  drama: '🎭',
  movies: '🎬',
  movie: '🎬',
  animals: '🦁',
  animal: '🦁',
  nature: '🌲',
  memes: '🤣',
  meme: '🤣',
  gaming: '🎮',
  game: '🎮',
  games: '🎮',
  mega: '⚡',
  funny: '🤪',
  horror: '👻',
  scary: '🎃',
  music: '🎵',
  retro: '👾',
  voice: '🗣️',
  voices: '🗣️',
  silly: '🤡',
  instruments: '🎸'
};

function formatTitle(str) {
  return str
    .replace(/[-_.]+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function buildSoundPacks(modules) {
  const packsMap = new Map();

  for (const [rawPath, url] of Object.entries(modules)) {
    // Strip leading /public/sounds/ or /sounds/
    const normalized = rawPath.replace(/^\/?(public\/)?sounds\//, '');
    const parts = normalized.split('/');

    let folderName = 'general';
    let fileName = '';

    if (parts.length >= 2) {
      folderName = parts[0];
      fileName = parts.slice(1).join('/');
    } else {
      folderName = 'general';
      fileName = parts[0];
    }

    const baseName = fileName.replace(/\.[^/.]+$/, '');
    if (!baseName) continue;

    const soundTitle = formatTitle(baseName);
    const soundId = `${folderName}-${baseName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;

    if (!packsMap.has(folderName)) {
      const folderKey = folderName.toLowerCase();
      const icon = FOLDER_EMOJIS[folderKey] || '🎵';
      const cleanTitle = formatTitle(folderName);
      packsMap.set(folderName, {
        id: `pack-${folderKey.replace(/[^a-z0-9_-]/g, '-')}`,
        title: `${icon} ${cleanTitle} Pack`,
        folderName,
        icon,
        description: `${cleanTitle} audio pack`,
        sounds: []
      });
    }

    const pack = packsMap.get(folderName);
    pack.sounds.push({
      id: soundId,
      title: soundTitle,
      soundUrl: url
    });
  }

  const packs = Array.from(packsMap.values());
  for (const pack of packs) {
    pack.sounds.sort((a, b) => a.title.localeCompare(b.title));
    pack.count = pack.sounds.length;
    pack.description = `${pack.sounds.length} real audio clips ready to imitate!`;
  }

  packs.sort((a, b) => a.title.localeCompare(b.title));
  return packs;
}

export const SOUND_PACKS = buildSoundPacks(rawSoundModules);

export const MYSTERY_PACK_ID = 'pack-random-all';

/**
 * Implements Fisher-Yates shuffle returning a new shuffled array
 */
export function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Returns all unique sounds collected across all sound packs
 */
export function getAllSounds() {
  const all = [];
  const seenIds = new Set();
  for (const pack of SOUND_PACKS) {
    for (const sound of pack.sounds) {
      if (!seenIds.has(sound.id)) {
        seenIds.add(sound.id);
        all.push({ ...sound, packTitle: pack.title });
      }
    }
  }
  return all;
}

// ─── WAV encoder ────────────────────────────────────────────────────────────

export function bufferToWavBlob(audioBuffer, targetSampleRate = 16000) {
  const srcSampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const srcLength = audioBuffer.length;

  // Extract mono channel (downmix if stereo)
  const monoData = new Float32Array(srcLength);
  if (numChannels === 1) {
    monoData.set(audioBuffer.getChannelData(0));
  } else {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < srcLength; i++) {
      monoData[i] = (left[i] + right[i]) / 2;
    }
  }

  // Resample to targetSampleRate using linear interpolation
  const finalRate = targetSampleRate && targetSampleRate < srcSampleRate ? targetSampleRate : srcSampleRate;
  const ratio = srcSampleRate / finalRate;
  const targetLength = Math.floor(srcLength / ratio);
  const resampled = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, srcLength - 1);
    const frac = srcIdx - i0;
    resampled[i] = monoData[i0] * (1 - frac) + monoData[i1] * frac;
  }

  // 16-bit PCM WAV encoding
  const length = targetLength * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  let pos = 0;

  const setUint16 = (d) => { view.setUint16(pos, d, true); pos += 2; };
  const setUint32 = (d) => { view.setUint32(pos, d, true); pos += 4; };

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(1); // 1 = PCM, 1 = Mono
  setUint32(finalRate); setUint32(finalRate * 2);                    // Sample rate, Byte rate (Rate * 1 * 2)
  setUint16(2); setUint16(16);                                      // Block align (2), 16-bit
  setUint32(0x61746164); setUint32(length - pos - 4);              // "data", data size

  for (let i = 0; i < targetLength; i++) {
    let s = Math.max(-1, Math.min(1, resampled[i]));
    s = (0.5 + s < 0 ? s * 32768 : s * 32767) | 0;
    view.setInt16(pos, s, true); pos += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export const DEFAULT_SILENCE_PADDING_SEC = 0;

/**
 * Pad an AudioBuffer with silence on both sides (lead-in and lead-out).
 * This prevents users from being startled by immediate loud audio peaks,
 * provides visual anticipation on the waveform canvas, and gives reaction time
 * when recording.
 */
export function padAudioBuffer(audioCtx, originalBuffer, padLeadingSec = DEFAULT_SILENCE_PADDING_SEC, padTrailingSec = DEFAULT_SILENCE_PADDING_SEC) {
  if (!originalBuffer) return originalBuffer;
  if (padLeadingSec <= 0 && padTrailingSec <= 0) return originalBuffer;

  const sampleRate = originalBuffer.sampleRate;
  const numChannels = originalBuffer.numberOfChannels;
  const leadSamples = Math.round(padLeadingSec * sampleRate);
  const trailSamples = Math.round(padTrailingSec * sampleRate);
  const totalSamples = originalBuffer.length + leadSamples + trailSamples;

  const paddedBuffer = audioCtx.createBuffer(numChannels, totalSamples, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const origData = originalBuffer.getChannelData(channel);
    const paddedData = paddedBuffer.getChannelData(channel);
    // Float32Array is zero-initialized, so leading and trailing regions are pure silence
    paddedData.set(origData, leadSamples);
  }
  return paddedBuffer;
}

// ─── Load a real audio file URL, pad with silence, and return a WAV blob ─────

export async function loadSoundUrl(url, padLeadingSec = DEFAULT_SILENCE_PADDING_SEC, padTrailingSec = DEFAULT_SILENCE_PADDING_SEC) {
  const audioCtx = getAudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  // Support both relative base and absolute base paths (e.g. GitHub Pages)
  const base = import.meta.env.BASE_URL || '/';
  let resolvedUrl = url;
  if (url.startsWith('/')) {
    resolvedUrl = base.endsWith('/') ? `${base}${url.slice(1)}` : `${base}${url}`;
  }

  // Prevent double encoding if the URL already has percent-encoding (e.g. %20)
  const safeUrl = encodeURI(decodeURI(resolvedUrl));

  const res = await fetch(safeUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading audio file: ${safeUrl}`);

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(`File not found or returned HTML (${res.status}): ${safeUrl}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  // Decode audio data (slice to prevent ArrayBuffer detachment issues)
  const rawAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  cacheAudioBuffer(url, rawAudioBuffer);
  cacheAudioBuffer(resolvedUrl, rawAudioBuffer);
  cacheAudioBuffer(safeUrl, rawAudioBuffer);

  const audioBuffer = padAudioBuffer(audioCtx, rawAudioBuffer, padLeadingSec, padTrailingSec);
  const blob = bufferToWavBlob(audioBuffer);

  return {
    blob,
    audioBuffer,
    duration: audioBuffer.duration
  };
}

