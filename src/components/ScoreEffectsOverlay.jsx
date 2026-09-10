import React, { useState, useEffect, useRef, useCallback } from 'react';
import { playEggWhoosh, playEggSplat, playVictoryFanfare } from '../utils/sfxSynthesizer';

// Comic badges for low score & high score
const LOW_SCORE_POPUPS = [
  '💥 SPLAT!',
  '🥚 ROTTEN!',
  '👎 BOOOO!',
  '🤪 SQUISH!',
  '💀 YIKES!',
  '🤡 EGG-CELLENT FLOP!'
];

const HIGH_SCORE_POPUPS = [
  '🌟 SUPERSTAR!',
  '🔥 FLAWLESS!',
  '🎤 MIC DROP!',
  '👑 GODLIKE!',
  '🏆 CHAMPION!',
  '⚡ UNSTOPPABLE!'
];

const HIGH_SCORE_EMOJIS = ['👑', '🏆', '💎', '🎉', '🔥', '⭐', '🥳'];

export default function ScoreEffectsOverlay({
  score = 0,
  isActive = false,
  containerRef,
  onExternalTriggerRef
}) {
  const [flyingEggs, setFlyingEggs] = useState([]); // [{ id, startX, startY, targetX, targetY, angle }]
  const [splats, setSplats] = useState([]); // [{ id, x, y, size, rotation, popupText, drips: [...] }]
  const [celebrationBadges, setCelebrationBadges] = useState([]); // [{ id, text, x, y, scale }]
  const [floatingTrophies, setFloatingTrophies] = useState([]); // [{ id, emoji, left, delay, duration }]
  const [isGoldenGlowActive, setIsGoldenGlowActive] = useState(false);

  const canvasRef = useRef(null);
  const confettiParticlesRef = useRef([]);
  const animFrameRef = useRef(null);
  const eggIdCounter = useRef(0);
  const splatIdCounter = useRef(0);

  // ── CONFETTI ENGINE (Canvas Based) ─────────────────────────────────
  const launchConfettiBurst = useCallback((originXRatio = 0.5, originYRatio = 0.5, count = 75) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const originX = rect.width * originXRatio;
    const originY = rect.height * originYRatio;

    const colors = [
      '#f4845f', '#f59e0b', '#6c63ff', '#10b981', '#ec4899',
      '#06b6d4', '#facc15', '#ffffff', '#a855f7'
    ];

    const newParticles = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 4 + Math.random() * 9;
      newParticles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (Math.random() * 5 + 3), // Initial upward bias
        size: 5 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        wobble: Math.random() * 10,
        wobbleSpeed: 0.1 + Math.random() * 0.1,
        life: 1.0,
        decay: 0.007 + Math.random() * 0.008,
        shape: Math.random() > 0.35 ? 'rect' : 'circle'
      });
    }

    confettiParticlesRef.current = [...confettiParticlesRef.current, ...newParticles];
  }, []);

  // Run confetti rendering loop
  useEffect(() => {
    let active = true;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        if (active) animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const particles = confettiParticlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Physics update
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.22; // Gravity
        p.vx *= 0.985; // Air drag
        p.wobble += p.wobbleSpeed;
        p.rotation += p.rotationSpeed;
        p.life -= p.decay;

        if (p.life <= 0 || p.y > canvas.height + 50) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          const width = p.size * Math.cos(p.wobble);
          ctx.fillRect(-width / 2, -p.size / 2, width, p.size);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      if (active) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas && canvas.parentElement) {
        canvas.width = canvas.parentElement.clientWidth || window.innerWidth;
        canvas.height = canvas.parentElement.clientHeight || window.innerHeight;
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // ── EGG THROWING ENGINE ─────────────────────────────────────────────
  const throwSingleEgg = useCallback((explicitTarget = null) => {
    const parent = containerRef?.current || document.body;
    const rect = parent.getBoundingClientRect();

    // Randomize start position along bottom edge
    const startX = rect.width * (0.15 + Math.random() * 0.7);
    const startY = rect.height + 40;

    // Target around center card or custom target
    let targetX = rect.width * 0.5 + (Math.random() - 0.5) * (rect.width * 0.4);
    let targetY = rect.height * 0.45 + (Math.random() - 0.5) * (rect.height * 0.25);

    if (explicitTarget) {
      targetX = explicitTarget.x;
      targetY = explicitTarget.y;
    }

    const eggId = `egg-${Date.now()}-${++eggIdCounter.current}`;
    const dx = targetX - startX;
    const dy = targetY - startY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;

    playEggWhoosh();

    // Register flying egg
    setFlyingEggs(prev => [
      ...prev,
      { id: eggId, startX, startY, targetX, targetY, angle }
    ]);

    // When egg completes flight (~480ms), trigger splat!
    setTimeout(() => {
      setFlyingEggs(prev => prev.filter(e => e.id !== eggId));
      playEggSplat();

      // Spawn Splat Decal
      const splatId = `splat-${Date.now()}-${++splatIdCounter.current}`;
      const randomPopup = LOW_SCORE_POPUPS[Math.floor(Math.random() * LOW_SCORE_POPUPS.length)];
      const rotation = Math.floor(Math.random() * 360);
      const size = 65 + Math.random() * 35; // 65px - 100px wide splat

      // Generate 2-3 randomized dripping yolk streaks
      const drips = [
        { left: 35 + Math.random() * 10, length: 25 + Math.random() * 40, width: 6 + Math.random() * 4, delay: 0.1 },
        { left: 55 + Math.random() * 15, length: 35 + Math.random() * 50, width: 7 + Math.random() * 5, delay: 0.25 }
      ];

      setSplats(prev => [
        ...prev.slice(-8), // Keep max 8 active splats on screen
        {
          id: splatId,
          x: targetX,
          y: targetY,
          size,
          rotation,
          popupText: randomPopup,
          drips
        }
      ]);

      // Remove splat after 4.5 seconds
      setTimeout(() => {
        setSplats(prev => prev.filter(s => s.id !== splatId));
      }, 4500);
    }, 460);
  }, [containerRef]);

  // Expose methods to parent via ref or callbacks if provided
  useEffect(() => {
    if (onExternalTriggerRef) {
      onExternalTriggerRef.current = {
        throwEgg: (pos) => throwSingleEgg(pos),
        popConfetti: () => {
          playVictoryFanfare();
          launchConfettiBurst(0.2, 0.7, 50);
          launchConfettiBurst(0.8, 0.7, 50);
          launchConfettiBurst(0.5, 0.4, 60);
        }
      };
    }
  }, [throwSingleEgg, launchConfettiBurst, onExternalTriggerRef]);

  // ── AUTOMATIC SEQUENCE ON SCORE REVEAL ──────────────────────────────
  useEffect(() => {
    if (!isActive) {
      setIsGoldenGlowActive(false);
      return;
    }

    let timeouts = [];

    if (score < 25) {
      // 🥚 LOW SCORE: Automatic Egg Salvo!
      // Stagger 4-5 eggs flying towards the card
      const eggDelays = [200, 600, 1100, 1600, 2200];
      eggDelays.forEach(delay => {
        timeouts.push(setTimeout(() => {
          throwSingleEgg();
        }, delay));
      });
    } else if (score >= 75) {
      // 🎉 HIGH SCORE: Super Celebration!
      setIsGoldenGlowActive(true);
      playVictoryFanfare();

      // Launch multi-stage confetti blasts from both sides and center
      timeouts.push(setTimeout(() => launchConfettiBurst(0.15, 0.85, 60), 100));
      timeouts.push(setTimeout(() => launchConfettiBurst(0.85, 0.85, 60), 250));
      timeouts.push(setTimeout(() => launchConfettiBurst(0.5, 0.45, 80), 600));
      timeouts.push(setTimeout(() => launchConfettiBurst(0.3, 0.65, 50), 1200));
      timeouts.push(setTimeout(() => launchConfettiBurst(0.7, 0.65, 50), 1500));

      // Spawn floating trophies & crowns
      const trophies = Array.from({ length: 14 }).map((_, i) => ({
        id: `trophy-${Date.now()}-${i}`,
        emoji: HIGH_SCORE_EMOJIS[Math.floor(Math.random() * HIGH_SCORE_EMOJIS.length)],
        left: 5 + Math.random() * 90,
        delay: Math.random() * 1.5,
        duration: 2.5 + Math.random() * 1.8,
        size: 1.6 + Math.random() * 1.2
      }));
      setFloatingTrophies(trophies);

      // Spawn celebratory comic badges
      const badge1 = HIGH_SCORE_POPUPS[Math.floor(Math.random() * HIGH_SCORE_POPUPS.length)];
      const badge2 = HIGH_SCORE_POPUPS[Math.floor(Math.random() * HIGH_SCORE_POPUPS.length)];

      timeouts.push(setTimeout(() => {
        setCelebrationBadges([
          { id: `badge-1`, text: badge1, x: 50, y: 28 }
        ]);
      }, 500));

      timeouts.push(setTimeout(() => {
        setCelebrationBadges(prev => [
          ...prev,
          { id: `badge-2`, text: badge2, x: 50, y: 72 }
        ]);
      }, 1300));
    }

    return () => {
      timeouts.forEach(t => clearTimeout(t));
    };
  }, [isActive, score, throwSingleEgg, launchConfettiBurst]);

  return (
    <div
      className={`score-effects-overlay ${isGoldenGlowActive ? 'golden-celebration-active' : ''}`}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 50,
        borderRadius: 'inherit'
      }}
    >
      {/* Canvas for Confetti */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1
        }}
      />

      {/* ── FLYING EGGS ──────────────────────────────────────────────── */}
      {flyingEggs.map(egg => (
        <div
          key={egg.id}
          className="flying-egg-projectile"
          style={{
            position: 'absolute',
            left: egg.startX,
            top: egg.startY,
            '--target-x': `${egg.targetX - egg.startX}px`,
            '--target-y': `${egg.targetY - egg.startY}px`,
            '--egg-angle': `${egg.angle}deg`,
            zIndex: 60
          }}
        >
          {/* Detailed Egg SVG graphic */}
          <svg width="34" height="42" viewBox="0 0 34 42" className="egg-shell-graphic">
            <defs>
              <linearGradient id="eggGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fffcf2" />
                <stop offset="50%" stopColor="#faecd0" />
                <stop offset="100%" stopColor="#ecd4ab" />
              </linearGradient>
              <filter id="eggShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="1" dy="3" stdDeviation="2" floodOpacity="0.35" />
              </filter>
            </defs>
            {/* Egg oval */}
            <path
              d="M 17 2 C 7 2 2 15 2 28 C 2 36 8 41 17 41 C 26 41 32 36 32 28 C 32 15 27 2 17 2 Z"
              fill="url(#eggGrad)"
              filter="url(#eggShadow)"
              stroke="#dec093"
              strokeWidth="1"
            />
            {/* Glossy light reflection */}
            <path
              d="M 11 9 C 14 6 19 6 21 8"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              fill="none"
              opacity="0.85"
            />
          </svg>
        </div>
      ))}

      {/* ── EGG SPLATS & DRIPS ───────────────────────────────────────── */}
      {splats.map(splat => (
        <div
          key={splat.id}
          className="egg-splat-container"
          style={{
            position: 'absolute',
            left: splat.x,
            top: splat.y,
            transform: 'translate(-50%, -50%)',
            zIndex: 55
          }}
        >
          {/* Splat SVG Graphic with viscous yolk and albumen puddle */}
          <div
            className="egg-splat-graphic"
            style={{
              width: splat.size,
              height: splat.size,
              transform: `rotate(${splat.rotation}deg)`
            }}
          >
            <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ overflow: 'visible' }}>
              <defs>
                {/* Yolk 3D gradient */}
                <radialGradient id={`yolkGrad-${splat.id}`} cx="35%" cy="35%" r="65%">
                  <stop offset="0%" stopColor="#ffea75" />
                  <stop offset="45%" stopColor="#ffb300" />
                  <stop offset="90%" stopColor="#e65100" />
                </radialGradient>
                {/* Albumen translucent gradient */}
                <radialGradient id={`albumenGrad-${splat.id}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(255, 255, 255, 0.95)" />
                  <stop offset="70%" stopColor="rgba(255, 250, 230, 0.85)" />
                  <stop offset="100%" stopColor="rgba(240, 235, 210, 0.4)" />
                </radialGradient>
                <filter id={`splatShadow-${splat.id}`} x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="2" dy="4" stdDeviation="3" floodOpacity="0.25" />
                </filter>
              </defs>

              {/* White albumen splatter shape */}
              <path
                d="M 50 15 C 65 8 82 22 80 40 C 95 45 98 68 85 80 C 72 95 45 98 32 88 C 15 95 5 75 12 55 C 5 40 22 20 38 25 C 42 12 48 10 50 15 Z"
                fill={`url(#albumenGrad-${splat.id})`}
                filter={`url(#splatShadow-${splat.id})`}
              />

              {/* Scattered droplet splatters */}
              <circle cx="8" cy="22" r="3.5" fill="rgba(255,255,255,0.85)" />
              <circle cx="92" cy="30" r="4.5" fill="rgba(255,255,255,0.85)" />
              <circle cx="88" cy="85" r="4" fill="rgba(255,245,210,0.85)" />
              <circle cx="15" cy="82" r="3.5" fill="rgba(255,245,210,0.85)" />
              <circle cx="48" cy="98" r="3" fill="#ffb300" />

              {/* Broken egg shell fragments */}
              <path
                d="M 24 32 L 28 26 L 33 33 L 30 38 Z"
                fill="#faecd0"
                stroke="#d4b483"
                strokeWidth="0.8"
              />
              <path
                d="M 72 68 L 78 62 L 81 70 L 75 74 Z"
                fill="#faecd0"
                stroke="#d4b483"
                strokeWidth="0.8"
              />

              {/* Rich yellow runny yolk */}
              <circle
                cx="50"
                cy="52"
                r="22"
                fill={`url(#yolkGrad-${splat.id})`}
                filter={`url(#splatShadow-${splat.id})`}
              />

              {/* Yolk gloss reflection */}
              <ellipse
                cx="42"
                cy="44"
                rx="6"
                ry="4"
                transform="rotate(-25 42 44)"
                fill="#ffffff"
                opacity="0.8"
              />
            </svg>

            {/* Realistic dripping yolk streams sliding down */}
            {splat.drips.map((drip, i) => (
              <div
                key={i}
                className="yolk-drip-stream"
                style={{
                  position: 'absolute',
                  left: `${drip.left}%`,
                  top: '60%',
                  width: `${drip.width}px`,
                  '--drip-length': `${drip.length}px`,
                  animationDelay: `${drip.delay}s`
                }}
              />
            ))}
          </div>

          {/* Comic text popup banner ("SPLAT!", "BOOO!") */}
          <div className="splat-comic-bubble">
            {splat.popupText}
          </div>
        </div>
      ))}

      {/* ── HIGH SCORE CELEBRATION ELEMENTS ───────────────────────────── */}
      {/* Floating Emojis (Trophies, Crowns, Diamonds) */}
      {floatingTrophies.map(item => (
        <div
          key={item.id}
          className="floating-celebration-item"
          style={{
            position: 'absolute',
            bottom: '-10%',
            left: `${item.left}%`,
            fontSize: `${item.size}rem`,
            animationDelay: `${item.delay}s`,
            animationDuration: `${item.duration}s`
          }}
        >
          {item.emoji}
        </div>
      ))}

      {/* Triumphant Comic Badges ("SUPERSTAR!", "MIC DROP!") */}
      {celebrationBadges.map(badge => (
        <div
          key={badge.id}
          className="celebration-comic-badge"
          style={{
            position: 'absolute',
            left: `${badge.x}%`,
            top: `${badge.y}%`,
            transform: 'translate(-50%, -50%)',
            zIndex: 65
          }}
        >
          {badge.text}
        </div>
      ))}
    </div>
  );
}
