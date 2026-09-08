/**
 * Client-Side Audio Signal Processing (DSP) & Dynamic Time Warping (DTW) Scoring Engine
 * Accurate, responsive, zero external dependencies.
 *
 * Includes:
 *  - In-memory 1024-Point Radix-2 FFT with Hann window (covers 65 Hz to 22 kHz)
 *  - 4-Band spectral energy profile (Bass, Low-Mid, High-Mid, Treble) & true Spectral Centroid
 *  - Normalized Autocorrelation pitch detector with unvoiced noise rejection
 *  - Dual Absolute Pitch Register + Pitch Contour matching
 *  - Backtracking DTW with true path-length normalization & warping penalties
 */

// Global AudioContext singleton helper
let sharedAudioCtx = null;
export function getAudioContext() {
  if (!sharedAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    sharedAudioCtx = new AudioContextClass();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

/**
 * Decode Audio Blob (webm/wav/mp3) into float32 PCM array & sample rate
 */
export async function decodeAudioBlob(blob) {
  const audioCtx = getAudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // Extract mono channel (averaging stereo if needed)
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const pcm = new Float32Array(length);

  if (numChannels === 1) {
    pcm.set(audioBuffer.getChannelData(0));
  } else {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < length; i++) {
      pcm[i] = (left[i] + right[i]) / 2;
    }
  }

  return {
    pcm,
    sampleRate: audioBuffer.sampleRate,
    duration: audioBuffer.duration
  };
}

/**
 * Trim leading & trailing silence from PCM audio based on RMS threshold
 */
export function trimSilence(pcm, sampleRate, threshold = 0.015) {
  const windowSize = Math.floor(sampleRate * 0.02); // 20ms frame
  let start = 0;
  let end = pcm.length;

  // Find start
  for (let i = 0; i <= pcm.length - windowSize; i += windowSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      sum += pcm[i + j] * pcm[i + j];
    }
    const rms = Math.sqrt(sum / windowSize);
    if (rms > threshold) {
      start = Math.max(0, i - windowSize);
      break;
    }
  }

  // Find end
  for (let i = pcm.length - windowSize; i >= start; i -= windowSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      sum += pcm[i + j] * pcm[i + j];
    }
    const rms = Math.sqrt(sum / windowSize);
    if (rms > threshold) {
      end = Math.min(pcm.length, i + windowSize * 2);
      break;
    }
  }

  if (start >= end) return pcm; // Fallback if silent
  return pcm.subarray(start, end);
}

// ─── Fast In-Memory 1024-Point Radix-2 FFT ───────────────────────────────────

const FFT_SIZE = 1024;
const cosTable = new Float32Array(FFT_SIZE / 2);
const sinTable = new Float32Array(FFT_SIZE / 2);
const bitReverse = new Uint16Array(FFT_SIZE);
const hannWindow = new Float32Array(FFT_SIZE);

// Precompute tables for 1024-point FFT
for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  let rev = 0;
  let temp = i;
  for (let j = 0; j < 10; j++) { // 2^10 = 1024
    rev = (rev << 1) | (temp & 1);
    temp >>= 1;
  }
  bitReverse[i] = rev;
}

