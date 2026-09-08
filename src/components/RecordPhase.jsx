import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAudioContext, scoreAudioComparison } from '../utils/audioAnalyzer';
import { bufferToWavBlob } from '../utils/soundLibrary';
import { blobToDataURL, dataURLToBlob, fetchOrDataUrlToBlob, peerManager } from '../utils/peerManager';
import { audioDeviceManager } from '../utils/audioDeviceManager';
import { voiceChatManager } from '../utils/voiceChatManager';
import { PlayerAvatar } from '../utils/avatarUtils';
import WaveformDisplay from './WaveformDisplay';
import PhaseIntroOverlay from './PhaseIntroOverlay';
import ParrotMascot from './ParrotMascot';
import { IconMic, IconVolume, IconSettings, IconCheck, IconClock, IconWaveform, IconSparkles, IconUsers, IconFlame } from './Icons';

const NUM_BARS = 120;
const RECORD_TIME_LIMIT = 30; // 30-second recording phase limit

export default function RecordPhase({ roomState, onSoundComplete, onOpenSettings }) {
  const [phase, setPhase] = useState('IDLE'); // IDLE | COUNTDOWN | RECORDING | PROCESSING | DONE
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [timeLeft, setTimeLeft] = useState(RECORD_TIME_LIMIT);
  const [showIntro, setShowIntro] = useState(true);

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
  const localRecordStartMsRef = useRef(Date.now());
  const hasAutoSubmittedRef = useRef(false);
  const hasAutoAdvancedRef = useRef(false);
  const autoAdvanceTimerRef = useRef(null);

  const testChunksRef = useRef([]);
  const testStreamRef = useRef(null);
  const testAnimRef = useRef(null);

  const recordPhaseStartTime = roomState?.recordPhaseStartTime;
  const currentSoundIndex = roomState?.currentSoundIndex || 0;
  const soundPack = roomState?.soundPack || [];
  const currentSound = soundPack[currentSoundIndex] || soundPack[0];
  const totalSounds = soundPack.length || 5;
  const targetDuration = currentSound?.duration || 5;
  const targetBars = currentSound?.waveformBars || [];

  const isHost = roomState?.isHost;
  const players = roomState?.players || [];
  const myPlayerId = roomState?.myPlayerId;
  const myPlayer = players.find(p => p.id === myPlayerId);
  const hasRecorded = Boolean(myPlayer?.recordings?.[currentSoundIndex]);
  const allReady = players.length > 0 && players.every(p => Boolean(p.recordings?.[currentSoundIndex]));

  // Reset when sound changes
  useEffect(() => {
    setPhase('IDLE');
    setElapsed(0);
    setRecordedBars(null);
    accBarsRef.current = Array(NUM_BARS).fill(null);
    voiceChatManager.setAutoMuted('RECORDING', false);
    setTimeLeft(RECORD_TIME_LIMIT);
    setShowIntro(true);
    localRecordStartMsRef.current = Date.now();
    hasAutoSubmittedRef.current = false;
    hasAutoAdvancedRef.current = false;
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }, [currentSoundIndex]);

  const isMountedRef = useRef(true);

  // Universal mic subscription
  useEffect(() => {
    isMountedRef.current = true;
    const unsub = audioDeviceManager.subscribe((devId, devs) => {
      setSelectedDeviceId(devId);
      if (devs && devs.length) setDevices(devs);
    });
    audioDeviceManager.enumerateDevices().then(devs => {
      setDevices(devs);
      setSelectedDeviceId(audioDeviceManager.getSelectedDeviceId());
    });
    return () => {
      isMountedRef.current = false;
      unsub();
    };
  }, []);

  const stopStream = (streamRef, animRef) => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  };

  useEffect(() => () => {
    isMountedRef.current = false;
    stopStream(micStreamRef, animFrameRef);
    stopStream(testStreamRef, testAnimRef);
    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
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
    // Auto-pause voice chat so mic solely feeds game recording
    voiceChatManager.setAutoMuted('RECORDING', true);

    let analyser;
    try {
      const result = await openMicStream();
      analyser = result.analyser;
    } catch (err) {
      alert('Microphone error: ' + err.message);
      voiceChatManager.setAutoMuted('RECORDING', false);
      setPhase('IDLE');
      return;
    }

    setPhase('COUNTDOWN');
    setCountdown(3);
    setElapsed(0);
    setRecordedBars(null);
    accBarsRef.current = Array(NUM_BARS).fill(null);

    await new Promise(resolve => {
      let c = 3;
      const tick = setInterval(() => {
        if (!isMountedRef.current) {
          clearInterval(tick);
          resolve();
          return;
        }
        c--;
        if (c > 0) {
          setCountdown(c);
        } else {
          clearInterval(tick);
          resolve();
        }
      }, 1000);
    });

    if (!isMountedRef.current) {
      stopStream(micStreamRef, animFrameRef);
      voiceChatManager.setAutoMuted('RECORDING', false);
      return;
    }

    chunksRef.current = [];
    let recorder;
    try {
      recorder = new MediaRecorder(micStreamRef.current);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    } catch (recErr) {
      console.error('[Record] MediaRecorder initialization error:', recErr);
      alert('Failed to initialize audio recorder: ' + recErr.message);
      stopStream(micStreamRef, animFrameRef);
      voiceChatManager.setAutoMuted('RECORDING', false);
      setPhase('IDLE');
      return;
    }

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
        const totalScore = validScores.reduce((a, b) => a + b, 0);
        const averageScore = validScores.length > 0 ? Math.round(totalScore / validScores.length) : 0;
        peerManager.submitPlayerAudioPack(newRecs, {
          totalScore,
          averageScore,
          overallScore: totalScore,
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

  // Fallback auto-submit if 30-second recording timer runs out
  const submitTimeoutFallback = useCallback(() => {
    if (hasRecorded || hasAutoSubmittedRef.current) return;
    hasAutoSubmittedRef.current = true;

    // If recorder is actively recording, stop it so onstop handles scoring
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
      return;
    }

    // Otherwise, create a timeout placeholder entry
    const newRecs = [...(myPlayer?.recordings || [])];
    newRecs[currentSoundIndex] = {
      soundIndex: currentSoundIndex,
      title: currentSound?.title || 'Sound',
      audioDataUrl: null,
      scoreResult: {
        overallScore: 0,
        pitchScore: 0,
        similarityScore: 0,
        rhythmScore: 0,
        timbreScore: 0,
        funnyTitle: "Time Expired"
      }
    };

    const validScores = newRecs.filter(Boolean).map(r => r.scoreResult?.overallScore || 0);
    const totalScore = validScores.reduce((a, b) => a + b, 0);
    const averageScore = validScores.length > 0 ? Math.round(totalScore / validScores.length) : 0;

    peerManager.submitPlayerAudioPack(newRecs, {
      totalScore,
      averageScore,
      overallScore: totalScore,
      soundScores: validScores
    });

    setPhase('DONE');
    voiceChatManager.setAutoMuted('RECORDING', false);
  }, [hasRecorded, myPlayer?.recordings, currentSoundIndex, currentSound?.title]);

  // 30-second recording phase countdown ticker (freezes if paused, begins after 2.4s intro)
  useEffect(() => {
    const checkTimer = () => {
      if (roomState?.isPaused) return;

      const baseStart = recordPhaseStartTime || localRecordStartMsRef.current;
      const effectiveStart = baseStart + 1800; // Account for 1.8s intro animation
      const now = Date.now();
      if (now < effectiveStart) {
        setTimeLeft(RECORD_TIME_LIMIT);
        return;
      }

      const elapsedSec = Math.max(0, (now - effectiveStart) / 1000);
      const remaining = Math.max(0, Math.ceil(RECORD_TIME_LIMIT - elapsedSec));
      setTimeLeft(remaining);

      // If 30 seconds run out and player hasn't recorded yet:
      if (remaining <= 0 && !hasRecorded) {
        submitTimeoutFallback();
      }
    };

    checkTimer();
    const interval = setInterval(checkTimer, 250);
    return () => clearInterval(interval);
  }, [recordPhaseStartTime, roomState?.isPaused, hasRecorded, submitTimeoutFallback]);


  // Host auto-advance automatically when all players have recorded and status is Ready
  useEffect(() => {
    if (!isHost || !allReady || hasAutoAdvancedRef.current) return;

    hasAutoAdvancedRef.current = true;
    autoAdvanceTimerRef.current = setTimeout(() => {
      onSoundComplete();
    }, 1200);

    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, [isHost, allReady, onSoundComplete]);

  // Fallback: auto-advance if 30s recording timer expires
  useEffect(() => {
    if (!isHost || timeLeft > 0 || hasAutoAdvancedRef.current || players.length === 0) return;

    hasAutoAdvancedRef.current = true;
    autoAdvanceTimerRef.current = setTimeout(() => {
      onSoundComplete();
    }, 1500);

    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, [isHost, timeLeft <= 0, players.length, onSoundComplete]);

  const recordingProgress = elapsed / targetDuration;
  const selectedDevice = devices.find(d => d.deviceId === selectedDeviceId);

  const isUrgent = timeLeft <= 5;
  const isWarning = timeLeft <= 10 && !isUrgent;
  const timerBadgeColor = isUrgent
    ? '#dc2626'
    : isWarning
      ? '#b45309'
      : '#c2410c';
  const timerBadgeBg = isUrgent
    ? 'rgba(239, 68, 68, 0.12)'
    : isWarning
      ? 'rgba(245, 158, 11, 0.12)'
      : 'rgba(244, 132, 95, 0.12)';

  return (
    <div className="card arcade-stage-card" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.42rem', padding: '0.75rem 1.1rem' }}>
      {/* ── Top Arcade Header: Mascot + Sound Pill + Title + Voice Booth + 30s Timer ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <ParrotMascot
            mode={phase === 'RECORDING' ? 'RECORD' : phase === 'COUNTDOWN' ? 'COUNTDOWN' : (hasRecorded || phase === 'DONE') ? 'SUCCESS' : 'RECORD'}
            size={44}
          />
          <div style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{
                padding: '0.15rem 0.6rem',
                background: 'rgba(244,132,95,0.14)',
                border: '1.5px solid rgba(244,132,95,0.45)',
                borderRadius: '20px',
                fontSize: '0.7rem',
                color: '#c2410c',
                fontWeight: 800,
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.04em'
              }}>
                SOUND {currentSoundIndex + 1}/{totalSounds}
              </span>
              <h2 style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.3rem',
                fontWeight: 800,
                color: 'var(--text-main)',
                margin: 0,
                lineHeight: 1.15
              }}>
                {currentSound?.title || ''}
              </h2>
            </div>
            <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {phase === 'RECORDING' ? (
                <>
                  <IconFlame size={13} color="#ef4444" />
                  <span>SQUAWK YOUR HEART OUT!</span>
                </>
              ) : hasRecorded ? (
                <>
                  <IconCheck size={13} color="#16a34a" />
                  <span>Mimic locked in! Waiting for crew...</span>
                </>
              ) : (
                <>
                  <IconMic size={13} color="var(--primary)" />
                  <span>Match the purple groove peaks!</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Right Utility Chips: Sleek Mic Pill + Arcade Countdown Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <button
            type="button"
            className="arcade-mic-chip"
            onClick={() => (onOpenSettings ? onOpenSettings() : setShowDevices(v => !v))}
            title="Audio Input Device & Settings"
          >
            <IconMic size={13} color="var(--primary)" />
            <span style={{ maxWidth: 85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedDevice?.label ? selectedDevice.label.split('(')[0]?.trim() : 'Default Mic'}
            </span>
            <IconSettings size={11} color="var(--text-muted)" />
          </button>

          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.92rem',
            fontWeight: 800,
            color: timerBadgeColor,
            background: timerBadgeBg,
            padding: '0.18rem 0.65rem',
            borderRadius: '12px',
            border: `1.5px solid ${timerBadgeColor}`,
            animation: isUrgent ? 'pulse 1s infinite' : 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem'
          }}>
            <IconClock size={13} /> {timeLeft > 0 ? `${timeLeft}s` : "Time's Up!"}
          </span>
        </div>
      </div>

      {/* ── Sleek Progress Indicator ── */}
      <div style={{
        width: '100%',
        height: '4px',
        background: 'rgba(0,0,0,0.06)',
        borderRadius: '2px',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${Math.max(0, Math.min(100, (timeLeft / RECORD_TIME_LIMIT) * 100))}%`,
          height: '100%',
          background: isUrgent
            ? 'linear-gradient(90deg, #dc2626, #ef4444)'
            : 'linear-gradient(90deg, var(--primary), var(--secondary))',
          transition: 'width 0.25s linear'
        }} />
      </div>

      {/* ── Glowing Waveform Stage Box (Compact 75px height) ── */}
      <div className="waveform-stage-box">
        {/* Stage Legend */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.72rem' }}>
            <span style={{ color: '#7c3aed', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <IconWaveform size={12} color="#7c3aed" /> TARGET GROOVE
            </span>
            <span style={{ color: '#e11d48', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <IconMic size={12} color="#e11d48" /> YOUR VOICE
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-main)', fontWeight: 700 }}>
            {targetDuration.toFixed(1)}s Sound
          </span>
        </div>

        <WaveformDisplay
          bars={targetBars}
          recordedBars={recordedBars}
          progress={phase === 'RECORDING' ? recordingProgress : undefined}
          color="#7c3aed"
          recordColor="#e11d48"
          height={75}
        />

        {/* Time ruler & Live Mic Meter */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.15rem' }}>
          <span>0s</span>
          {phase === 'RECORDING' && (
            <span style={{ color: '#e11d48', fontWeight: 800 }}>
              {elapsed.toFixed(1)}s
            </span>
          )}
          <span>{targetDuration.toFixed(1)}s</span>
        </div>

        {/* Thin Live Mic Level */}
        <div className="meter-bar" style={{ height: '4px', marginTop: '0.2rem', marginBottom: 0 }}>
          <div className="meter-fill" style={{ width: `${phase === 'RECORDING' ? micLevel : (testState === 'recording' ? testLevel : 0)}%` }} />
        </div>
      </div>

      {/* ── Phase Interaction Zone: 3D Arcade Tactile Action ── */}
      {phase === 'IDLE' && !hasRecorded && (
        <button
          className="btn-arcade-3d"
          onClick={startCountdownAndRecord}
          style={{ width: '100%', padding: '0.68rem 1.4rem', fontSize: '1.06rem', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
        >
          <IconMic size={19} /> START RECORDING
        </button>
      )}

      {phase === 'COUNTDOWN' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.8rem',
          padding: '0.35rem',
          background: 'rgba(234, 88, 12, 0.1)',
          borderRadius: '14px',
          border: '1.5px solid rgba(234, 88, 12, 0.3)'
        }}>
          <span style={{
            fontSize: '0.85rem',
            color: '#c2410c',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}>
            RECORDING IN
          </span>
          <span
            key={countdown}
            style={{
              fontSize: '2.6rem',
              fontWeight: 900,
              color: '#ea580c',
              lineHeight: 1,
              animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
            }}
          >
            {countdown}
          </span>
        </div>
      )}

      {phase === 'RECORDING' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          padding: '0.35rem',
          background: 'rgba(244, 63, 94, 0.12)',
          border: '1.5px solid rgba(244, 63, 94, 0.35)',
          borderRadius: '14px'
        }}>
          <div style={{ fontSize: '2.1rem', fontWeight: 900, color: '#f43f5e', lineHeight: 1 }}>
            {Math.max(0, targetDuration - elapsed).toFixed(1)}s
          </div>
          <span style={{ color: '#f43f5e', fontWeight: 800, fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f43f5e', boxShadow: '0 0 10px #f43f5e', display: 'inline-block' }} />
            RECORDING — match the groove!
          </span>
        </div>
      )}

      {phase === 'PROCESSING' && (
        <div style={{ color: 'var(--secondary)', fontWeight: 800, padding: '0.45rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center', fontSize: '0.9rem' }}>
          <IconWaveform size={16} /> Scoring your squawk...
        </div>
      )}

      {(phase === 'DONE' || hasRecorded) && (
        <div style={{ padding: '0.45rem 0.8rem', background: 'rgba(34, 197, 94, 0.12)', border: '1.5px solid #22c55e', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ color: '#15803d', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.88rem' }}>
            <IconCheck size={16} color="#15803d" /> Mimic Locked In!
          </strong>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            {players.filter(p => p.recordings?.[currentSoundIndex]).length} / {players.length} ready
          </span>
        </div>
      )}

      {/* ── Arcade Player Readiness Tokens ── */}
      <div style={{
        background: 'rgba(255, 248, 240, 0.65)',
        border: '1.5px solid rgba(232, 221, 208, 0.75)',
        borderRadius: '16px',
        padding: '0.35rem 0.65rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <IconUsers size={12} /> SQUAD STATUS
          </span>
          <span style={{ fontSize: '0.74rem', fontWeight: 800, color: allReady ? '#16a34a' : 'var(--primary)' }}>
            {players.filter(p => p.recordings?.[currentSoundIndex]).length} / {players.length} Ready
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {players.map(p => {
            const hasDone = Boolean(p.recordings?.[currentSoundIndex]);
            const isMe = p.id === myPlayerId;
            return (
              <div
                key={p.id}
                className={`arcade-player-token ${hasDone ? 'ready' : ''}`}
              >
                <PlayerAvatar name={p.name} avatar={p.avatar} size={18} />
                <span style={{ color: 'var(--text-main)' }}>{p.name}{isMe ? ' (you)' : ''}</span>
                {hasDone ? (
                  <span style={{ color: '#16a34a', display: 'inline-flex', alignItems: 'center' }}>
                    <IconCheck size={12} color="#16a34a" />
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}>
                    <IconMic size={12} color="var(--text-muted)" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {allReady && (
        <div style={{
          padding: '0.55rem 1rem',
          background: 'linear-gradient(135deg, #15803d, #16a34a)',
          border: '2px solid #166534',
          borderRadius: 'var(--radius-sm)',
          color: '#ffffff',
          fontWeight: 800,
          fontSize: '0.92rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          boxShadow: '0 4px 16px rgba(22, 163, 74, 0.3)',
          animation: 'popIn 0.3s ease-out'
        }}>
          <IconCheck size={18} color="#ffffff" />
          <span>All mimics recorded! Moving to Review...</span>
        </div>
      )}

      {showIntro && (
        <PhaseIntroOverlay
          type="RECORD_START"
          roundNumber={currentSoundIndex + 1}
          durationMs={1800}
          onComplete={() => setShowIntro(false)}
        />
      )}
    </div>
  );
}
