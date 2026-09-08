import React, { useState, useEffect, useRef } from 'react';
import { audioDeviceManager } from '../utils/audioDeviceManager';
import { IconHeadphones, IconMic, IconVolume } from './Icons';

export default function AudioSettingsModal({ isOpen, onClose }) {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [testState, setTestState] = useState('idle'); // 'idle' | 'recording' | 'playing'
  const [testAudioUrl, setTestAudioUrl] = useState(null);

  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    if (!isOpen) {
      cleanupAudioTest();
      return;
    }

    // Load devices and listen for selection changes
    const currentId = audioDeviceManager.getSelectedDeviceId();
    setSelectedDeviceId(currentId);

    audioDeviceManager.enumerateDevices(true).then((devs) => {
      setDevices(devs);
      if (!currentId && devs.length > 0) {
        setSelectedDeviceId(devs[0].deviceId);
      }
    });

    const unsubscribe = audioDeviceManager.subscribe((devId, devs) => {
      setSelectedDeviceId(devId);
      if (devs && devs.length > 0) setDevices(devs);
    });

    startMonitoringLevel(currentId);

    return () => {
      unsubscribe();
      cleanupAudioTest();
    };
  }, [isOpen]);

  const cleanupAudioTest = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }
    setTestState('idle');
    setMicLevel(0);
  };

  const startMonitoringLevel = async (deviceId) => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());

    try {
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      const timeData = new Float32Array(analyser.fftSize);

      const checkLevel = () => {
        analyser.getFloatTimeDomainData(timeData);
        let peak = 0;
        for (let i = 0; i < timeData.length; i++) {
          const abs = Math.abs(timeData[i]);
          if (abs > peak) peak = abs;
        }
        // Perceptually responsive scaling: normal speech (0.05 - 0.4) maps smoothly to 20% - 85%
        const pct = Math.min(100, Math.round(Math.pow(peak, 0.55) * 100));
        setMicLevel(pct);
        animFrameRef.current = requestAnimationFrame(checkLevel);
      };

      animFrameRef.current = requestAnimationFrame(checkLevel);
    } catch (e) {
      console.warn('[AudioSettingsModal] Mic monitoring error:', e);
    }
  };

  const handleDeviceChange = (e) => {
    const newId = e.target.value;
    setSelectedDeviceId(newId);
    audioDeviceManager.setSelectedDeviceId(newId);
    startMonitoringLevel(newId);
  };

  const handleTestRecord = async () => {
    if (testState !== 'idle') return;
    setTestState('recording');
    chunksRef.current = [];

    try {
      const stream = streamRef.current || (await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
      }));

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setTestAudioUrl(url);
        setTestState('playing');

        const audio = new Audio(url);
        audio.onended = () => {
          setTestState('idle');
        };
        audio.play().catch(() => setTestState('idle'));
      };

      mr.start(100);

      // Record for 2.5 seconds then auto-play
      setTimeout(() => {
        if (mr.state === 'recording') mr.stop();
      }, 2500);
    } catch (e) {
      console.error('[AudioSettingsModal] Record test error:', e);
      setTestState('idle');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500, margin: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🎙️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                Audio &amp; Microphone Settings
              </h3>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Universal setting for Voice Chat &amp; Game Recording
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.3rem',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '0.2rem 0.5rem'
            }}
          >
            ✕
          </button>
        </div>

        {/* Headphone Tip */}
        <div style={{
          background: 'rgba(244, 132, 95, 0.1)',
          border: '1px solid rgba(244, 132, 95, 0.3)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          marginBottom: '1.25rem'
        }}>
          <IconHeadphones size={20} color="var(--primary)" />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 600 }}>
            <strong>Pro Tip:</strong> Using headphones prevents room audio feedback and ensures crystal-clear voice chat &amp; sound scoring!
          </span>
        </div>

        {/* Device Selector */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
            Input Microphone Device
          </label>
          <select
            className="input-field"
            value={selectedDeviceId}
            onChange={handleDeviceChange}
            style={{
              width: '100%',
              background: 'var(--bg-card-2)',
              border: '1.5px solid var(--border-color)',
              color: 'var(--text-main)',
              padding: '0.7rem 0.9rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {devices.length === 0 ? (
              <option value="">Default Microphone</option>
            ) : (
              devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Live Mic VU Level Meter */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
            <span>Live Mic Input Level</span>
            <span>{micLevel}%</span>
          </div>
          <div style={{
            height: 12,
            background: 'var(--bg-card-2)',
            borderRadius: 6,
            overflow: 'hidden',
            border: '1.5px solid var(--border-color)'
          }}>
            <div style={{
              height: '100%',
              width: `${micLevel}%`,
              background: micLevel > 75 ? 'var(--accent)' : 'linear-gradient(90deg, #4ade80, #f4845f)',
              transition: 'width 0.08s ease',
              borderRadius: 6
            }} />
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'block' }}>
            Speak into your mic to test if the green bar bounces.
          </span>
        </div>

        {/* Quick Mic Test Button */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.25rem' }}>
          <button
            className="btn btn-secondary"
            onClick={handleTestRecord}
            disabled={testState !== 'idle'}
            style={{ flex: 1, padding: '0.75rem 1rem', fontSize: '0.88rem' }}
          >
            {testState === 'recording' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f43f5e', display: 'inline-block', animation: 'pulseRed 1s infinite' }} />
                Recording (Speak now...)
              </span>
            ) : testState === 'playing' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center' }}>
                <IconVolume size={16} /> Playing back your voice...
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center' }}>
                <IconMic size={16} /> Test Record &amp; Playback (2.5s)
              </span>
            )}
          </button>
        </div>

        {/* Modal footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={onClose} style={{ padding: '0.65rem 1.5rem', fontSize: '0.9rem' }}>
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
}
