// Vercel function: "your turn" push notifications through the browser's standard Web Push (with VAPID).
//
// Works in Chrome, Edge and Firefox on desktop and Android, in Safari on iPhone once Deckmate is on the home screen,
// and on phones without Google services (GrapheneOS) in browsers with UnifiedPush support such as IronFox or Fennec
// together with a distributor app like ntfy.
//
// No Firebase admin account and no new Firestore rules: the function talks to Firestore's REST API with the ID token
// of the player who calls it, so the existing rules apply. Each player's push subscriptions are stored in the game
// documents they play in (games/{id}.push.{uid}), where the players of the game may already write.
//
// Flow: after every move the browser calls POST /api/notify { op: 'turn', game } with its ID token. The function reads
// the game as that player, works out who has to act now (never trusting the browser) and sends each situation once.
//
// Environment:
//   VAPID_PRIVATE_KEY   the only setting. Create once with: npx web-push generate-vapid-keys (take the private key).
//                       Without it the feature stays hidden and everything else keeps working.
//   VAPID_SUBJECT       contact for push services, e.g. mailto:you@example.org (optional)
//   APP_URL             public address, e.g. https://deckmate.vercel.app (optional, default: origin of the request)
//   FIREBASE_PROJECT_ID (optional, default: deckmate-633e4)
//
// Kept in one file on purpose: Vercel compiles each function on its own.

import { createECDH, createHash } from 'node:crypto';

// ---------------------------------------------------------------- who has to act (pure)

type Seat = 'M' | 'O' | 'R' | 'K';
export interface Sub { endpoint: string; keys: { p256dh: string; auth: string } }
export interface GameLike {
  name?: string;
  kind?: string;
  members?: string[];
  players?: Partial<Record<Seat, string | null>>;
  state?: { phase?: string; turn?: string; moveNo?: number; winner?: string | null };
  cstate?: string;
  /** Push subscriptions per player and device (see subId). */
  push?: Record<string, Record<string, Sub>>;
  /** Last situation sent per player, see pending(). */
  pushSent?: Record<string, string>;
}
export interface Pending { uid: string; key: string; title: string; text: string }

const SIDE: Record<string, string> = { M: 'Mannschaft', O: 'Offiziere', R: 'Ravensmoor', K: 'Kerrow' };

/** Who has to do something in this game right now, with a key per situation (so it is sent only once) and the text. */
export function pending(g: GameLike): Pending[] {
  const name = g.name || 'Deckmate';
  const pl = g.players ?? {};
  const out: Pending[] = [];
  const add = (uid: string | null | undefined, key: string, text: string) => { if (uid) out.push({ uid, key, title: name, text }); };

  if (g.kind === 'kampagne') {
    if (!pl.R || !pl.K || !g.cstate) return out;
    let c: { phase?: string; round?: number; sealed?: Record<string, boolean>; winner?: string | null };
    try { c = JSON.parse(g.cstate); } catch { return out; }
    for (const h of ['R', 'K'] as const) {
      if (c.phase === 'orders' && !c.sealed?.[h]) add(pl[h], `befehle:${c.round}`, `Runde ${c.round}: Deine Befehle werden erwartet.`);
      else if (c.phase === 'battles') add(pl[h], `schlacht:${c.round}`, `Runde ${c.round}: Eine Schlacht wartet auf euch.`);
      else if (c.phase === 'over') add(pl[h], 'ende', c.winner ? `Die Kampagne ist beendet. ${SIDE[c.winner] ?? c.winner} gewinnt.` : 'Die Kampagne ist beendet.');
    }
    return out;
  }

  const st = g.state;
  if (!st || !pl.M || !pl.O) return out;
  if (st.phase === 'setup') {
    for (const s of ['M', 'O'] as const) add(pl[s], 'bereit', 'Beide Seiten sind da, die Partie kann beginnen.');
  } else if (st.phase === 'play' && (st.turn === 'M' || st.turn === 'O')) {
    add(pl[st.turn], `zug:${st.moveNo}:${st.turn}`, `Du bist am Zug (${SIDE[st.turn]}).`);
  } else if (st.phase === 'over') {
    for (const s of ['M', 'O'] as const) add(pl[s], 'ende', st.winner === s ? 'Gewonnen! Die Partie ist beendet.' : st.winner ? `Die Partie ist beendet, ${st.winner === 'M' ? 'die Mannschaft gewinnt' : 'die Offiziere gewinnen'}.` : 'Die Partie ist beendet.');
  }
  return out;
}

// ---------------------------------------------------------------- subscriptions (pure)

