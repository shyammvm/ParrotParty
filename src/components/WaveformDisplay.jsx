import React, { useRef, useEffect } from 'react';

/**
 * WaveformDisplay — Canvas-based waveform renderer
 *
 * Props:
 *   bars         — Float32Array/Array of 0-1 values (static target waveform)
 *   recordedBars — Array of 0-1 values (live accumulating recording bars, same length as bars)
 *                  Bars that are null/undefined are shown as dim placeholders
 *   liveData     — Uint8Array from AnalyserNode.getByteTimeDomainData() (overlay waveform line)
 *   progress     — 0-1 playback cursor position
 *   color        — target bar fill color   (default purple)
 *   recordColor  — recorded bar fill color (default red)
 *   liveColor    — live line overlay color (default red)
 *   height       — canvas height in px
 */
export default function WaveformDisplay({
  bars,
  recordedBars,
  liveData,
  progress,
  color = '#8b5cf6',
  recordColor = '#f43f5e',
  liveColor = '#f43f5e',
  height = 80,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const mid = H / 2;
    const GAP = 2;

    ctx.clearRect(0, 0, W, H);

    const numBars = (bars && bars.length) || 120;
    const barW = Math.max(1, (W - GAP * (numBars - 1)) / numBars);

    // ── Draw static (target) waveform bars ──
    if (bars && bars.length > 0) {
      for (let i = 0; i < bars.length; i++) {
        const x = i * (barW + GAP);
        const amplitude = Math.max(0.02, bars[i]);
        const barH = amplitude * (H - 8);

        const isBehindCursor = progress != null && x / W <= progress;
        ctx.fillStyle = isBehindCursor ? color : hexWithAlpha(color, 0.3);

        roundRect(ctx, x, mid - barH / 2, barW, barH, 2);
        ctx.fill();
      }
    }

    // ── Draw recorded bars overlay (builds left-to-right) ──
    if (recordedBars && recordedBars.length > 0) {
      for (let i = 0; i < recordedBars.length; i++) {
        const val = recordedBars[i];
        if (val == null) continue; // not yet recorded — skip

        const x = i * (barW + GAP);
        const amplitude = Math.max(0.02, val);
        const barH = amplitude * (H - 8);

        ctx.fillStyle = hexWithAlpha(recordColor, 0.85);
        roundRect(ctx, x, mid - barH / 2, barW, barH, 2);
        ctx.fill();
      }
    }

    // ── Draw live time-domain waveform line ──
    if (liveData && liveData.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = liveColor;
      ctx.lineWidth = 2;
      ctx.shadowColor = liveColor;
      ctx.shadowBlur = 5;

      const sliceW = W / liveData.length;
      for (let i = 0; i < liveData.length; i++) {
        const v = (liveData[i] / 128.0) - 1.0;
        const y = mid + v * (H / 2 - 4);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceW, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Draw playback cursor line ──
    if (progress != null && progress > 0 && progress < 1) {
      const cx = progress * W;
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [bars, recordedBars, liveData, progress, color, recordColor, liveColor, height]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={height}
      style={{ width: '100%', height: `${height}px`, display: 'block', borderRadius: '8px' }}
    />
  );
}

// ── Helpers ──

function hexWithAlpha(hex, alpha) {
  if (hex.startsWith('rgba')) return hex;
  if (hex.startsWith('rgb')) return hex.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  if (h < r * 2) r = Math.max(0, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Downsample a Float32Array PCM buffer to N amplitude bars (0-1, normalized)
 */
export function extractWaveformBars(pcm, numBars = 120) {
  if (!pcm || pcm.length === 0) return new Array(numBars).fill(0.02);
  const samplesPerBar = Math.floor(pcm.length / numBars);
  const bars = [];
  for (let i = 0; i < numBars; i++) {
    let peak = 0;
    const start = i * samplesPerBar;
    for (let j = start; j < start + samplesPerBar && j < pcm.length; j++) {
      const abs = Math.abs(pcm[j]);
      if (abs > peak) peak = abs;
    }
    bars.push(peak);
  }
  const max = Math.max(...bars, 0.001);
  return bars.map(b => b / max);
}
