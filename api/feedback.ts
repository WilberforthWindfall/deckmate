// Vercel function: POST /api/feedback → GitHub issue with the label "feedback".
// Needs the environment variable GITHUB_TOKEN (fine-grained token, only this repository, permission "Issues: Read and write").
// Optional: GITHUB_REPO (default WilberforthWindfall/deckmate).

export interface FeedbackInput {
  rating?: number | null;
  liked?: string;
  disliked?: string;
  wish?: string;
  name?: string;
  /** Where the form was sent from, e.g. "lobby" or "kampagne-ende". */
  where?: string;
  /** Extra facts from the page (round, score, winner …). */
  context?: Record<string, string | number | boolean | null>;
  /** Honeypot: real people leave this empty. */
  website?: string;
  /** Snapshot of a running board game, so the report can be retraced move by move. */
  game?: GameSnapshot;
}

export interface GameSnapshot {
  /** Full protocol, oldest line first. */
  record?: string[];
  /** Board as text diagram (rank 8 on top). */
  board?: string;
  /** Complete game state as JSON, to load the exact position again. */
  state?: string;
}

const MAX = 2000;
const WHERE: Record<string, string> = { lobby: 'Lobby', 'kampagne-ende': 'Ende der Kampagne', kampagne: 'Kampagne', partie: 'Partie', schlacht: 'Schlacht', lokal: 'Partie an einem Gerät' };

