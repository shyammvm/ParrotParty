/**
 * Procedural Web Audio API Sound Effects Synthesizer
 * Generates responsive cartoon sound effects with 0ms latency and 0 external audio assets:
 * - Egg throw whoosh
 * - Egg squishy splat
 * - High-score celebratory fanfare & party poppers
 */

import { getAudioContext } from './audioAnalyzer';

/**
 * Play a cartoon whoosh sound for thrown eggs
 */
export function playEggWhoosh() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    // Frequency drops slightly then rises as it whips through air
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.28);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, now);
    filter.Q.setValueAtTime(3, now);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {
    console.debug('[SFX] Whoosh audio suppressed:', e);
  }
}

/**
 * Play a wet, hilarious egg splat / squish sound
 */
export function playEggSplat() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // 1. Wet squish noise burst
    const bufferSize = Math.floor(ctx.sampleRate * 0.22);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(1200, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(200, now + 0.18);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.005, now + 0.2);

    whiteNoise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    whiteNoise.start(now);

    // 2. Heavy squishy "thud/plop" oscillator
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.16);

    oscGain.gain.setValueAtTime(0.4, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
  } catch (e) {
    console.debug('[SFX] Splat audio suppressed:', e);
  }
}

/**
 * Play a sparkling victory fanfare arpeggio and party pop for 75+ points
 */
export function playVictoryFanfare() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // Major celebratory chord arpeggio: C5, E5, G5, C6
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const noteTime = now + idx * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.01, noteTime);
      gain.gain.linearRampToValueAtTime(0.2, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.48);
    });

    // Party Popper "POP!" at the climax
    const popTime = now + 0.28;
    const popOsc = ctx.createOscillator();
    const popGain = ctx.createGain();

    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(800, popTime);
    popOsc.frequency.exponentialRampToValueAtTime(180, popTime + 0.08);

    popGain.gain.setValueAtTime(0.25, popTime);
    popGain.gain.exponentialRampToValueAtTime(0.001, popTime + 0.1);

    popOsc.connect(popGain);
    popGain.connect(ctx.destination);

    popOsc.start(popTime);
    popOsc.stop(popTime + 0.12);
  } catch (e) {
    console.debug('[SFX] Fanfare audio suppressed:', e);
  }
}
