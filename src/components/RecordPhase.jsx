import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAudioContext, scoreAudioComparison } from '../utils/audioAnalyzer';
import { bufferToWavBlob } from '../utils/soundLibrary';
import { blobToDataURL, dataURLToBlob, fetchOrDataUrlToBlob, peerManager } from '../utils/peerManager';
import { audioDeviceManager } from '../utils/audioDeviceManager';
import { voiceChatManager } from '../utils/voiceChatManager';
import { PlayerAvatar } from '../utils/avatarUtils';
import WaveformDisplay from './WaveformDisplay';

const NUM_BARS = 120;

export default function RecordPhase({ roomState, onSoundComplete, onOpenSettings }) {
  const [phase, setPhase] = useState('IDLE'); // IDLE | COUNTDOWN | RECORDING | PROCESSING | DONE
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [micLevel, setMicLevel] = useState(0);

  // Live waveform accumulation
  const [recordedBars, setRecordedBars] = useState(null); // Array(NUM_BARS) of null | 0-1

  // Universal Mic selection
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => audioDeviceManager.getSelectedDeviceId());
  const [showDevices, setShowDevices] = useState(false);
  const [testState, setTestState] = useState('idle');
  const [testLevel, setTestLevel] = useState(0);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const micStreamRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const recordingStartMsRef = useRef(0);
  const accBarsRef = useRef(Array(NUM_BARS).fill(null)); // accumulator

  const testChunksRef = useRef([]);
  const testStreamRef = useRef(null);
  const testAnimRef = useRef(null);

  const currentSoundIndex = roomState?.currentSoundIndex || 0;
  const soundPack = roomState?.soundPack || [];
  const currentSound = soundPack[currentSoundIndex] || soundPack[0];
  const totalSounds = soundPack.length || 5;
  const targetDuration = currentSound?.duration || 5;
  const targetBars = currentSound?.waveformBars || [];

  const isHost = roomState?.isHost;
  const players = roomState?.players || [];
  const myPlayer = players.find(p => p.id === roomState?.myPlayerId);
  const hasRecorded = Boolean(myPlayer?.recordings?.[currentSoundIndex]);
  const allReady = players.every(p => Boolean(p.recordings?.[currentSoundIndex]));

  // Reset when sound changes
  useEffect(() => {
    setPhase('IDLE');
    setElapsed(0);
    setRecordedBars(null);
    accBarsRef.current = Array(NUM_BARS).fill(null);
    voiceChatManager.setAutoMuted('RECORDING', false);
  }, [currentSoundIndex]);

  // Universal mic subscription
  useEffect(() => {
    const unsub = audioDeviceManager.subscribe((devId, devs) => {
      setSelectedDeviceId(devId);
      if (devs && devs.length) setDevices(devs);
    });
    audioDeviceManager.enumerateDevices().then(devs => {
      setDevices(devs);
      setSelectedDeviceId(audioDeviceManager.getSelectedDeviceId());
    });
    return () => unsub();
  }, []);

  const stopStream = (streamRef, animRef) => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  };

  useEffect(() => () => {
    stopStream(micStreamRef, animFrameRef);
    stopStream(testStreamRef, testAnimRef);
    voiceChatManager.setAutoMuted('RECORDING', false);
  }, []);

  // ── Live analyser animation loop — accumulates bars + mic level ──
  const startAnalyserLoop = useCallback((analyser, startMs, duration) => {
    analyserRef.current = analyser;
    analyser.fftSize = 512;
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Float32Array(analyser.fftSize);
    accBarsRef.current = Array(NUM_BARS).fill(null);

    const loop = () => {
      const elapsedSec = (Date.now() - startMs) / 1000;
      if (elapsedSec > duration + 0.1) return;

      // Mic level from frequency data
      analyser.getByteFrequencyData(freqData);
      const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length;
      setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));

      // Accumulate amplitude into the correct bar slot
      analyser.getFloatTimeDomainData(timeData);
      let peak = 0;
      for (let i = 0; i < timeData.length; i++) {
        const abs = Math.abs(timeData[i]);
        if (abs > peak) peak = abs;
      }

      const barIdx = Math.min(NUM_BARS - 1, Math.floor((elapsedSec / duration) * NUM_BARS));
      // Keep the max peak for each bar slot (smoothing)
      if (accBarsRef.current[barIdx] == null || peak > accBarsRef.current[barIdx]) {
        accBarsRef.current[barIdx] = peak;
      }

      // Trigger a React state update every ~3 frames for performance
      setRecordedBars([...accBarsRef.current]);

      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
  }, []);

  const openMicStream = async () => {
    const audioCtx = getAudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const stream = await audioDeviceManager.getUniversalAudioStream();
    micStreamRef.current = stream;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    source.connect(analyser);
    return { stream, analyser };
  };

  // ── MIC TEST ──
  const handleMicTest = async () => {
    setTestState('recording');
    testChunksRef.current = [];
    try {
      const audioCtx = getAudioContext();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const stream = await audioDeviceManager.getUniversalAudioStream();
      testStreamRef.current = stream;
      const src = audioCtx.createMediaStreamSource(stream);
      const an = audioCtx.createAnalyser(); an.fftSize = 256;
      src.connect(an);
      const fd = new Uint8Array(an.frequencyBinCount);
      const meter = () => {
        an.getByteFrequencyData(fd);
        setTestLevel(Math.min(100, Math.round((fd.reduce((a, b) => a + b, 0) / fd.length / 128) * 100)));
        testAnimRef.current = requestAnimationFrame(meter);
      };
      meter();
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = e => { if (e.data.size > 0) testChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stopStream(testStreamRef, testAnimRef);
        setTestLevel(0); setTestState('playing');
        const raw = new Blob(testChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        try {
          const ab = await raw.arrayBuffer();
          const buf = await audioCtx.decodeAudioData(ab);
          const s = audioCtx.createBufferSource(); s.buffer = buf;
          s.connect(audioCtx.destination);
          s.onended = () => setTestState('done'); s.start(0);
        } catch { setTestState('done'); alert('Test failed — try another mic.'); }
      };
      rec.start();
      setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 2000);
    } catch (e) { setTestState('idle'); alert('Mic test failed: ' + e.message); }
  };

  // ── MAIN COUNTDOWN → RECORD ──
  const startCountdownAndRecord = async () => {
    setPhase('COUNTDOWN');
    setCountdown(3);
    setElapsed(0);
    setRecordedBars(null);
    accBarsRef.current = Array(NUM_BARS).fill(null);

    // Auto-pause voice chat so mic solely feeds game recording
    voiceChatManager.setAutoMuted('RECORDING', true);

    await new Promise(resolve => {
      let c = 3;
      const tick = setInterval(() => {
        c--;
        if (c > 0) setCountdown(c);
        else { clearInterval(tick); resolve(); }
      }, 1000);
    });

    let analyser;
    try {
      const result = await openMicStream();
      analyser = result.analyser;
    } catch (err) {
      alert('Microphone error: ' + err.message);
      voiceChatManager.setAutoMuted('RECORDING', false);
      setPhase('IDLE'); return;
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(micStreamRef.current);
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };

    recorder.onstop = async () => {
      stopStream(micStreamRef, animFrameRef);
      setMicLevel(0);
      setPhase('PROCESSING');
      // Recording finished: resume voice chat immediately!
      voiceChatManager.setAutoMuted('RECORDING', false);

      // Normalize the recorded bars before finalizing
      const finalBars = [...accBarsRef.current];
      const maxVal = Math.max(...finalBars.filter(v => v != null), 0.001);
      const normalizedBars = finalBars.map(v => v == null ? 0 : v / maxVal);
      setRecordedBars(normalizedBars);

      const audioCtx = getAudioContext();
      const raw = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      let scoreBlob = raw;
      try {
        const ab = await raw.arrayBuffer();
        const buf = await audioCtx.decodeAudioData(ab);
        scoreBlob = bufferToWavBlob(buf);
      } catch (e) {
        console.warn('[Record] WAV decoding fallback:', e);
      }

      try {
        const targetBlob = await fetchOrDataUrlToBlob(currentSound.targetAudioUrl || currentSound.soundUrl);
        const score = await scoreAudioComparison(targetBlob, scoreBlob);
        // Use compressed native blob for network transmission (10x smaller than WAV)
        const audioDataUrl = await blobToDataURL(raw);
        const newRecs = [...(myPlayer?.recordings || [])];
        newRecs[currentSoundIndex] = {
          soundIndex: currentSoundIndex,
          title: currentSound.title,
          audioDataUrl,
          scoreResult: score
        };
        const validScores = newRecs.filter(Boolean).map(r => r.scoreResult?.overallScore || 0);
        peerManager.submitPlayerAudioPack(newRecs, {
          overallScore: Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length),
          soundScores: validScores
        });
        setPhase('DONE');
      } catch (e) {
        console.error('[Record] Scoring failed:', e);
        voiceChatManager.setAutoMuted('RECORDING', false);
        setPhase('IDLE');
      }
    };

    setPhase('RECORDING');
    recorder.start(100);
    const startMs = Date.now();
    recordingStartMsRef.current = startMs;
    startAnalyserLoop(analyser, startMs, targetDuration);

    // Elapsed ticker
    const elapsedInterval = setInterval(() => {
      const t = (Date.now() - startMs) / 1000;
      setElapsed(Math.min(t, targetDuration));
      if (t >= targetDuration) clearInterval(elapsedInterval);
    }, 50);

    setTimeout(() => {
      clearInterval(elapsedInterval);
      setElapsed(targetDuration);
      if (recorder.state !== 'inactive') recorder.stop();
    }, targetDuration * 1000);
  };

  // Host auto-advance
  useEffect(() => {
    if (isHost && allReady && players.length > 0) {
      setTimeout(() => onSoundComplete(), 1200);
    }
  }, [isHost, allReady]);

  const recordingProgress = elapsed / targetDuration;
  const selectedDevice = devices.find(d => d.deviceId === selectedDeviceId);

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{
        display: 'inline-block', padding: '0.3rem 0.8rem',
        background: 'rgba(139,92,246,0.2)', border: '1px solid var(--primary)',
        borderRadius: '12px', fontSize: '0.85rem', color: 'var(--secondary)',
        fontWeight: 700, marginBottom: '0.75rem'
      }}>
        SOUND {currentSoundIndex + 1} OF {totalSounds}: {currentSound?.title}
      </div>

      <div className="card-title" style={{ justifyContent: 'center' }}>🎙️ Record Your Mimic!</div>
      <p className="card-subtitle">Try to match the purple waveform peaks with your voice!</p>

      {/* ── Combined waveform comparison ── */}
      <div style={{
        background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border-color)',
        borderRadius: '12px', padding: '1rem', marginBottom: '1rem'
      }}>
        {/* Legend */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem' }}>
            <span style={{ color: '#8b5cf6', fontWeight: 700 }}>■ TARGET</span>
            <span style={{ color: '#f43f5e', fontWeight: 700 }}>■ YOUR VOICE</span>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{targetDuration.toFixed(1)}s</span>
        </div>

        {/* Single overlaid canvas: target (purple) + recording (red) */}
        <WaveformDisplay
          bars={targetBars}
          recordedBars={recordedBars}
          progress={phase === 'RECORDING' ? recordingProgress : undefined}
          color="#8b5cf6"
          recordColor="#f43f5e"
          height={110}
        />

        {/* Time ruler */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
          <span>0s</span>
          {phase === 'RECORDING' && (
            <span style={{ color: '#f43f5e', fontWeight: 700 }}>
              {elapsed.toFixed(1)}s
            </span>
          )}
          <span>{targetDuration.toFixed(1)}s</span>
        </div>
      </div>

      {/* ── Mic level ── */}
      <div className="meter-bar" style={{ marginBottom: '0.75rem' }}>
        <div className="meter-fill" style={{ width: `${phase === 'RECORDING' ? micLevel : (testState === 'recording' ? testLevel : 0)}%` }} />
      </div>

      {/* ── Mic selector ── */}
      <div style={{
        background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-sm)', padding: '0.55rem 0.9rem',
        marginBottom: '1rem', textAlign: 'left'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            🎤 <strong style={{ color: '#fff' }}>{selectedDevice?.label || 'Default Mic'}</strong>
          </span>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button className="btn btn-secondary"
              onClick={handleMicTest}
              disabled={testState === 'recording' || testState === 'playing' || phase !== 'IDLE'}
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}>
              {testState === 'recording' ? '🔴 2s...' : testState === 'playing' ? '🔊...' : '🧪 Test'}
            </button>
            <button className="btn btn-secondary"
              onClick={() => (onOpenSettings ? onOpenSettings() : setShowDevices(v => !v))}
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}>
              ⚙️ Mic Settings
            </button>
          </div>
        </div>
        {testState === 'done' && (
          <p style={{ fontSize: '0.72rem', color: 'var(--success)', marginTop: '0.3rem' }}>
            ✅ Did you hear yourself? If not, tap ⚙️ to change mic.
          </p>
        )}
        {showDevices && devices.length > 0 && (
          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {devices.map(d => (
              <button key={d.deviceId}
                className={`btn ${d.deviceId === selectedDeviceId ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  audioDeviceManager.setSelectedDeviceId(d.deviceId);
                  setSelectedDeviceId(d.deviceId);
                  setShowDevices(false);
                  setTestState('idle');
                }}
                style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem', textAlign: 'left' }}>
                {d.deviceId === selectedDeviceId ? '✅ ' : ''}{d.label || `Mic ${d.deviceId.slice(0, 8)}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Phase UI ── */}
      {phase === 'IDLE' && !hasRecorded && (
        <button className="btn btn-accent" onClick={startCountdownAndRecord}
          style={{ width: '100%', padding: '1rem', fontSize: '1.15rem' }}>
          🎙️ Start Recording
        </button>
      )}

      {phase === 'COUNTDOWN' && (
        <div style={{ fontSize: '5rem', fontWeight: 900, color: 'var(--accent)', lineHeight: 1 }}>
          {countdown}
        </div>
      )}

      {phase === 'RECORDING' && (
        <div>
          <div style={{ fontSize: '3rem', fontWeight: 900, color: '#f43f5e', lineHeight: 1 }}>
            {Math.max(0, targetDuration - elapsed).toFixed(1)}s
          </div>
          <p style={{ color: '#f43f5e', fontWeight: 700, marginTop: '0.25rem' }}>
            🔴 RECORDING — match the purple peaks!
          </p>
        </div>
      )}

      {phase === 'PROCESSING' && (
        <div style={{ color: 'var(--secondary)', fontWeight: 700, padding: '1rem' }}>
          ⚡ Scoring your recording...
        </div>
      )}

      {(phase === 'DONE' || hasRecorded) && (
        <div style={{ padding: '1rem', background: 'rgba(16,185,129,0.1)', border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)' }}>
          <strong style={{ color: 'var(--success)' }}>✅ Submitted!</strong>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {players.filter(p => p.recordings?.[currentSoundIndex]).length} / {players.length} ready
          </p>
        </div>
      )}

      <div style={{ marginTop: '1.25rem', textAlign: 'left' }}>
        <div className="player-list">
          {players.map(p => (
            <div key={p.id} className="player-item">
              <div className="player-info">
                <PlayerAvatar name={p.name} avatar={p.avatar} size={28} />
                <span>{p.name}</span>
              </div>
              {p.recordings?.[currentSoundIndex]
                ? <span className="badge-ready">✅ Ready</span>
                : <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>⏳ Recording...</span>}
            </div>
          ))}
        </div>
      </div>

      {isHost && allReady && (
        <button className="btn btn-primary" onClick={onSoundComplete}
          style={{ width: '100%', marginTop: '1rem', padding: '0.8rem' }}>
          ✨ Reveal Recordings for Sound {currentSoundIndex + 1}!
        </button>
      )}
    </div>
  );
}