/** Same formula as in src/notify.ts: key of a device below push.{uid}. */
export const subId = (endpoint: string) => 's' + createHash('sha256').update(endpoint).digest('hex').slice(0, 20);

/**
 * Checks a PushSubscription from the browser. Endpoints can point to any push server (UnifiedPush users choose their
 * own), so only obvious local and private addresses are refused.
 */
export function checkSub(x: unknown): Sub | string {
  const s = x as Partial<Sub> | null;
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000) return 'Ungültiges Abo.';
  let u: URL;
  try { u = new URL(s.endpoint); } catch { return 'Ungültiges Abo.'; }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.username || u.password) return 'Das Abo braucht eine https-Adresse.';
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')
    || /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || h.includes(':') && (h === '::1' || /^f[cd]|^fe80:|^::ffff:/.test(h))) return 'Diese Push-Adresse ist nicht erlaubt.';
  const k = s.keys;
  const b64 = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9_\-+/=]+$/.test(v);
  if (!k || !b64(k.p256dh, 200) || !b64(k.auth, 100)) return 'Dem Abo fehlen die Schlüssel.';
  return { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

export const payload = (m: { title: string; text: string; url: string; tag: string }) => JSON.stringify({ title: m.title, body: m.text, url: m.url, tag: m.tag });

/** The public VAPID key follows from the private one, so only one value has to be set. */
export function vapidFrom(priv: string | undefined) {
  const p = priv?.trim();
  if (!p) return null;
  try {
    const e = createECDH('prime256v1');
    const raw = Buffer.from(p, 'base64url');
    if (raw.length !== 32) return null;
    e.setPrivateKey(raw);
    return { priv: p, pub: e.getPublicKey().toString('base64url') };
  } catch { return null; }
}

/** Reads the uid out of a Firebase ID token. Only trusted after Firestore has accepted the same token. */
export function uidOf(idToken: string): string | null {
  try {
    const p = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    const uid = p.user_id ?? p.sub;
    return typeof uid === 'string' && /^[A-Za-z0-9]{1,128}$/.test(uid) ? uid : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- Firestore REST (pure helpers)

type FsValue = Record<string, unknown>;
/** Firestore REST value → plain JS. */
export function fromFs(v: FsValue | undefined): unknown {
  if (!v) return undefined;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(fromFs);
  if ('mapValue' in v) return fromFsFields((v.mapValue as { fields?: Record<string, FsValue> }).fields);
  return undefined;
}
export const fromFsFields = (f: Record<string, FsValue> = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromFs(v)]));
/** Plain strings and maps of strings → Firestore REST value (all this function ever writes). */
export function toFs(v: unknown): FsValue {
  if (typeof v === 'string') return { stringValue: v };
  if (v && typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
  return { nullValue: null };
}
/** Field path for updateMask: segments that are not plain identifiers go in backticks. */
export const fieldPath = (...parts: string[]) => parts.map((p) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : '`' + p.replace(/[`\\]/g, '\\$&') + '`')).join('.');

// ---------------------------------------------------------------- environment and I/O

type Env = Record<string, string | undefined>;
declare const process: { env: Env } | undefined;
const readEnv = (): Env => { try { return (typeof process !== 'undefined' && process.env) || {}; } catch { return {}; } };
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const appUrl = (env: Env, request: Request) => (env.APP_URL?.trim() || new URL(request.url).origin).replace(/\/+$/, '');
const docUrl = (env: Env, path: string) => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID?.trim() || 'deckmate-633e4'}/databases/(default)/documents/${path}`;

/** Reads a document as the calling player. null: missing or not allowed. */
async function readDoc(env: Env, token: string, path: string) {
  const res = await fetch(docUrl(env, path), { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return { status: res.status, data: null, updateTime: '' };
  const d = (await res.json()) as { fields?: Record<string, FsValue>; updateTime: string };
  return { status: 200, data: fromFsFields(d.fields), updateTime: d.updateTime };
}

/** Sets (or, with undefined, deletes) single fields as the calling player. With updateTime only if nobody wrote in between. */
async function patchDoc(env: Env, token: string, path: string, changes: [string[], unknown][], updateTime?: string) {
  const q = new URLSearchParams();
  for (const [p] of changes) q.append('updateMask.fieldPaths', fieldPath(...p));
  if (updateTime) q.set('currentDocument.updateTime', updateTime);
  // Nested values: build the map shape the mask points into.
  const fields: Record<string, unknown> = {};
  for (const [p, v] of changes) {
    if (v === undefined) continue;
    let o = fields;
    p.slice(0, -1).forEach((k) => { o = (o[k] ??= {}) as Record<string, unknown>; });
    o[p[p.length - 1]] = v;
  }
  const res = await fetch(`${docUrl(env, path)}?${q}`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toFs(v)])) }),
  });
  return res.ok;
}

/** Sends to the given devices; returns how many accepted it and which ones the push service has dropped for good. */
async function deliver(env: Env, subs: Record<string, Sub>, body: string) {
  const v = vapidFrom(env.VAPID_PRIVATE_KEY)!;
  const wp = (await import('web-push')).default;
  const gone: string[] = [];
  let ok = 0;
  await Promise.all(Object.entries(subs).map(async ([id, s]) => {
    try {
      await wp.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
        vapidDetails: { subject: env.VAPID_SUBJECT?.trim() || 'mailto:deckmate@example.org', publicKey: v.pub, privateKey: v.priv },
        TTL: 24 * 3600, urgency: 'high', timeout: 8000,
      });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(id);
      else console.error('[notify]', code, (e as Error).message);
    }
  }));
  return { ok, gone };
}

// Small brake per instance: a player cannot fire more than 30 requests a minute.
const recent = new Map<string, number[]>();
function tooMany(key: string, max = 30, now = Date.now()) {
  const list = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(key, list);
  return list.length > max;
}

// ---------------------------------------------------------------- HTTP

/** Whether push is set up, and the public VAPID key the browser needs to subscribe. */
export async function GET(): Promise<Response> {
  const v = vapidFrom(readEnv().VAPID_PRIVATE_KEY);
  return json(200, { ready: !!v, publicKey: v?.pub ?? null });
}

interface Body { op?: string; game?: string; sub?: unknown }

export async function POST(request: Request): Promise<Response> {
  const env = readEnv();
  let x: Body;
  try { x = await request.json(); } catch { return json(400, { error: 'Ungültige Anfrage.' }); }
  if (!vapidFrom(env.VAPID_PRIVATE_KEY)) return json(503, { error: 'Push ist auf dem Server noch nicht eingerichtet (VAPID_PRIVATE_KEY fehlt).' });
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const uid = uidOf(token);
  if (!uid) return json(401, { error: 'Bitte melde dich neu an.' });
  if (tooMany(uid)) return json(429, { error: 'Zu viele Anfragen, bitte kurz warten.' });
  const base = appUrl(env, request);

  if (x.op === 'test') {
    // Proves the token by reading the player's own profile, then sends to the device that asked.
    const me = await readDoc(env, token, `users/${uid}`);
    if (me.status === 401 || me.status === 403) return json(401, { error: 'Bitte melde dich neu an.' });
    const s = checkSub(x.sub);
    if (typeof s === 'string') return json(400, { error: s });
    const r = await deliver(env, { [subId(s.endpoint)]: s }, payload({ title: 'Deckmate', text: 'Probe: So sieht es aus, wenn du am Zug bist. ⚓', url: base + '/', tag: 'deckmate-probe' }));
    return r.ok ? json(200, { ok: true }) : json(502, { error: 'Die Probe kam nicht an. Schalte die Benachrichtigung aus und wieder ein.' });
  }

  if (x.op !== 'turn') return json(400, { error: 'Unbekannte Aktion.' });
  if (typeof x.game !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(x.game)) return json(400, { error: 'Ungültige Partie.' });
  const path = `games/${x.game}`;
  const doc = await readDoc(env, token, path);
  if (doc.status === 401 || doc.status === 403) return json(401, { error: 'Bitte melde dich neu an.' });
  const g = doc.data as GameLike | null;
  if (!g || !g.members?.includes(uid)) return json(404, { error: 'Partie nicht gefunden.' });

  const todo = pending(g).filter((p) => p.uid !== uid && g.pushSent?.[p.uid] !== p.key && Object.keys(g.push?.[p.uid] ?? {}).length);
  if (!todo.length) return json(200, { ok: true, sent: 0 });
  // Claim the situations first, only if the game did not change since reading: two quick requests never send twice.
  if (!(await patchDoc(env, token, path, todo.map((p) => [['pushSent', p.uid], p.key]), doc.updateTime))) return json(200, { ok: true, sent: 0, busy: true });

  const url = base + (g.kind === 'kampagne' ? `/kampagne/${x.game}` : `/spiel/${x.game}`);
  let sent = 0;
  const gone: [string[], undefined][] = [];
  for (const p of todo) {
    const r = await deliver(env, g.push![p.uid], payload({ title: p.title, text: p.text, url, tag: `deckmate-${x.game}` }));
    if (r.ok) sent++;
    for (const id of r.gone) gone.push([['push', p.uid, id], undefined]);
  }
  if (gone.length) await patchDoc(env, token, path, gone).catch(() => {});
  return json(200, { ok: true, sent });
}