for (let i = 0; i < FFT_SIZE / 2; i++) {
  cosTable[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  sinTable[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
}

/**
 * Compute real FFT magnitudes for a 1024-sample time window
 * Returns Float32Array(512) of frequency bin magnitudes
 */
function computeFFTMagnitudes(timeData, outMags) {
  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);

  const len = Math.min(FFT_SIZE, timeData.length);
  for (let i = 0; i < FFT_SIZE; i++) {
    const src = i < len ? timeData[i] * hannWindow[i] : 0;
    const rev = bitReverse[i];
    real[rev] = src;
    imag[rev] = 0;
  }

  for (let halfSize = 1; halfSize < FFT_SIZE; halfSize *= 2) {
    const step = halfSize * 2;
    const kStep = (FFT_SIZE / 2) / halfSize;
    for (let k = 0; k < halfSize; k++) {
      const cosVal = cosTable[k * kStep];
      const sinVal = sinTable[k * kStep];
      for (let i = k; i < FFT_SIZE; i += step) {
        const j = i + halfSize;
        const tempReal = real[j] * cosVal - imag[j] * sinVal;
        const tempImag = real[j] * sinVal + imag[j] * cosVal;
        real[j] = real[i] - tempReal;
        imag[j] = imag[i] - tempImag;
        real[i] += tempReal;
        imag[i] += tempImag;
      }
    }
  }

  const numBins = FFT_SIZE / 2;
  for (let i = 0; i < numBins; i++) {
    outMags[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }
}

/**
 * Normalized Autocorrelation Pitch Detector (Hz or 0 if unvoiced/noisy)
 * Accurately detects pitch from 65 Hz (deep bass) to 900 Hz (high soprano/screech)
 */
function detectPitchAutocorrelation(frame, sampleRate) {
  const SIZE = frame.length;
  let sumSq = 0;
  for (let i = 0; i < SIZE; i++) sumSq += frame[i] * frame[i];
  const rms = Math.sqrt(sumSq / SIZE);
  if (rms < 0.015) return 0; // Silent / too quiet

  const minLag = Math.max(1, Math.floor(sampleRate / 900));
  const maxLag = Math.min(SIZE - 64, Math.floor(sampleRate / 65));

  let bestLag = -1;
  let bestNormCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let energyLag = 0;
    for (let i = 0; i < SIZE - lag; i++) {
      corr += frame[i] * frame[i + lag];
      energyLag += frame[i + lag] * frame[i + lag];
    }
    const denom = Math.sqrt(sumSq * energyLag);
    const normCorr = denom > 1e-6 ? corr / denom : 0;

    if (normCorr > bestNormCorr) {
      bestNormCorr = normCorr;
      bestLag = lag;
    }
  }

  // Periodic voices/sounds have normalized autocorrelation peak >= 0.35
  if (bestLag > 0 && bestNormCorr >= 0.35) {
    return sampleRate / bestLag;
  }

  return 0; // Unvoiced / noise
}

/**
 * Extract time-series features (RMS envelope, absolute MIDI pitch, 4-band spectral profile, centroid)
 */
export function extractAudioFeatures(pcm, sampleRate) {
  const frameSize = FFT_SIZE; // 1024 samples (~23.2ms at 44.1k)
  const hopSize = Math.floor(sampleRate * 0.02); // 20ms hop (50 frames per second)
  const numFrames = Math.floor((pcm.length - frameSize) / hopSize);

  if (numFrames <= 0) return [];

  const rawFrames = [];
  const fftMags = new Float32Array(FFT_SIZE / 2);
  const binWidth = sampleRate / FFT_SIZE;

  // Band bin indices
  const bassEndBin = Math.max(1, Math.min(511, Math.floor(350 / binWidth)));
  const lowMidEndBin = Math.max(bassEndBin + 1, Math.min(511, Math.floor(1200 / binWidth)));
  const highMidEndBin = Math.max(lowMidEndBin + 1, Math.min(511, Math.floor(3500 / binWidth)));
  const trebleEndBin = Math.max(highMidEndBin + 1, Math.min(511, Math.floor(10000 / binWidth)));

  let maxRms = 0.001;

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    const frame = pcm.subarray(start, start + frameSize);

    // 1. RMS Energy
    let sumSq = 0;
    let zcrCount = 0;
    for (let i = 0; i < frameSize; i++) {
      sumSq += frame[i] * frame[i];
      if (i > 0 && ((frame[i] >= 0 && frame[i - 1] < 0) || (frame[i] < 0 && frame[i - 1] >= 0))) {
        zcrCount++;
      }
    }
    const rms = Math.sqrt(sumSq / frameSize);
    if (rms > maxRms) maxRms = rms;

    // 2. Fundamental Frequency (Pitch)
    const pitchHz = detectPitchAutocorrelation(frame, sampleRate);
    const isVoiced = pitchHz >= 65 && pitchHz <= 1000;
    // Continuous MIDI note number: 69 is A4 (440Hz), 60 is C4 (261Hz)
    const midiNote = isVoiced ? (12 * Math.log2(pitchHz / 440) + 69) : 0;

    // 3. FFT Magnitudes & Spectral Features
    computeFFTMagnitudes(frame, fftMags);

    // Spectral Centroid (Frequency center of gravity)
    let centroidNum = 0;
    let centroidDen = 0;
    for (let i = 1; i < FFT_SIZE / 2; i++) {
      const mag = fftMags[i];
      centroidNum += (i * binWidth) * mag;
      centroidDen += mag;
    }
    const centroidHz = centroidDen > 1e-6 ? centroidNum / centroidDen : 1000;
    // Log-scale centroid between 50Hz and 10,000Hz (0.0 to 1.0)
    const centroidNorm = Math.max(0, Math.min(1, Math.log2(Math.max(50, centroidHz) / 50) / Math.log2(10000 / 50)));

    // 4. Spectral Energy Profile (4 Bands: Bass, Low-Mid, High-Mid, Treble)
    let eBass = 0, eLowMid = 0, eHighMid = 0, eTreble = 0;
    for (let i = 1; i <= bassEndBin; i++) eBass += fftMags[i] * fftMags[i];
    for (let i = bassEndBin + 1; i <= lowMidEndBin; i++) eLowMid += fftMags[i] * fftMags[i];
    for (let i = lowMidEndBin + 1; i <= highMidEndBin; i++) eHighMid += fftMags[i] * fftMags[i];
    for (let i = highMidEndBin + 1; i <= trebleEndBin; i++) eTreble += fftMags[i] * fftMags[i];

    const totalBandEnergy = eBass + eLowMid + eHighMid + eTreble + 1e-6;
    const bands = [
      eBass / totalBandEnergy,
      eLowMid / totalBandEnergy,
      eHighMid / totalBandEnergy,
      eTreble / totalBandEnergy
    ];

    rawFrames.push({
      rms,
      pitchHz,
      isVoiced,
      midiNote,
      centroidNorm,
      bands,
      zcrNorm: Math.min(1, (zcrCount / frameSize) * 2)
    });
  }

  // Normalize RMS against audio peak
  return rawFrames.map(f => ({
    ...f,
    rmsNorm: Math.max(0, Math.min(1, f.rms / maxRms))
  }));
}

