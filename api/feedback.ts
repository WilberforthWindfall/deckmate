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
}

const MAX = 2000;
const WHERE: Record<string, string> = { lobby: 'Lobby', 'kampagne-ende': 'Ende der Kampagne', kampagne: 'Kampagne' };

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
    '\n_Über den Feedbackbogen im Spiel eingereicht._',
  ].filter(Boolean).join('\n');
  return { title: title.slice(0, 240), body, labels: ['feedback'] };
}

// Small in-memory brake per instance: at most 5 reports per address in 10 minutes.
const recent = new Map<string, number[]>();
function tooMany(ip: string, now = Date.now()) {
  const list = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  list.push(now);
  recent.set(ip, list);
  return list.length > 5;
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

  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO || 'WilberforthWindfall/deckmate';
  if (!token) return json(503, { error: 'Der Feedback-Briefkasten ist noch nicht eingerichtet (GITHUB_TOKEN fehlt).' });

  const issue = toIssue(x, { userAgent: request.headers.get('user-agent') ?? '' });
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'deckmate-feedback' },
    body: JSON.stringify(issue),
  });
  if (!res.ok) {
    console.error('[feedback] GitHub', res.status, await res.text().catch(() => ''));
    return json(502, { error: 'Das Feedback konnte gerade nicht gespeichert werden. Bitte später noch einmal versuchen.' });
  }
  const created = (await res.json()) as { number?: number };
  return json(201, { ok: true, number: created.number });
}
