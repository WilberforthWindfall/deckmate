import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST, diagnose, gameSection, toIssue, validate } from './feedback.ts';

const req = (body: unknown, ip = '1.2.3.4') => new Request('http://x/api/feedback', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip, 'user-agent': 'Test' } });
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

test('Prüfung: leer abgelehnt, Honigtopf still verworfen, Bewertung 1–5', () => {
  assert.match(validate({}), /Bewertung oder einen Text/);
  assert.equal(validate({ website: 'spam.example', rating: 5 }), 'spam');
  assert.match(validate({ rating: 9 }), /zwischen 1 und 5/);
  assert.equal(validate({ wish: 'Mehr Häuser' }), '');
});

test('Issue: Titel mit Sternen und Bereich, Erwähnungen entschärft, Zusatzinfos als Tabelle', () => {
  const i = toIssue({ rating: 4, wish: 'Flotten bitte @alle #3', where: 'kampagne-ende', context: { Runde: 7, Sieger: 'Kerrow' } }, { now: new Date('2026-10-20T07:00:00Z') });
  assert.equal(i.labels[0], 'feedback');
  assert.match(i.title, /^Feedback ★★★★☆ · Ende der Kampagne · Flotten bitte/);
  assert.ok(!i.body.includes('@alle'));
  assert.ok(!/#3\b/.test(i.body));
  assert.match(i.body, /\| Runde \| 7 \|/);
  assert.match(i.body, /### Was wünschst du dir\?/);
});

test('POST: ohne Token klare Meldung, mit Token wird bei GitHub angelegt', async () => {
  delete env.GITHUB_TOKEN;
  let r = await POST(req({ rating: 3 }, '9.9.9.1'));
  assert.equal(r.status, 503);

  env.GITHUB_TOKEN = 'test-token';
  const calls: { url: string; init: RequestInit }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ number: 42 }), { status: 201 }); }) as typeof fetch;
  try {
    r = await POST(req({ rating: 5, liked: 'Die Karte' }, '9.9.9.2'));
    assert.equal(r.status, 201);
    assert.equal((await r.json()).number, 42);
    assert.equal(calls[0].url, 'https://api.github.com/repos/WilberforthWindfall/deckmate/issues');
    assert.match(String((calls[0].init.headers as Record<string, string>).authorization), /Bearer test-token/);
    assert.equal(calls[1].url, 'https://api.github.com/repos/WilberforthWindfall/deckmate/issues/42/labels');
    calls.length = 0;
    for (let i = 0; i < 5; i++) await POST(req({ rating: 5 }, '9.9.9.3'));
    assert.equal((await POST(req({ rating: 5 }, '9.9.9.3'))).status, 429);
  } finally { globalThis.fetch = orig; delete env.GITHUB_TOKEN; }
});

test('Selbstauskunft: zeigt nur, ob der Token da ist, nie den Wert', () => {
  const d = diagnose({ GITHUB_TOKEN: 'github_pat_geheim', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abcdef123', GITHUB_TOKEN_X: '1', PATH: '/bin' });
  assert.equal(d.configured, true);
  assert.equal(d.tokenLooksLike, 'fein granularer Token');
  assert.equal(d.environment, 'production');
  assert.equal(d.commit, 'abcdef1');
  assert.deepEqual(d.similarNames, ['GITHUB_TOKEN', 'GITHUB_TOKEN_X']);
  assert.ok(!JSON.stringify(d).includes('geheim'));
  assert.equal(diagnose({ 'GITHUB_TOKEN ': 'x' }).configured, false);
});

test('Spielstand: Brett, nummerierte Zughistorie und Zustand landen im Issue', () => {
  const i = toIssue({ disliked: 'Stein durfte weiterschlagen', where: 'partie', game: { board: '8 . . K', record: ['Neue Partie.', '1. Mannschaftsstein a6 → c8'], state: '{"v":3}' } });
  assert.match(i.title, /Partie/);
  assert.match(i.body, /### Spielstand beim Feedback/);
  assert.match(i.body, /  2  1\. Mannschaftsstein a6 → c8/);
  assert.match(i.body, /Zughistorie \(2 Einträge\)/);
  assert.match(i.body, /\{"v":3\}/);
  assert.equal(gameSection(undefined), '');
  assert.ok(i.body.length < 65536);
});