const clean = (s: unknown, max = MAX) => (typeof s === 'string' ? s.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
/** Keep @mentions and #references in tester text from pinging people or linking issues. */
const defuse = (s: string) => s.replace(/@/g, '@​').replace(/(^|\s)#(\d)/g, '$1#​$2');
const quote = (s: string) => defuse(s).split('\n').map((l) => `> ${l}`).join('\n');

export function validate(x: FeedbackInput): string {
  if (x.website) return 'spam';
  const r = x.rating;
  if (r != null && !(Number.isInteger(r) && r >= 1 && r <= 5)) return 'Die Bewertung muss zwischen 1 und 5 liegen.';
  if (!r && !clean(x.liked) && !clean(x.disliked) && !clean(x.wish)) return 'Bitte gib eine Bewertung oder einen Text ein.';
  return '';
}

export function toIssue(x: FeedbackInput, meta: { userAgent?: string; now?: Date } = {}) {
  const where = WHERE[clean(x.where, 40)] ?? (clean(x.where, 40) || 'unbekannt');
  const stars = x.rating ? '★'.repeat(x.rating) + '☆'.repeat(5 - x.rating) : '';
  const first = clean(x.wish) || clean(x.disliked) || clean(x.liked);
  const teaser = first ? ` · ${defuse(first.split('\n')[0]).slice(0, 60)}${first.length > 60 ? '…' : ''}` : '';
  const title = `Feedback${stars ? ` ${stars}` : ''} · ${where}${teaser}`;

  const sec = (h: string, t: string) => (t ? `### ${h}\n${quote(t)}\n` : '');
  const ctx = Object.entries(x.context ?? {}).filter(([, v]) => v !== null && v !== '' && v !== undefined).slice(0, 20);
  const rows = [
    ['Bereich', where],
    ['Bewertung', stars ? `${stars} (${x.rating}/5)` : '–'],
    ['Name', defuse(clean(x.name, 60)) || '–'],
    ...ctx.map(([k, v]) => [defuse(clean(k, 40)), defuse(clean(String(v), 200))]),
    ['Zeit', (meta.now ?? new Date()).toISOString()],
    ['Browser', defuse(clean(meta.userAgent, 200)) || '–'],
  ];
  const body = [
    sec('Was hat gefallen?', clean(x.liked)),
    sec('Was hat genervt oder war unklar?', clean(x.disliked)),
    sec('Was wünschst du dir?', clean(x.wish)),
    '| | |\n|---|---|\n' + rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`).join('\n'),
    gameSection(x.game),
    '\n_Über den Feedbackbogen im Spiel eingereicht._',
  ].filter(Boolean).join('\n');
  return { title: title.slice(0, 240), body, labels: ['feedback'] };
}

const fence = (t: string) => '```text\n' + t.replace(/```/g, "'''") + '\n```';

/** Board, numbered protocol and raw state of the game the feedback refers to. Fits into GitHub's 65 536 characters. */
export function gameSection(g?: GameSnapshot): string {
  if (!g) return '';
  const lines = Array.isArray(g.record) ? g.record.filter((l) => typeof l === 'string').slice(-400).map((l) => clean(l, 200)) : [];
  const board = clean(g.board, 1200);
  const state = typeof g.state === 'string' ? g.state.slice(0, 30000) : '';
  const parts = ['\n### Spielstand beim Feedback'];
  if (board) parts.push(fence(board));
  if (lines.length) parts.push(`<details><summary>Zughistorie (${lines.length} Einträge)</summary>\n\n${fence(lines.map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join('\n'))}\n</details>`);
  if (state) parts.push(`<details><summary>Spielzustand (JSON, zum Nachstellen)</summary>\n\n${fence(state)}\n</details>`);
  return parts.length > 1 ? parts.join('\n\n') : '';
}

// Small in-memory brake per instance: at most 5 reports per address in 10 minutes.
const recent = new Map<string, number[]>();
function tooMany(ip: string, now = Date.now()) {
  const list = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  list.push(now);
  recent.set(ip, list);
  return list.length > 5;
}

type Env = Record<string, string | undefined>;
// Node functions on Vercel expose the variables on process.env.
const readEnv = (): Env => {
  try { return (typeof process !== 'undefined' && process.env) || {}; } catch { return {}; }
};
declare const process: { env: Env } | undefined;

/** Facts about the setup without revealing any value: is the token there, which environment, which commit, similar names. */
export function diagnose(env: Env = readEnv()) {
  const token = env.GITHUB_TOKEN?.trim();
  return {
    configured: !!token,
    tokenLooksLike: !token ? 'fehlt' : token.startsWith('github_pat_') ? 'fein granularer Token' : token.startsWith('ghp_') ? 'klassischer Token' : 'unbekanntes Format',
    environment: env.VERCEL_ENV ?? 'unbekannt',
    commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unbekannt',
    repo: env.GITHUB_REPO || 'WilberforthWindfall/deckmate',
    similarNames: Object.keys(env).filter((k) => /git|token|hub/i.test(k) && !k.startsWith('VERCEL_')).sort(),
  };
}

export async function GET(): Promise<Response> {
  return json(200, diagnose());
}

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function POST(request: Request): Promise<Response> {
  let x: FeedbackInput;
  try { x = await request.json(); } catch { return json(400, { error: 'Ungültige Anfrage.' }); }
  const problem = validate(x ?? {});
  if (problem === 'spam') return json(200, { ok: true });
  if (problem) return json(400, { error: problem });
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unbekannt';
  if (tooMany(ip)) return json(429, { error: 'Danke! Du hast gerade schon mehrfach Feedback geschickt, bitte versuch es in ein paar Minuten noch einmal.' });

  const env = readEnv();
  const token = env.GITHUB_TOKEN?.trim();
  const repo = env.GITHUB_REPO || 'WilberforthWindfall/deckmate';
  if (!token) {
    const d = diagnose(env);
    return json(503, {
      error: `Der Feedback-Briefkasten ist noch nicht eingerichtet (GITHUB_TOKEN fehlt in der Umgebung „${d.environment}“, Stand ${d.commit}${d.similarNames.length ? `; gefundene ähnliche Namen: ${d.similarNames.join(', ')}` : ''}).`,
      diagnose: d,
    });
  }

  const issue = toIssue(x, { userAgent: request.headers.get('user-agent') ?? '' });
  const gh = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'deckmate-feedback' };
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: { ...gh, 'content-type': 'application/json' },
    body: JSON.stringify(issue),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[feedback] GitHub', res.status, text);
    const hint = res.status === 401 ? 'Der Token wird von GitHub abgelehnt (abgelaufen oder falsch kopiert).'
      : res.status === 403 || res.status === 404 ? 'Der Token darf in diesem Repository keine Issues anlegen (Repository-Zugriff oder Berechtigung „Issues: Read and write“ prüfen).'
      : '';
    return json(502, { error: `Das Feedback konnte gerade nicht gespeichert werden (GitHub ${res.status}).${hint ? ` ${hint}` : ' Bitte später noch einmal versuchen.'}` });
  }
  const created = (await res.json()) as { number?: number; labels?: { name: string }[] };
  // GitHub silently drops labels on create unless the token has push access; with "Issues" alone they can be added afterwards.
  if (created.number && !created.labels?.some((l) => l.name === 'feedback')) {
    await fetch(`https://api.github.com/repos/${repo}/issues/${created.number}/labels`, {
      method: 'POST', headers: { ...gh, 'content-type': 'application/json' }, body: JSON.stringify({ labels: issue.labels }),
    }).catch((e) => console.error('[feedback] Label', e));
  }
  return json(201, { ok: true, number: created.number });
}
