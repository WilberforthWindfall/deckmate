import {
  addDoc, collection, deleteDoc, doc, increment, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, updateDoc, where, type Timestamp,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase.ts';
import { act, actorOf, type Action } from './game/actions.ts';
import { newGame, opp, type GameState, type Side } from './game/rules.ts';
import { battleGame, newCampaign, type Campaign, type CampaignOptions } from './campaign/engine.ts';
import { HOUSES, type House } from './campaign/map.ts';

export interface GameDoc {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Timestamp | null;
  status: 'open' | 'running' | 'over';
  players: Record<Side, string | null>;
  names: Record<Side, string | null>;
  members: string[];
  state: GameState;
  /** Deckmate battle of an online campaign: back link to it. Such games do not count for wins and losses. */
  campaign?: { id: string; battle: string };
}

/** Online campaign in the same collection (so the existing Firestore rules apply). The state is stored as JSON text. */
export interface CampaignDoc {
  id: string;
  kind: 'kampagne';
  name: string;
  createdBy: string;
  createdAt: Timestamp | null;
  status: 'open' | 'running' | 'over';
  players: Record<House, string | null>;
  names: Record<House, string | null>;
  members: string[];
  cstate: string;
}
export type AnyDoc = GameDoc | CampaignDoc;
export const isCampaign = (g: AnyDoc): g is CampaignDoc => (g as CampaignDoc).kind === 'kampagne';
export const parseCampaign = (g: CampaignDoc) => JSON.parse(g.cstate) as Campaign;

const gamesCol = collection(db, 'games');
const nameOf = (u: User) => u.displayName || u.email?.split('@')[0] || 'Unbekannt';

export async function createGame(user: User, name: string, side: Side): Promise<string> {
  const players: Record<Side, string | null> = { M: null, O: null };
  const names: Record<Side, string | null> = { M: null, O: null };
  players[side] = user.uid;
  names[side] = nameOf(user);
  const ref = await addDoc(gamesCol, {
    name: name.trim() || `Partie von ${nameOf(user)}`,
    createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    status: 'open', players, names, members: [user.uid],
    state: newGame(Math.random),
  });
  return ref.id;
}

export function watchLobby(cb: (games: AnyDoc[]) => void, onError: (e: Error) => void) {
  const q = query(gamesCol, where('status', 'in', ['open', 'running']), orderBy('createdAt', 'desc'), limit(40));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AnyDoc)), onError);
}

export function watchMyFinished(uid: string, cb: (games: AnyDoc[]) => void) {
  const q = query(gamesCol, where('members', 'array-contains', uid), where('status', '==', 'over'), orderBy('createdAt', 'desc'), limit(10));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AnyDoc)), () => cb([]));
}

// ---------- online campaign ----------

export async function createCampaign(user: User, name: string, house: House, opts: CampaignOptions): Promise<string> {
  const players: Record<House, string | null> = { R: null, K: null };
  const names: Record<House, string | null> = { R: null, K: null };
  players[house] = user.uid;
  names[house] = nameOf(user);
  const ref = await addDoc(gamesCol, {
    kind: 'kampagne', name: name.trim() || `Kampagne von ${nameOf(user)}`,
    createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    status: 'open', players, names, members: [user.uid],
    cstate: JSON.stringify({ ...newCampaign(opts), report: ['Runde 1 beginnt. Beide Häuser geben ihre Befehle gleichzeitig, jeder an seinem Gerät.'] }),
  });
  return ref.id;
}

export function watchCampaign(id: string, cb: (g: CampaignDoc | null) => void, onError: (e: Error) => void) {
  return onSnapshot(doc(db, 'games', id), (snap) => cb(snap.exists() && snap.data().kind === 'kampagne' ? ({ id: snap.id, ...snap.data() } as CampaignDoc) : null), onError);
}

export async function joinCampaign(user: User, id: string): Promise<House> {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'games', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Diese Kampagne gibt es nicht mehr.');
    const g = snap.data() as CampaignDoc;
    const mine = (['R', 'K'] as House[]).find((h) => g.players[h] === user.uid);
    if (mine) return mine;
    const free = (['R', 'K'] as House[]).find((h) => !g.players[h]);
    if (!free) throw new Error('Diese Kampagne ist bereits voll.');
    tx.update(ref, {
      [`players.${free}`]: user.uid, [`names.${free}`]: nameOf(user),
      members: [...g.members, user.uid], status: 'running', updatedAt: serverTimestamp(),
    });
    return free;
  });
}

/**
 * Changes the campaign inside a transaction: reads the latest state, applies `fn` as the player's house, writes it
 * back. At the end of the campaign the wins and losses are counted.
 */
