/**
 * Silent Player Tracker for Parrot Party
 * Silently records usernames, games played, and scores to Supabase in the background.
 * Zero UI impact, non-blocking, fail-safe.
 */

import { supabase, isSupabaseConfigured } from './supabaseClient.js';

const LOCAL_STORAGE_KEY = 'parrot_silent_records_v1';

/**
 * Normalizes username
 */
function clean(name) {
  return String(name || '').trim();
}

/**
 * Reads local offline cache
 */
function getLocalRecords() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Saves to local offline cache
 */
function saveLocalRecords(records) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
  } catch (e) {}
}

/**
 * Silently captures a player joining or creating a room
 */
export async function capturePlayerSilent({ username, roomCode = '', avatar = '' }) {
  const name = clean(username);
  if (!name || name.length < 2) return;

  const now = new Date().toISOString();
  const key = name.toLowerCase();

  // 1. Silent Local Storage Backup
  try {
    const records = getLocalRecords();
    const existing = records[key] || {};
    records[key] = {
      username: name,
      avatar: avatar || existing.avatar || '',
      first_played_at: existing.first_played_at || now,
      last_played_at: now,
      games_played: existing.games_played || 1,
      rounds_played: existing.rounds_played || 0,
      best_score: existing.best_score || 0,
      total_score: existing.total_score || 0,
      last_room_code: roomCode || existing.last_room_code || ''
    };
    saveLocalRecords(records);
  } catch (e) {}

  // 2. Silent Supabase Upsert
  if (!isSupabaseConfigured || !supabase) return;

  try {
    // Fetch existing player row to keep cumulative counts accurate
    const { data: existing } = await supabase
      .from('game_players')
      .select('first_played_at, games_played, best_score, total_score')
      .ilike('username', name)
      .maybeSingle();

    const payload = {
      username: name,
      avatar: avatar || '',
      first_played_at: existing?.first_played_at || now,
      last_played_at: now,
      games_played: existing?.games_played || 1,
      last_room_code: roomCode || '',
      updated_at: now
    };

    await supabase
      .from('game_players')
      .upsert(payload, { onConflict: 'username' });
  } catch (e) {
    // Fail silently without disturbing the user or game flow
  }
}

/**
 * Silently captures all players participating when a game starts
 */
export async function captureGameStartSilent({ players = [], roomCode = '', soundPackTitle = '' }) {
  if (!Array.isArray(players) || players.length === 0) return;

  const now = new Date().toISOString();

  // Local storage update
  try {
    const records = getLocalRecords();
    for (const p of players) {
      const name = clean(p.name || p.playerName || p.username);
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = records[key] || {};
      records[key] = {
        username: name,
        avatar: p.avatar || existing.avatar || '',
        first_played_at: existing.first_played_at || now,
        last_played_at: now,
        games_played: (existing.games_played || 0) + 1,
        rounds_played: existing.rounds_played || 0,
        best_score: existing.best_score || 0,
        total_score: existing.total_score || 0,
        last_room_code: roomCode || existing.last_room_code || ''
      };
    }
    saveLocalRecords(records);
  } catch (e) {}

  // Supabase background update
  if (!isSupabaseConfigured || !supabase) return;

  try {
    const promises = players.map(async (p) => {
      const name = clean(p.name || p.playerName || p.username);
      if (!name) return;

      const { data: existing } = await supabase
        .from('game_players')
        .select('first_played_at, games_played')
        .ilike('username', name)
        .maybeSingle();

      const gamesCount = (existing?.games_played || 0) + 1;

      return supabase
        .from('game_players')
        .upsert({
          username: name,
          avatar: p.avatar || '',
          first_played_at: existing?.first_played_at || now,
          last_played_at: now,
          games_played: gamesCount,
          last_room_code: roomCode || '',
          updated_at: now
        }, { onConflict: 'username' });
    });

    await Promise.allSettled(promises);
  } catch (e) {
    // Fail silently
  }
}

/**
 * Silently records final match scores and stats when game completes
 */
export async function captureGameCompleteSilent({ players = [], roomCode = '', soundPackTitle = '' }) {
  if (!Array.isArray(players) || players.length === 0) return;

  const now = new Date().toISOString();
  const sessionEntries = [];

  // Local storage update
  try {
    const records = getLocalRecords();
    for (const p of players) {
      const name = clean(p.name || p.playerName || p.username);
      if (!name) continue;

      const key = name.toLowerCase();
      const existing = records[key] || {};

      const validScores = (p.recordings || []).filter(Boolean).map(r => Number(r?.scoreResult?.overallScore) || 0);
      const scoreTotal = validScores.reduce((a, b) => a + b, 0) || Number(p?.scoreData?.totalScore) || Number(p?.scoreData?.overallScore) || 0;
      const roundsCount = validScores.length || (p?.scoreData?.soundScores || []).length || 0;

      records[key] = {
        username: name,
        avatar: p.avatar || existing.avatar || '',
        first_played_at: existing.first_played_at || now,
        last_played_at: now,
        games_played: Math.max(existing.games_played || 1, 1),
        rounds_played: (existing.rounds_played || 0) + roundsCount,
        best_score: Math.max(existing.best_score || 0, scoreTotal),
        total_score: (existing.total_score || 0) + scoreTotal,
        last_room_code: roomCode || existing.last_room_code || ''
      };

      sessionEntries.push({
        room_code: roomCode || 'ROOM',
        player_name: name,
        avatar: p.avatar || '',
        sound_pack: soundPackTitle || 'Default',
        score: scoreTotal,
        rounds_count: roundsCount,
        played_at: now
      });
    }
    saveLocalRecords(records);
  } catch (e) {}

  // Supabase background update
  if (!isSupabaseConfigured || !supabase) return;

  try {
    const promises = players.map(async (p) => {
      const name = clean(p.name || p.playerName || p.username);
      if (!name) return;

      const validScores = (p.recordings || []).filter(Boolean).map(r => Number(r?.scoreResult?.overallScore) || 0);
      const scoreTotal = validScores.reduce((a, b) => a + b, 0) || Number(p?.scoreData?.totalScore) || Number(p?.scoreData?.overallScore) || 0;
      const roundsCount = validScores.length || (p?.scoreData?.soundScores || []).length || 0;

      const { data: existing } = await supabase
        .from('game_players')
        .select('first_played_at, games_played, best_score, total_score, rounds_played')
        .ilike('username', name)
        .maybeSingle();

      const bestScore = Math.max(existing?.best_score || 0, scoreTotal);
      const totalScore = (existing?.total_score || 0) + scoreTotal;
      const totalRounds = (existing?.rounds_played || 0) + roundsCount;
      const gamesCount = Math.max(existing?.games_played || 1, 1);

      return supabase
        .from('game_players')
        .upsert({
          username: name,
          avatar: p.avatar || '',
          first_played_at: existing?.first_played_at || now,
          last_played_at: now,
          games_played: gamesCount,
          rounds_played: totalRounds,
          best_score: bestScore,
          total_score: totalScore,
          last_room_code: roomCode || '',
          updated_at: now
        }, { onConflict: 'username' });
    });

    await Promise.allSettled(promises);

    if (sessionEntries.length > 0) {
      await supabase.from('game_sessions').insert(sessionEntries);
    }
  } catch (e) {
    // Fail silently
  }
}