/**
 * Calculate distance between two individual audio frames
 */
function computeFrameCost(target, player) {
  // 1. Pitch distance
  let dPitch = 0;
  if (target.isVoiced && player.isVoiced) {
    // Both voiced: measure pitch distance in semitones
    // 1 semitone diff = 0.08, 1 octave (12 semitones) = 0.96
    const semitoneDiff = Math.abs(target.midiNote - player.midiNote);
    dPitch = Math.min(1.0, semitoneDiff / 12.5);
  } else if (target.isVoiced !== player.isVoiced) {
    // Voicing mismatch (one is pitched voice, one is noise/whisper/silence)
    dPitch = 0.80;
  } else {
    // Both unvoiced: no pitch error
    dPitch = 0.0;
  }

  // 2. Rhythm / Volume Envelope distance
  const dRms = Math.abs(target.rmsNorm - player.rmsNorm);

  // 3. Timbre distance: 4-band spectral distribution + spectral centroid brightness
  let bandDiff = 0;
  for (let b = 0; b < 4; b++) {
    bandDiff += Math.abs(target.bands[b] - player.bands[b]);
  }
  const dBand = bandDiff * 0.5; // sum of abs diffs normalized to [0, 1]
  const dCentroid = Math.abs(target.centroidNorm - player.centroidNorm);
  const dZcr = Math.abs(target.zcrNorm - player.zcrNorm);

  const dTimbre = (dBand * 0.55) + (dCentroid * 0.35) + (dZcr * 0.10);

  // Weighted overall frame distance
  const total = (dPitch * 0.45) + (dRms * 0.30) + (dTimbre * 0.25);

  return { total, dPitch, dRms, dTimbre };
}

/**
 * Convert raw average cost (0 = identical, 0.55+ = completely wrong) into an intuitive 0-100 score
 */
function costToScore(avgCost, maxTolerance = 0.55) {
  const normalized = Math.max(0, Math.min(1, avgCost / maxTolerance));
  // Non-linear curve: rewarding close matches, steeply penalizing completely off sounds
  const score = Math.round(100 * (1 - Math.pow(normalized, 1.15)));
  return Math.max(0, Math.min(100, score));
}

/**
 * Dynamic Time Warping (DTW) similarity scoring between target & player features
 */
