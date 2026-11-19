// Game library: finished games are kept so they can be replayed move by move.
// Local games live in this browser (localStorage); online games are read from Firestore (see Library.tsx).
import type { GameState, Side } from './game/rules.ts';

export interface LibraryEntry {
  id: string;
  name: string;
  at: number;
  names: Record<Side, string | null>;
  winner: Side | null;
  winReason: string | null;
  moves: number;
  record: string[];
  replay: string[];
  where: 'lokal' | 'online';
}

const KEY = 'deckmate-bibliothek';
const MAX = 40;

export function localLibrary(): LibraryEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as LibraryEntry[]; } catch { return []; }
}

export function entryOf(id: string, name: string, st: GameState, names: Record<Side, string | null>, where: LibraryEntry['where'], at = Date.now()): LibraryEntry {
  return {
    id, name, at, names, where, winner: st.winner, winReason: st.winReason, moves: Math.max(0, st.moveNo - 1),
    record: st.record ?? [...st.log].reverse(), replay: st.replay ?? [],
  };
}

/** Stores a finished local game (once per id; the newest games first, at most 40). */
export function saveLocal(e: LibraryEntry) {
  try {
    const list = localLibrary().filter((x) => x.id !== e.id);
    localStorage.setItem(KEY, JSON.stringify([e, ...list].slice(0, MAX)));
  } catch { /* storage full or private mode: the game just is not kept */ }
}

export function deleteLocal(id: string) {
  try { localStorage.setItem(KEY, JSON.stringify(localLibrary().filter((x) => x.id !== id))); } catch { /* ignore */ }
}
