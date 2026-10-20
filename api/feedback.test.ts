import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST, toIssue, validate } from './feedback.ts';

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
    for (let i = 0; i < 5; i++) await POST(req({ rating: 5 }, '9.9.9.3'));
    assert.equal((await POST(req({ rating: 5 }, '9.9.9.3'))).status, 429);
  } finally { globalThis.fetch = orig; delete env.GITHUB_TOKEN; }
});
