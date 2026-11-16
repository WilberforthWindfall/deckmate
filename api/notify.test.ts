import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { checkSub, fieldPath, fromFsFields, payload, pending, subId, toFs, uidOf, vapidFrom, type Sub } from './notify.ts';

const game = (state: object) => ({ name: 'Testpartie', members: ['a', 'b'], players: { M: 'a', O: 'b' }, state });

test('Partie: wer am Zug ist, bekommt genau eine Meldung pro Zug', () => {
  assert.deepEqual(pending(game({ phase: 'play', turn: 'O', moveNo: 7 })), [{ uid: 'b', key: 'zug:7:O', title: 'Testpartie', text: 'Du bist am Zug (Offiziere).' }]);
  assert.equal(pending(game({ phase: 'play', turn: 'M', moveNo: 8 }))[0].key, 'zug:8:M');
  assert.deepEqual(pending({ ...game({ phase: 'play', turn: 'M', moveNo: 1 }), players: { M: 'a', O: null } }), []);
});

test('Partie: Beitritt und Ende melden beiden Seiten', () => {
  assert.deepEqual(pending(game({ phase: 'setup' })).map((p) => [p.uid, p.key]), [['a', 'bereit'], ['b', 'bereit']]);
  const over = pending(game({ phase: 'over', winner: 'M' }));
  assert.match(over[0].text, /Gewonnen/);
  assert.match(over[1].text, /Mannschaft gewinnen/);
});

test('Kampagne: Befehle nur an das Haus, das noch nicht versiegelt hat', () => {
  const c = (s: object) => ({ kind: 'kampagne', name: 'K1', members: ['a', 'b'], players: { R: 'a', K: 'b' }, cstate: JSON.stringify(s) });
  assert.deepEqual(pending(c({ phase: 'orders', round: 3, sealed: { R: true, K: false } })).map((p) => [p.uid, p.key]), [['b', 'befehle:3']]);
  assert.equal(pending(c({ phase: 'battles', round: 3, sealed: {} })).length, 2);
  assert.match(pending(c({ phase: 'over', winner: 'K' }))[0].text, /Kerrow gewinnt/);
  assert.deepEqual(pending({ ...c({}), cstate: 'kaputt' }), []);
});

const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

test('Abo: echte Push-Dienste und UnifiedPush-Server ja, lokale Adressen nein', () => {
  for (const e of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://ntfy.sh/upAbC123?up=1', 'https://web.push.apple.com/Q']) {
    assert.equal(typeof checkSub({ endpoint: e, keys }), 'object', e);
  }
  for (const e of ['http://ntfy.sh/up', 'https://localhost/x', 'https://127.0.0.1/x', 'https://192.168.1.5/x', 'https://[::1]/x', 'https://intranet/x', 'https://10.0.0.1/']) {
    assert.equal(typeof checkSub({ endpoint: e, keys }), 'string', e);
  }
  assert.match(checkSub({ endpoint: 'https://ntfy.sh/up' }) as string, /Schlüssel/);
  assert.match(checkSub(null) as string, /Ungültig/);
  const s = checkSub({ endpoint: 'https://ntfy.sh/up', keys: { ...keys, extra: 1 }, evil: true }) as Sub;
  assert.deepEqual(Object.keys(s), ['endpoint', 'keys']);
});

test('Abo-Kennung: stabil, gültiger Feldname, gleich wie im Browser', () => {
  const id = subId('https://p.example/1');
  assert.match(id, /^s[0-9a-f]{20}$/);
  assert.equal(id, subId('https://p.example/1'));
  assert.notEqual(id, subId('https://p.example/2'));
});

test('VAPID: öffentlicher Schlüssel folgt aus dem privaten', () => {
  const e = createECDH('prime256v1'); e.generateKeys();
  const v = vapidFrom(e.getPrivateKey('base64url'));
  assert.equal(v?.pub, e.getPublicKey('base64url'));
  assert.equal(vapidFrom(''), null);
  assert.equal(vapidFrom('kaputt'), null);
});

test('Token: uid aus dem ID-Token, Unsinn ergibt null', () => {
  const tok = (p: object) => `x.${Buffer.from(JSON.stringify(p)).toString('base64url')}.y`;
  assert.equal(uidOf(tok({ user_id: 'Abc123' })), 'Abc123');
  assert.equal(uidOf(tok({ sub: 'Q9' })), 'Q9');
  assert.equal(uidOf(tok({ user_id: '../evil' })), null);
  assert.equal(uidOf('quatsch'), null);
});

test('Firestore REST: Werte lesen, Felder schreiben, Pfade quoten', () => {
  const g = fromFsFields({
    name: { stringValue: 'P' }, members: { arrayValue: { values: [{ stringValue: 'a' }] } },
    state: { mapValue: { fields: { moveNo: { integerValue: '7' }, winner: { nullValue: null }, phase: { stringValue: 'play' } } } },
    push: { mapValue: { fields: { a: { mapValue: { fields: { s1: { mapValue: { fields: { endpoint: { stringValue: 'https://e' } } } } } } } } } },
  });
  assert.deepEqual(g, { name: 'P', members: ['a'], state: { moveNo: 7, winner: null, phase: 'play' }, push: { a: { s1: { endpoint: 'https://e' } } } });
  assert.deepEqual(toFs({ x: 'y' }), { mapValue: { fields: { x: { stringValue: 'y' } } } });
  assert.equal(fieldPath('pushSent', 'Abc'), 'pushSent.Abc');
  assert.equal(fieldPath('push', '9xY', 's1'), 'push.`9xY`.s1');
});

test('Nachricht: Titel, Text, Ziel und Tag landen im Payload', () => {
  assert.deepEqual(JSON.parse(payload({ title: 'Partie Ä', text: 'Du bist dran', url: 'https://x.app/spiel/1', tag: 'deckmate-1' })), { title: 'Partie Ä', body: 'Du bist dran', url: 'https://x.app/spiel/1', tag: 'deckmate-1' });
});
