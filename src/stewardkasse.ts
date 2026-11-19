// Steward fund: counts across all games which coins came to lie on Stewards, so the Stewards can be paid one day.
// Firestore document stats/stewardkasse, one counter per coin kind. Best effort: a missing rule never blocks a move.
import { doc, increment, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.ts';
import { COINS, COIN_ORDER, stewardCoins, type Coin, type GameState } from './game/rules.ts';

export type Kasse = Partial<Record<Coin, number>>;
const ref = () => doc(db, 'stats', 'stewardkasse');

/** Coins that newly landed on Stewards between two states. */
export function newCoins(before: GameState, after: GameState): Kasse {
  const a = stewardCoins(before.board), b = stewardCoins(after.board);
  const out: Kasse = {};
  for (const c of COIN_ORDER) { const d = (b[c] ?? 0) - (a[c] ?? 0); if (d > 0) out[c] = d; }
  return out;
}

export async function addToKasse(k: Kasse) {
  const keys = Object.keys(k) as Coin[];
  if (!keys.length || !auth.currentUser) return;
  try {
    await setDoc(ref(), Object.fromEntries(keys.map((c) => [c, increment(k[c]!)])), { merge: true });
  } catch (e) { console.warn('[Deckmate] Stewardkasse nicht erreichbar (Firestore-Regeln veröffentlicht?)', e); }
}

export function watchKasse(cb: (k: Kasse) => void) {
  return onSnapshot(ref(), (s) => cb((s.data() ?? {}) as Kasse), () => cb({}));
}

/** Total in pounds, shillings and pence, e.g. "£1 3s 4¾d". */
export function kasseValue(k: Kasse): string {
  const far = COIN_ORDER.reduce((a, c) => a + (k[c] ?? 0) * COINS[c].value, 0);
  const pounds = Math.floor(far / 960), sh = Math.floor((far % 960) / 48), pence = Math.floor((far % 48) / 4), q = far % 4;
  const frac = ['', '¼', '½', '¾'][q];
  return `£${pounds} ${sh}s ${pence}${frac}d`;
}
