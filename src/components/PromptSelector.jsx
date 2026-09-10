import React, { useState } from 'react';
import { SOUND_PACKS, MYSTERY_PACK_ID, shuffleArray, getAllSounds, loadSoundUrl } from '../utils/soundLibrary';
import { blobToDataURL, peerManager } from '../utils/peerManager';
import { extractWaveformBars } from './WaveformDisplay';
import { PlayerAvatar } from '../utils/avatarUtils';
import { IconCrown, IconMusic, IconShuffle, IconAlertTriangle, IconClock, IconArrowRight, IconCheck, IconDice } from './Icons';

export default function PromptSelector({ roomState, onSelectSoundPack }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [loadError, setLoadError] = useState(null);

  const isHost = roomState?.isHost;
  const hostPlayer = roomState?.players?.find(p => p.isHost) || roomState?.players?.[0];

  const roundSoundsCount = roomState?.roundSoundsCount || 5;
  const allSounds = getAllSounds();
  const hasPacks = SOUND_PACKS && SOUND_PACKS.length > 0;
  const isMysteryEligible = allSounds.length >= roundSoundsCount;

  // Virtual pack for "Random from Any Pack"
  const mysteryPack = {
    id: MYSTERY_PACK_ID,
    title: 'Mystery Mix (Any Pack)',
    icon: 'dice',
    description: `Picks ${roundSoundsCount} completely random sounds across all available sound packs!`,
    count: allSounds.length,
    sounds: allSounds,
    isMystery: true,
    isEligible: isMysteryEligible
  };

  // Determine current selected pack
  const rawSelectedPackId = roomState?.selectedPackId;
  let selectedPackId = rawSelectedPackId;

  // If no pack is selected or selected pack is ineligible, fallback to an eligible option
  if (!selectedPackId) {
    selectedPackId = isMysteryEligible ? MYSTERY_PACK_ID : (hasPacks ? SOUND_PACKS[0].id : null);
  } else if (selectedPackId === MYSTERY_PACK_ID) {
    if (!isMysteryEligible) {
      const firstEligible = SOUND_PACKS.find(p => p.sounds.length >= roundSoundsCount);
      selectedPackId = firstEligible ? firstEligible.id : null;
    }
  } else {
    const currentPack = SOUND_PACKS.find(p => p.id === selectedPackId);
    if (!currentPack || currentPack.sounds.length < roundSoundsCount) {
      const firstEligible = SOUND_PACKS.find(p => p.sounds.length >= roundSoundsCount);
      selectedPackId = firstEligible ? firstEligible.id : (isMysteryEligible ? MYSTERY_PACK_ID : null);
    }
  }

  const isMysterySelected = selectedPackId === MYSTERY_PACK_ID;
  const selectedPack = isMysterySelected
    ? mysteryPack
    : (SOUND_PACKS.find(p => p.id === selectedPackId) || (isMysteryEligible ? mysteryPack : SOUND_PACKS[0]));

  const isCurrentSelectedEligible = isMysterySelected
    ? isMysteryEligible
    : Boolean(selectedPack && selectedPack.sounds?.length >= roundSoundsCount);

  const handleSelectRoundLength = (count) => {
    if (!isHost) return;
    setLoadError(null);

    // Validate if current selected pack is eligible with the new round count
    let newSelectedPackId = selectedPackId;
    if (newSelectedPackId === MYSTERY_PACK_ID) {
      if (allSounds.length < count) {
        const firstEligible = SOUND_PACKS.find(p => p.sounds.length >= count);
        newSelectedPackId = firstEligible ? firstEligible.id : null;
      }
    } else {
      const pack = SOUND_PACKS.find(p => p.id === newSelectedPackId);
      if (!pack || pack.sounds.length < count) {
        const firstEligible = SOUND_PACKS.find(p => p.sounds.length >= count);
        newSelectedPackId = firstEligible ? firstEligible.id : (allSounds.length >= count ? MYSTERY_PACK_ID : null);
      }
    }

    peerManager.updateRoomState({
      roundSoundsCount: count,
      selectedPackId: newSelectedPackId
    });
  };

  const handleSelectPack = (packId, isEligible) => {
    if (!isHost || !isEligible) return;
    setLoadError(null);
    peerManager.updateRoomState({ selectedPackId: packId });
  };

  const handleConfirmPack = async () => {
    if (!isHost || !selectedPack) return;
    setIsGenerating(true);
    setLoadError(null);
    setProgress({ current: 0, total: roundSoundsCount });

    try {
      const soundPackItems = [];

      // 1. Gather candidate sounds pool
      const candidateSounds = isMysterySelected ? allSounds : selectedPack.sounds;
      if (!candidateSounds || candidateSounds.length < roundSoundsCount) {
        throw new Error(`Not enough sounds available. Needed ${roundSoundsCount}, found ${candidateSounds?.length || 0}.`);
      }

      // 2. Randomly select roundSoundsCount sounds using Fisher-Yates shuffle
      const chosenSounds = shuffleArray(candidateSounds).slice(0, roundSoundsCount);

      // 3. Load & decode each chosen sound
      for (let i = 0; i < chosenSounds.length; i++) {
        const sound = chosenSounds[i];
        setProgress({ current: i + 1, total: roundSoundsCount });

        const { audioBuffer, duration } = await loadSoundUrl(sound.soundUrl);
        const pcm = audioBuffer.getChannelData(0);
        const waveformBars = extractWaveformBars(pcm, 120);

        soundPackItems.push({
          id: sound.id,
          title: sound.title,
          soundUrl: sound.soundUrl,
          targetAudioUrl: sound.soundUrl,
          duration,
          waveformBars
        });
      }

      const finalTitle = isMysterySelected
        ? `Mystery Mix (${roundSoundsCount} Sounds)`
        : `${selectedPack.title} (${roundSoundsCount} Random Sounds)`;

      onSelectSoundPack(finalTitle, soundPackItems);
    } catch (e) {
      console.error('Error loading sound pack:', e);
      setLoadError(`Failed to load audio files: ${e.message}`);
    } finally {
      setIsGenerating(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div className="card prompt-selector-card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem', flexWrap: 'wrap', gap: '0.4rem' }}>
        <div className="card-title" style={{ marginBottom: 0, gap: '0.45rem', fontSize: '1.15rem' }}>
          <IconMusic size={18} /> Select Sound Pack
        </div>
        {isHost && (
          <span style={{
            fontSize: '0.76rem',
            color: 'var(--primary)',
            fontWeight: 700,
            background: 'rgba(244,132,95,0.12)',
            padding: '0.2rem 0.65rem',
            borderRadius: '16px',
            border: '1px solid rgba(244,132,95,0.3)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem'
          }}>
            <IconCrown size={12} /> Host Settings
          </span>
        )}
      </div>

      <p className="card-subtitle" style={{ fontSize: '0.82rem', marginBottom: '0.55rem' }}>
        {isHost
          ? 'Choose match length and a sound pack to begin!'
          : 'Host is selecting a sound pack...'
        }
      </p>

      {/* ── Round Length Selector ── */}
      <div className="round-length-box">
        <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          Round Length
        </strong>
        <div className="round-length-pill-group">
          {[5, 10].map(count => {
            const isActive = roundSoundsCount === count;
            return (
              <button
                key={count}
                type="button"
                disabled={!isHost}
                onClick={() => handleSelectRoundLength(count)}
                style={{
                  padding: '0.25rem 0.85rem',
                  borderRadius: '6px',
                  border: isActive ? '1.5px solid var(--primary)' : '1px solid transparent',
                  background: isActive ? 'var(--primary)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: isHost ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                  boxShadow: isActive ? '0 2px 8px rgba(244,132,95,0.35)' : 'none'
                }}
              >
                {count} Sounds
              </button>
            );
          })}
        </div>
      </div>

      {loadError && (
        <div style={{
          padding: '0.6rem 0.85rem',
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: '8px',
          color: '#ef4444',
          fontSize: '0.82rem',
          marginBottom: '0.6rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <IconAlertTriangle size={15} /> {loadError}
        </div>
      )}

      {/* ── Sound Pack Selection Scrollable List ── */}
      {!hasPacks && allSounds.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '2rem 1.5rem',
          background: 'var(--bg-card-2)',
          border: '1.5px dashed var(--border-color)',
          borderRadius: 'var(--radius)',
          marginBottom: '1rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
            <IconMusic size={36} color="var(--text-muted)" />
          </div>
          <h3 style={{ color: 'var(--text-main)', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>No Sound Packs Found</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '400px', margin: '0 auto' }}>
            Drop a folder containing <code>.mp3</code> files inside <code>public/sounds/</code> and it will automatically appear here!
          </p>
        </div>
      ) : (
        <div className="prompt-selector-pack-list">
          {/* 1. Mystery Mix Card */}
          <div
            onClick={() => handleSelectPack(MYSTERY_PACK_ID, isMysteryEligible)}
            className={`sound-pack-card mystery ${isMysterySelected ? 'selected' : ''} ${isHost && isMysteryEligible ? 'interactive' : ''}`}
            style={{
              opacity: isMysteryEligible ? 1 : 0.45,
              cursor: isHost && isMysteryEligible ? 'pointer' : (isHost ? 'not-allowed' : 'default')
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{
                  width: 34,
                  height: 34,
                  borderRadius: '8px',
                  background: 'rgba(108, 99, 255, 0.12)',
                  border: '1px solid rgba(108, 99, 255, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <IconShuffle size={18} color="var(--secondary)" />
                </div>
                <div>
                  <strong className="sound-pack-title" style={{ fontSize: '0.96rem' }}>Mystery Mix</strong>
                  <span className="sound-pack-desc">
                    Surprise sounds shuffled from all available packs
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {isMysterySelected && (
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    background: 'var(--secondary)',
                    color: '#fff',
                    padding: '0.15rem 0.55rem',
                    borderRadius: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}>
                    {isHost ? <><IconCheck size={11} /> Selected</> : <><IconCrown size={11} /> Chosen</>}
                  </span>
                )}
                {isMysteryEligible ? (
                  <span className="badge-ready" style={{ fontSize: '0.76rem', padding: '0.15rem 0.5rem', background: 'rgba(108, 99, 255, 0.12)', color: 'var(--secondary)', border: '1px solid rgba(108,99,255,0.3)' }}>
                    All {allSounds.length} Sounds
                  </span>
                ) : (
                  <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <IconAlertTriangle size={12} /> Needs {roundSoundsCount} sounds ({allSounds.length} available)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 2. Standard Sound Packs */}
          {SOUND_PACKS.map((pack) => {
            const isSelected = selectedPack?.id === pack.id;
            const isEligible = pack.sounds.length >= roundSoundsCount;
            const sampleSounds = pack.sounds.slice(0, 3).map(s => s.title).join(', ');

            return (
              <div
                key={pack.id}
                onClick={() => handleSelectPack(pack.id, isEligible)}
                className={`sound-pack-card ${isSelected ? 'selected' : ''} ${isHost && isEligible ? 'interactive' : ''}`}
                style={{
                  opacity: isEligible ? 1 : 0.45,
                  cursor: isHost && isEligible ? 'pointer' : (isHost ? 'not-allowed' : 'default')
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <span style={{ fontSize: '1.45rem', lineHeight: 1 }}>{pack.icon}</span>
                    <div>
                      <strong className="sound-pack-title" style={{ fontSize: '0.96rem' }}>{pack.title}</strong>
                      <span className="sound-pack-desc">
                        {isEligible
                          ? sampleSounds + (pack.sounds.length > 3 ? '…' : '')
                          : `Has ${pack.sounds.length} sounds (needs at least ${roundSoundsCount})`
                        }
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {isSelected && (
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        background: 'var(--primary)',
                        color: '#fff',
                        padding: '0.15rem 0.55rem',
                        borderRadius: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}>
                        {isHost ? <><IconCheck size={11} /> Selected</> : <><IconCrown size={11} /> Chosen</>}
                      </span>
                    )}
                    {isEligible ? (
                      <span className="badge-ready" style={{ fontSize: '0.76rem', padding: '0.15rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <IconMusic size={11} /> {pack.count} Sounds
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '0.72rem',
                        color: '#ef4444',
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '6px',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}>
                        <IconAlertTriangle size={11} /> Needs {roundSoundsCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Host Sticky Action Bar vs Non-Host Live Status ── */}
      <div className="prompt-selector-action-bar">
        {isHost ? (
          <>
            {isGenerating && progress.total > 0 && (
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  <span>Loading {progress.total} random sounds...</span>
                  <span>{progress.current} / {progress.total}</span>
                </div>
                <div className="score-bar-bg" style={{ height: '6px' }}>
                  <div className="score-bar-fill" style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                    background: 'var(--primary)',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handleConfirmPack}
              disabled={isGenerating || !selectedPack || !isCurrentSelectedEligible}
              style={{
                width: '100%',
                padding: '0.8rem 1.2rem',
                fontSize: '1rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 16px rgba(244, 132, 95, 0.35)'
              }}
            >
              {isGenerating
                ? `Preparing Round (${progress.current}/${progress.total})...`
                : (selectedPack ? (
                    <>
                      Start Round ({roundSoundsCount} Sounds) <IconArrowRight size={18} />
                    </>
                  ) : 'Select an Eligible Pack to Start'
                  )}
            </button>
          </>
        ) : (
          <div className="pack-status-box" style={{ margin: 0, padding: '0.65rem 0.75rem', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'center', fontWeight: 600 }}>
              <IconClock size={14} /> Starting soon...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
