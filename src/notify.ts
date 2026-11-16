import { collection, deleteField, doc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { auth, db } from './firebase.ts';

// "Your turn" push notifications through standard Web Push (see api/notify.ts and public/sw.js). They arrive even
// when Deckmate is closed. Phones without Google services (GrapheneOS) need a browser with UnifiedPush support such as
// IronFox or Fennec plus a distributor app like ntfy.
//
// This browser's subscription is written into every game the player is in (games/{id}.push.{uid}.{subId}), where the
// players of a game may already write. So no extra Firestore rules or server accounts are needed.

export type PushState =
  | 'unsupported' // browser has no Web Push
  | 'ios-home' // iPhone/iPad: only after "Add to Home Screen"
  | 'server' // not set up on the server
  | 'blocked' // permission denied
  | 'off' | 'on';
export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
export type PushMap = Record<string, Record<string, PushSub>>;

async function api<T = { ok: true }>(user: User, body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Das hat nicht geklappt (${res.status}).`);
  return data as T;
}

/**
 * After a change to a game: lets the server tell whoever has to act now. Fire and forget; the server decides who
 * that is and sends every situation only once, so calling this too often does no harm.
 */
export function pingTurn(gameId: string) {
  const user = auth.currentUser;
  if (!user) return;
  api(user, { op: 'turn', game: gameId }).catch(() => { /* notifications are a bonus, never block the game */ });
}

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

let reg: Promise<ServiceWorkerRegistration> | null = null;
const registration = () => (reg ??= navigator.serviceWorker.register('/sw.js'));

let info: Promise<{ ready: boolean; publicKey: string | null }> | null = null;
const serverInfo = () => (info ??= fetch('/api/notify').then((r) => (r.ok ? r.json() : { ready: false, publicKey: null })).catch(() => { info = null; return { ready: false, publicKey: null }; }));

const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
/** Same formula as subId in api/notify.ts. */
async function subId(endpoint: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return 's' + Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

/** This browser's active subscription, if notifications are on. */
async function current(): Promise<{ id: string; sub: PushSub } | null> {
  if (!supported() || Notification.permission !== 'granted') return null;
  try {
    const s = await (await registration()).pushManager.getSubscription();
    if (!s) return null;
    const j = s.toJSON() as PushSub;
    return j.endpoint && j.keys?.p256dh && j.keys.auth ? { id: await subId(j.endpoint), sub: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } } } : null;
  } catch { return null; }
}

/** For a new game document: this browser's subscription, so the first move can already notify. */
export async function myPush(uid: string): Promise<PushMap> {
  const c = await current();
  return c ? { [uid]: { [c.id]: c.sub } } : {};
}
/** Field updates that add this browser to an existing game (e.g. inside the join transaction). */
export async function myPushFields(uid: string): Promise<Record<string, PushSub>> {
  const c = await current();
  return c ? { [`push.${uid}.${c.id}`]: c.sub } : {};
}

/** When a game is opened: add this browser to it if it is missing (for example after switching devices). */
export async function ensurePush(uid: string, gameId: string, push: PushMap | undefined) {
  const c = await current();
  if (!c || push?.[uid]?.[c.id]?.endpoint === c.sub.endpoint) return;
  await updateDoc(doc(db, 'games', gameId), { [`push.${uid}.${c.id}`]: c.sub }).catch(() => {});
}

const myGames = (uid: string) => getDocs(query(collection(db, 'games'), where('members', 'array-contains', uid), limit(60)))
  .then((s) => s.docs.filter((d) => d.data().status !== 'over'))
  .catch(() => []);

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !standalone() ? 'ios-home' : 'unsupported';
  if (!(await serverInfo()).ready) return 'server';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  return (await current()) ? 'on' : 'off';
}

/** Asks for permission, subscribes this browser and adds it to all running games of the player. */
export async function enablePush(user: User): Promise<PushState> {
  const { publicKey } = await serverInfo();
  if (!publicKey) return 'server';
  const p = await Notification.requestPermission();
  if (p !== 'granted') return p === 'denied' ? 'blocked' : 'off';
  const r = await registration();
  let sub = await r.pushManager.getSubscription();
  // A subscription made with another server key cannot receive our messages.
  const own = sub?.options.applicationServerKey;
  if (sub && own && b64url(own) !== publicKey.replace(/=+$/, '')) { await sub.unsubscribe(); sub = null; }
  sub ??= await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await syncGames(user.uid);
  return 'on';
}

async function syncGames(uid: string) {
  const c = await current();
  if (!c) return;
  await Promise.all((await myGames(uid)).filter((d) => d.data().push?.[uid]?.[c.id]?.endpoint !== c.sub.endpoint)
    .map((d) => updateDoc(d.ref, { [`push.${uid}.${c.id}`]: c.sub }).catch(() => {})));
}

/** Removes this browser from the player's games and ends the subscription. */
export async function disablePush(user: User): Promise<PushState> {
  const c = await current();
  if (c) {
    await Promise.all((await myGames(user.uid)).filter((d) => d.data().push?.[user.uid]?.[c.id])
      .map((d) => updateDoc(d.ref, { [`push.${user.uid}.${c.id}`]: deleteField() }).catch(() => {})));
  }
  const s = await (await registration()).pushManager.getSubscription();
  await s?.unsubscribe().catch(() => {});
  return 'off';
}

export async function testPush(user: User) {
  const c = await current();
  if (!c) throw new Error('Auf diesem Gerät ist die Benachrichtigung aus.');
  await api(user, { op: 'test', sub: c.sub });
}

/**
 * On every start: brings this browser's subscription into all running games (push services renew subscriptions now
 * and then), so nobody has to switch notifications off and on again.
 */
export async function refreshPush(user: User) {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'deckmate-resubscribe') enablePush(user).catch(() => {}); });
    if ((await serverInfo()).ready) await syncGames(user.uid);
  } catch { /* ignore */ }
}
