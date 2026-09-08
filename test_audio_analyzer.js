import { trimSilence, extractAudioFeatures, computeDTWSimilarity, getFunnyTitle } from './src/utils/audioAnalyzer.js';

console.log('🧪 Running Comprehensive Audio Scoring Engine Tests...\n');

const sampleRate = 44100;
const duration = 2.0; // 2 seconds

function makeSine(freq, dur, amp = 0.5) {
  const pcm = new Float32Array(Math.floor(sampleRate * dur));
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sampleRate;
    const env = Math.sin((t / dur) * Math.PI);
    pcm[i] = Math.sin(2 * Math.PI * freq * t) * env * amp;
  }
  return pcm;
}

function makeNoise(dur, amp = 0.4) {
  const pcm = new Float32Array(Math.floor(sampleRate * dur));
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sampleRate;
    const env = Math.sin((t / dur) * Math.PI);
    pcm[i] = (Math.random() * 2 - 1) * env * amp;
  }
  return pcm;
}

function makeBursts(freq, dur) {
  const pcm = new Float32Array(Math.floor(sampleRate * dur));
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sampleRate;
    const burstPhase = (t / dur) * 3;
    const pulse = Math.max(0, Math.sin(burstPhase * Math.PI * 2));
    pcm[i] = Math.sin(2 * Math.PI * freq * t) * pulse * 0.5;
  }
  return pcm;
}

let allPassed = true;

// ── Test 1: Identical Sound (A4 440 Hz) ──────────────────────────
const targetPCM = makeSine(440, duration);
const featTarget = extractAudioFeatures(targetPCM, sampleRate);
const scoreIdentical = computeDTWSimilarity(featTarget, featTarget);
console.log('Test 1 (Identical 440Hz):', scoreIdentical);
if (scoreIdentical.overallScore >= 95) {
  console.log('✅ Passed Test 1 (Near 100% for identical audio)');
} else {
  console.error('❌ Failed Test 1: Expected >= 95%, got', scoreIdentical.overallScore);
  allPassed = false;
}

// ── Test 2: Very Close Mimic (1 semitone off, 466 Hz / Bb4) ──────
const playerClose = makeSine(466, duration);
const featClose = extractAudioFeatures(playerClose, sampleRate);
const scoreClose = computeDTWSimilarity(featTarget, featClose);
console.log('\nTest 2 (1-semitone off 466Hz vs 440Hz):', scoreClose);
if (scoreClose.pitchScore >= 80 && scoreClose.overallScore >= 85) {
  console.log('✅ Passed Test 2 (1-semitone off gets 85-98%)');
} else {
  console.error('❌ Failed Test 2: Expected >= 85%, got', scoreClose.overallScore);
  allPassed = false;
}

// ── Test 3: Moderate Mimic (3 semitones off, 523 Hz / C5) ────────
const playerModerate = makeSine(523, duration);
const featModerate = extractAudioFeatures(playerModerate, sampleRate);
const scoreModerate = computeDTWSimilarity(featTarget, featModerate);
console.log('\nTest 3 (3-semitones off 523Hz vs 440Hz):', scoreModerate);
if (scoreModerate.pitchScore <= 65 && scoreModerate.overallScore <= 85) {
  console.log('✅ Passed Test 3 (3-semitones off pitch is noticeably reduced)');
} else {
  console.error('❌ Failed Test 3: Expected pitch <= 65%, got', scoreModerate);
  allPassed = false;
}

// ── Test 4: Severe Pitch Mismatch (120 Hz Bass vs 850 Hz Squeak) ─
const targetBass = makeSine(120, duration);
const playerSqueak = makeSine(850, duration);
const featBass = extractAudioFeatures(targetBass, sampleRate);
const featSqueak = extractAudioFeatures(playerSqueak, sampleRate);
const scoreMismatchPitch = computeDTWSimilarity(featBass, featSqueak);
console.log('\nTest 4 (Severe Pitch Mismatch 120Hz vs 850Hz):', scoreMismatchPitch);
if (scoreMismatchPitch.overallScore <= 30 && scoreMismatchPitch.pitchScore <= 15) {
  console.log('✅ Passed Test 4 (Severe pitch mismatch gets <= 30%)');
} else {
  console.error('❌ Failed Test 4: Expected <= 30%, got', scoreMismatchPitch.overallScore);
  allPassed = false;
}

// ── Test 5: White Noise / Hiss vs Clear Tone ─────────────────────
const playerNoise = makeNoise(duration);
const featNoise = extractAudioFeatures(playerNoise, sampleRate);
const scoreNoise = computeDTWSimilarity(featTarget, featNoise);
console.log('\nTest 5 (Noise vs 440Hz Tone):', scoreNoise);
if (scoreNoise.overallScore <= 25 && scoreNoise.pitchScore <= 10) {
  console.log('✅ Passed Test 5 (Unvoiced noise vs tone gets <= 25%)');
} else {
  console.error('❌ Failed Test 5: Expected <= 25%, got', scoreNoise.overallScore);
  allPassed = false;
}

// ── Test 6: Rhythmic Mismatch (3 Bursts vs Continuous Tone) ───────
const playerBursts = makeBursts(440, duration);
const featBursts = extractAudioFeatures(playerBursts, sampleRate);
const scoreRhythm = computeDTWSimilarity(featTarget, featBursts);
console.log('\nTest 6 (3 Bursts vs Continuous Tone):', scoreRhythm);
if (scoreRhythm.rhythmScore <= 70 && scoreRhythm.overallScore < 75) {
  console.log('✅ Passed Test 6 (Rhythm mismatch is penalized)');
} else {
  console.error('❌ Failed Test 6: Expected rhythmScore <= 70, got', scoreRhythm);
  allPassed = false;
}

// ── Test 7: Silence / Inaudible Whisper ───────────────────────────
const silentPCM = new Float32Array(Math.floor(sampleRate * duration));
const featSilent = extractAudioFeatures(silentPCM, sampleRate);
const scoreSilent = computeDTWSimilarity(featTarget, featSilent);
console.log('\nTest 7 (Silence vs Target Tone):', scoreSilent);
if (scoreSilent.overallScore <= 10) {
  console.log('✅ Passed Test 7 (Silence gets <= 10%)');
} else {
  console.error('❌ Failed Test 7: Expected <= 10%, got', scoreSilent.overallScore);
  allPassed = false;
}

console.log('\n' + (allPassed ? '🎉 ALL 7 SCORING TESTS PASSED PERFECTLY!' : '❌ SOME TESTS FAILED'));
if (!allPassed) process.exit(1);
