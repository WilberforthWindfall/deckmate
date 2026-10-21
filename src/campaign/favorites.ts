// Favourite maps. Signed in: stored on the player's profile (users/{uid}.karten, the owner may write it), so they
// follow the player to every device. Otherwise in this browser only. The whole map is stored, not just the code,
// so a favourite never changes even if the generator does.
import { useEffect, useState } from 'react';
import { deleteField, doc, onSnapshot, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase.ts';
import type { MapDef } from './map.ts';

export interface Favorite { id: string; name: string; at: number; def: MapDef }
const LOCAL = 'deckmate.karten.favoriten';
export const MAX_FAVORITES = 30;
const keyOf = (def: MapDef) => def.id.replace(/[^A-Za-z0-9_-]/g, '_');

function readLocal(): Favorite[] {
  try { return JSON.parse(localStorage.getItem(LOCAL) ?? '[]'); } catch { return []; }
}
function writeLocal(list: Favorite[]) { try { localStorage.setItem(LOCAL, JSON.stringify(list)); } catch { /* ignore */ } }

export function useFavorites(user: User | null) {
  const [list, setList] = useState<Favorite[]>(() => (user ? [] : readLocal()));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user) { setList(readLocal()); return; }
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const raw = (snap.data()?.karten ?? {}) as Record<string, { name: string; at: number; def: string }>;
      const out: Favorite[] = [];
      for (const [id, v] of Object.entries(raw)) { try { out.push({ id, name: v.name, at: v.at, def: JSON.parse(v.def) }); } catch { /* skip broken */ } }
      setList(out.sort((a, b) => b.at - a.at));
      setError('');
    }, () => { setError('Favoriten sind gerade nicht erreichbar – sie werden vorerst nur in diesem Browser gespeichert.'); setList(readLocal()); });
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(def: MapDef, name: string) {
    const fav: Favorite = { id: keyOf(def), name: name.trim() || def.name, at: Date.now(), def };
    if (list.length >= MAX_FAVORITES && !list.some((f) => f.id === fav.id)) throw new Error(`Höchstens ${MAX_FAVORITES} Favoriten – lösche erst einen.`);
    if (user && !error) {
      await setDoc(doc(db, 'users', user.uid), { karten: { [fav.id]: { name: fav.name, at: fav.at, def: JSON.stringify(def) } } }, { merge: true });
      return;
    }
    const next = [fav, ...readLocal().filter((f) => f.id !== fav.id)];
    writeLocal(next); setList(next);
  }
  async function remove(id: string) {
    if (user && !error) { await setDoc(doc(db, 'users', user.uid), { karten: { [id]: deleteField() } }, { merge: true }); return; }
    const next = readLocal().filter((f) => f.id !== id);
    writeLocal(next); setList(next);
  }
  const has = (def: MapDef) => list.some((f) => f.id === keyOf(def));
  return { list, save, remove, has, error, synced: !!user && !error };
}
