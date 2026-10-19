import {
  addDoc, collection, deleteDoc, doc, increment, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, updateDoc, where, type Timestamp,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase.ts';
import { act, actorOf, type Action } from './game/actions.ts';
import { newGame, opp, type GameState, type Side } from './game/rules.ts';

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
}

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

export function watchLobby(cb: (games: GameDoc[]) => void, onError: (e: Error) => void) {
  const q = query(gamesCol, where('status', 'in', ['open', 'running']), orderBy('createdAt', 'desc'), limit(40));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as GameDoc)), onError);
}

export function watchMyFinished(uid: string, cb: (games: GameDoc[]) => void) {
  const q = query(gamesCol, where('members', 'array-contains', uid), where('status', '==', 'over'), orderBy('createdAt', 'desc'), limit(10));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as GameDoc)), () => cb([]));
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
    if (next.phase === 'over' && g.state.phase !== 'over' && next.winner) {
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