export function computeDTWSimilarity(targetFeatures, playerFeatures) {
  const N = targetFeatures.length;
  const M = playerFeatures.length;

  if (N === 0 || M === 0) {
    return { overallScore: 0, pitchScore: 0, rhythmScore: 0, timbreScore: 0 };
  }

  // Check if player audio is essentially silent
  const playerPeakRms = playerFeatures.reduce((m, f) => Math.max(m, f.rms), 0);
  if (playerPeakRms < 0.01) {
    return { overallScore: 5, pitchScore: 5, rhythmScore: 5, timbreScore: 5 };
  }

  // DTW cost matrix
  const dtw = Array.from({ length: N + 1 }, () => new Float32Array(M + 1).fill(Infinity));
  const pathDir = Array.from({ length: N + 1 }, () => new Uint8Array(M + 1)); // 1: diag, 2: up, 3: left
  dtw[0][0] = 0;

  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      const frameCost = computeFrameCost(targetFeatures[i - 1], playerFeatures[j - 1]);

      // Small warping penalty (+0.06) on off-diagonal steps to prevent unnatural temporal stretching
      const diag = dtw[i - 1][j - 1] + frameCost.total;
      const up   = dtw[i - 1][j] + frameCost.total + 0.06;
      const left = dtw[i][j - 1] + frameCost.total + 0.06;

      if (diag <= up && diag <= left) {
        dtw[i][j] = diag;
        pathDir[i][j] = 1;
      } else if (up <= left) {
        dtw[i][j] = up;
        pathDir[i][j] = 2;
      } else {
        dtw[i][j] = left;
        pathDir[i][j] = 3;
      }
    }
  }

  // Backtrack along the optimal path to accumulate exact metric costs and true path length
  let currI = N;
  let currJ = M;
  let pathSteps = 0;
  let totalPitchCost = 0;
  let totalRmsCost = 0;
  let totalTimbreCost = 0;

  while (currI > 0 && currJ > 0) {
    const cost = computeFrameCost(targetFeatures[currI - 1], playerFeatures[currJ - 1]);
    totalPitchCost += cost.dPitch;
    totalRmsCost += cost.dRms;
    totalTimbreCost += cost.dTimbre;
    pathSteps++;

    const dir = pathDir[currI][currJ];
    if (dir === 1) {
      currI--;
      currJ--;
    } else if (dir === 2) {
      currI--;
    } else {
      currJ--;
    }
  }

  while (currI > 0) {
    currI--;
    totalPitchCost += 0.8;
    totalRmsCost += 0.8;
    totalTimbreCost += 0.8;
    pathSteps++;
  }
  while (currJ > 0) {
    currJ--;
    totalPitchCost += 0.8;
    totalRmsCost += 0.8;
    totalTimbreCost += 0.8;
    pathSteps++;
  }

  const stepCount = Math.max(1, pathSteps);
  const avgPitchCost = totalPitchCost / stepCount;
  const avgRmsCost = totalRmsCost / stepCount;
  const avgTimbreCost = totalTimbreCost / stepCount;

  // Duration ratio penalty: if player recorded only fraction of target duration, penalize rhythm
  const durationRatio = Math.min(N, M) / Math.max(N, M);
  const durationPenalty = durationRatio < 0.6 ? (0.6 - durationRatio) * 0.4 : 0;
  const finalRmsCost = Math.min(1.0, avgRmsCost + durationPenalty);

  const pitchScore = costToScore(avgPitchCost, 0.52);
  const rhythmScore = costToScore(finalRmsCost, 0.55);
  const timbreScore = costToScore(avgTimbreCost, 0.48);

  // If both pitch and timbre are severely mismatched (< 20%), penalize overall score
  // so a player cannot get a decent score just by matching volume envelope with an alien tone
  let baseOverall = pitchScore * 0.45 + rhythmScore * 0.30 + timbreScore * 0.25;
  if (pitchScore < 20 && timbreScore < 20) {
    baseOverall = Math.min(baseOverall, 22);
  }

  const overallScore = Math.max(0, Math.min(100, Math.round(baseOverall)));

  return {
    overallScore,
    pitchScore,
    rhythmScore,
    timbreScore
  };
}

/**
 * Main entrance point: Compare Target Audio Blob vs Player Audio Blob
 */
export async function scoreAudioComparison(targetBlob, playerBlob) {
  const targetData = await decodeAudioBlob(targetBlob);
  const playerData = await decodeAudioBlob(playerBlob);

  const targetTrimmed = trimSilence(targetData.pcm, targetData.sampleRate);
  const playerTrimmed = trimSilence(playerData.pcm, playerData.sampleRate);

  const targetFeatures = extractAudioFeatures(targetTrimmed, targetData.sampleRate);
  const playerFeatures = extractAudioFeatures(playerTrimmed, playerData.sampleRate);

  const scores = computeDTWSimilarity(targetFeatures, playerFeatures);
  const funnyTitle = getFunnyTitle(scores.overallScore);

  return {
    ...scores,
    funnyTitle,
    targetDuration: targetData.duration.toFixed(1),
    playerDuration: playerData.duration.toFixed(1)
  };
}

/**
 * Fun feedback badge based on score percent
 */
export function getFunnyTitle(score) {
  if (score >= 90) return "🎭 Master Doppelgänger!";
  if (score >= 80) return "🎙️ Spot-On Voice Actor!";
  if (score >= 68) return "✨ Impressive Impression!";
  if (score >= 52) return "🤪 Close Enough For Party!";
  if (score >= 38) return "🎺 A For Effort, F For Tuning";
  if (score >= 22) return "🦜 Confused Parrot";
  return "💩 Tone-Deaf Legend";
}