export async function commitCampaign(user: User, id: string, fn: (c: Campaign, me: House) => Campaign): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'games', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Diese Kampagne gibt es nicht mehr.');
    const g = snap.data() as CampaignDoc;
    const me = (['R', 'K'] as House[]).find((h) => g.players[h] === user.uid);
    if (!me) throw new Error('Du spielst in dieser Kampagne nicht mit.');
    if (!g.players.R || !g.players.K) throw new Error('Warte, bis das andere Haus beigetreten ist.');
    const prev = JSON.parse(g.cstate) as Campaign;
    const next = fn(prev, me);
    const ends = next.phase === 'over' && prev.phase !== 'over';
    tx.update(ref, { cstate: JSON.stringify(next), updatedAt: serverTimestamp(), ...(ends ? { status: 'over' } : {}) });
    if (ends && next.winner) {
      const w = g.players[next.winner], l = g.players[next.winner === 'R' ? 'K' : 'R'];
      if (w) tx.set(doc(db, 'users', w), { wins: increment(1) }, { merge: true });
      if (l) tx.set(doc(db, 'users', l), { losses: increment(1) }, { merge: true });
    }
  });
}

/** Opens (or finds) the Deckmate game for a pending battle: the attacking house plays the officers. */
export async function startCampaignBattle(user: User, id: string, battleId: string): Promise<string> {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'games', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Diese Kampagne gibt es nicht mehr.');
    const g = snap.data() as CampaignDoc;
    if (!g.members.includes(user.uid)) throw new Error('Du spielst in dieser Kampagne nicht mit.');
    const c = JSON.parse(g.cstate) as Campaign;
    const b = c.battles.find((x) => x.id === battleId);
    if (!b) throw new Error('Diese Schlacht gibt es nicht mehr.');
    if (b.game) return b.game;
    const att = c.armies.find((a) => a.id === b.attacker)!, def = c.armies.find((a) => a.id === b.defender)!;
    const gref = doc(gamesCol);
    tx.set(gref, {
      name: `${g.name} · Runde ${c.round}: ${HOUSES[att.house].n} gegen ${HOUSES[def.house].n}`,
      createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), status: 'running',
      players: { O: g.players[att.house], M: g.players[def.house] },
      names: { O: `${g.names[att.house]} (${HOUSES[att.house].n})`, M: `${g.names[def.house]} (${HOUSES[def.house].n})` },
      members: g.members, state: battleGame(c, battleId, Math.random), campaign: { id, battle: battleId },
    });
    b.game = gref.id;
    tx.update(ref, { cstate: JSON.stringify(c), updatedAt: serverTimestamp() });
    return gref.id;
  });
}

export function watchGame(id: string, cb: (g: GameDoc | null) => void, onError: (e: Error) => void) {
  return onSnapshot(doc(db, 'games', id), (snap) => cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as GameDoc) : null), onError);
}

export async function joinGame(user: User, id: string): Promise<Side> {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'games', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Diese Partie gibt es nicht mehr.');
    const g = snap.data() as GameDoc;
    const mine = (['M', 'O'] as Side[]).find((s) => g.players[s] === user.uid);
    if (mine) return mine;
    const free = (['M', 'O'] as Side[]).find((s) => !g.players[s]);
    if (!free) throw new Error('Diese Partie ist bereits voll.');
    tx.update(ref, {
      [`players.${free}`]: user.uid, [`names.${free}`]: nameOf(user),
      members: [...g.members, user.uid], status: 'running', updatedAt: serverTimestamp(),
    });
    return free;
  });
}

/** Applies a player action inside a transaction, so two browsers can never write over each other. */
export async function sendAction(user: User, id: string, a: Action): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'games', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Diese Partie gibt es nicht mehr.');
    const g = snap.data() as GameDoc;
    const mySide = (['M', 'O'] as Side[]).find((s) => g.players[s] === user.uid);
    if (!mySide) throw new Error('Du spielst in dieser Partie nicht mit.');
    if (!g.players.M || !g.players.O) throw new Error('Warte, bis die Gegenseite beigetreten ist.');
    const actor = actorOf(g.state, a);
    if (actor && actor !== mySide) throw new Error('Du bist gerade nicht am Zug.');
    const next = act(g.state, a, Math.random);
    const update: { state: GameState; updatedAt: ReturnType<typeof serverTimestamp>; status?: string } = { state: next, updatedAt: serverTimestamp() };
    if (next.phase === 'over' && g.state.phase !== 'over') update.status = 'over';
    tx.update(ref, update);
    if (next.phase === 'over' && g.state.phase !== 'over' && next.winner && !g.campaign) {
      const winUid = g.players[next.winner], loseUid = g.players[opp(next.winner)];
      if (winUid) tx.set(doc(db, 'users', winUid), { wins: increment(1) }, { merge: true });
      if (loseUid) tx.set(doc(db, 'users', loseUid), { losses: increment(1) }, { merge: true });
    }
  });
}

export async function rematch(user: User, g: GameDoc): Promise<string> {
  const players = { M: g.players.O, O: g.players.M };
  const names = { M: g.names.O, O: g.names.M };
  const ref = await addDoc(gamesCol, {
    name: `${g.name} · Revanche`, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    status: players.M && players.O ? 'running' : 'open', players, names, members: g.members,
    state: newGame(Math.random),
  });
  return ref.id;
}

export const deleteGame = (id: string) => deleteDoc(doc(db, 'games', id));
export const renameGame = (id: string, name: string) => updateDoc(doc(db, 'games', id), { name });
