import React, { useState } from 'react';
import { SOUND_PACKS, MYSTERY_PACK_ID, shuffleArray, getAllSounds, loadSoundUrl } from '../utils/soundLibrary';
import { blobToDataURL, peerManager } from '../utils/peerManager';
import { extractWaveformBars } from './WaveformDisplay';
import { PlayerAvatar } from '../utils/avatarUtils';
import { IconCrown, IconMusic, IconShuffle, IconAlertTriangle, IconClock, IconArrowRight } from './Icons';

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
    icon: '🎲',
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
        ? `🎲 Mystery Mix (${roundSoundsCount} Sounds)`
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
    <div className="card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div className="card-title" style={{ marginBottom: 0, gap: '0.5rem' }}>
          <IconMusic size={20} /> Select Sound Pack
        </div>
        {isHost ? (
          <span style={{
            fontSize: '0.8rem',
            color: 'var(--primary)',
            fontWeight: 700,
            background: 'rgba(244,132,95,0.12)',
            padding: '0.25rem 0.75rem',
            borderRadius: '20px',
            border: '1px solid rgba(244,132,95,0.3)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}>
            <IconCrown size={13} /> Choosing round settings
          </span>
        ) : (
          <span style={{
            fontSize: '0.8rem',
            color: 'var(--secondary)',
            fontWeight: 700,
            background: 'rgba(6,182,212,0.12)',
            padding: '0.25rem 0.75rem',
            borderRadius: '20px',
            border: '1px solid rgba(6,182,212,0.3)'
          }}>
            Watching {hostPlayer?.name || 'Host'}'s selection
          </span>
        )}
      </div>

      <p className="card-subtitle">
        {isHost
          ? 'Choose match length and a pack! Sounds will be selected at random for the round.'
          : `${hostPlayer?.name || 'The Host'} is configuring the match. Sounds will be selected at random!`
        }
      </p>

      {/* ── Round Length Selector ── */}
      <div className="round-length-box">
        <div>
          <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            Match Length
          </strong>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {isHost
              ? 'Select how many random sounds to mimic in this round'
              : `Host selected ${roundSoundsCount} sounds per round`
            }
          </span>
        </div>
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
                  padding: '0.4rem 1.1rem',
                  borderRadius: '8px',
                  border: isActive ? '1.5px solid var(--primary)' : '1px solid transparent',
                  background: isActive ? 'var(--primary)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  cursor: isHost ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                  boxShadow: isActive ? '0 2px 10px rgba(244,132,95,0.35)' : 'none'
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
          padding: '0.75rem 1rem',
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: '8px',
          color: '#ef4444',
          fontSize: '0.85rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <IconAlertTriangle size={15} /> {loadError}
        </div>
      )}

      {/* ── Sound Pack Selection List ── */}
      {!hasPacks && allSounds.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '2.5rem 1.5rem',
          background: 'var(--bg-card-2)',
          border: '1.5px dashed var(--border-color)',
          borderRadius: 'var(--radius)',
          marginBottom: '1.5rem'
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginBottom: '1.5rem' }}>
          
          {/* 1. Mystery Mix Card (Random from all packs) */}
          <div
            onClick={() => handleSelectPack(MYSTERY_PACK_ID, isMysteryEligible)}
            className={`sound-pack-card mystery ${isMysterySelected ? 'selected' : ''} ${isHost && isMysteryEligible ? 'interactive' : ''}`}
            style={{
              opacity: isMysteryEligible ? 1 : 0.45,
              cursor: isHost && isMysteryEligible ? 'pointer' : (isHost ? 'not-allowed' : 'default')
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '10px',
                  background: 'rgba(108, 99, 255, 0.12)',
                  border: '1px solid rgba(108, 99, 255, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <IconShuffle size={20} color="var(--secondary)" />
                </div>
                <div>
                  <strong className="sound-pack-title">Mystery Mix (Random from Any Pack)</strong>
                  <span className="sound-pack-desc">
                    Selects {roundSoundsCount} completely random sounds across all packs!
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {isMysterySelected && (
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      background: 'var(--secondary)',
                      color: '#fff',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}>
                      {isHost ? '✓ Selected' : <><IconCrown size={12} /> Chosen by {hostPlayer?.name || 'Host'}</>}
                    </span>
                  )}
                  {isMysteryEligible ? (
                    <span className="badge-ready" style={{ fontSize: '0.78rem', background: 'rgba(108, 99, 255, 0.12)', color: 'var(--secondary)', border: '1px solid rgba(108,99,255,0.3)' }}>
                      All {allSounds.length} Sounds
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <IconAlertTriangle size={12} /> Needs {roundSoundsCount} sounds ({allSounds.length} available)
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--secondary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <IconShuffle size={12} /> 100% Surprise Shuffle
                </span>
              </div>
            </div>
          </div>

          {/* 2. Standard Sound Packs */}
          {SOUND_PACKS.map((pack) => {
            const isSelected = selectedPack?.id === pack.id;
            const isEligible = pack.sounds.length >= roundSoundsCount;

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
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <span style={{ fontSize: '1.85rem' }}>{pack.icon}</span>
                    <div>
                      <strong className="sound-pack-title">{pack.title}</strong>
                      <span className="sound-pack-desc">
                        {isEligible
                          ? `Picks ${roundSoundsCount} random sounds from this pack for the round`
                          : `Pack only has ${pack.sounds.length} sounds (needs at least ${roundSoundsCount})`
                        }
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {isSelected && (
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          background: 'var(--primary)',
                          color: '#fff',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '12px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}>
                          {isHost ? '✓ Selected' : <><IconCrown size={12} /> Chosen by {hostPlayer?.name || 'Host'}</>}
                        </span>
                      )}
                      {isEligible ? (
                        <span className="badge-ready" style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <IconMusic size={12} /> {pack.count} Sounds
                        </span>
                      ) : (
                        <span style={{
                          fontSize: '0.72rem',
                          color: '#ef4444',
                          background: 'rgba(239, 68, 68, 0.12)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '6px',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}>
                          <IconAlertTriangle size={12} /> Needs {roundSoundsCount} sounds ({pack.count} has)
                        </span>
                      )}
                    </div>
                    {isEligible && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <IconShuffle size={12} /> Random Selection
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Host Controls vs Non-Host Live Status */}
      {isHost ? (
        <>
          {isGenerating && progress.total > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                <span>Selecting and loading {progress.total} random sounds...</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <div className="score-bar-bg">
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
            style={{ width: '100%', padding: '1rem', fontSize: '1.08rem' }}
          >
            {isGenerating
              ? `Preparing Round (${progress.current}/${progress.total})...`
              : (selectedPack ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', justifyContent: 'center' }}>
                    Start Round ({roundSoundsCount} Sounds) <IconArrowRight size={18} />
                  </span>
                ) : 'Select an Eligible Pack to Start'
                )}
          </button>
        </>
      ) : (
        <div className="pack-status-box">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <PlayerAvatar name={hostPlayer?.name || 'Host'} avatar={hostPlayer?.avatar} size={28} />
            <div>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{hostPlayer?.name || 'Host'}</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}> selected </span>
              <strong style={{ color: 'var(--primary)', fontSize: '0.95rem' }}>{roundSoundsCount} Sounds</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}> from </span>
              <strong style={{ color: 'var(--primary)', fontSize: '0.95rem' }}>{selectedPack?.title || 'a pack'}</strong>
            </div>
          </div>
          <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'center' }}>
            <IconClock size={14} /> Waiting for {hostPlayer?.name || 'Host'} to start the round...
          </p>
        </div>
      )}
    </div>
  );
}
