import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armyById, newCampaign, sealOrders, type Campaign, type Order } from './engine.ts';
import { explain } from './explain.ts';

const seal = (c: Campaign, r: Order[], k: Order[] = []) => sealOrders(sealOrders(c, 'R', r, () => 0.5), 'K', k, () => 0.5);
const put = (c: Campaign, id: string, hex: string, size?: number) => { const a = armyById(c, id)!; a.hex = hex; if (size) a.size = size; };

test('Wettlauf: Felder, Schritt, Stärken; Unterlegener bleibt stehen und kehrt sichtbar um', () => {
  let c = newCampaign();
  put(c, 'a3', '8,5', 5);
  c = seal(c, [{ kind: 'move', army: 'a1', path: ['6,5', '7,5'] }], [{ kind: 'move', army: 'a3', path: ['8,4', '7,5'] }]);
  const e = explain(c.conflicts![0]);
  assert.equal(e.title, 'Wettlauf um Mittelland');
  assert.equal(e.step, 2);
  assert.equal(e.winner, 'R');
  assert.match(e.result, /im selben Schritt \(2\)/);
  assert.match(e.result, /Kerrow bleibt bei Mittelland stehen/);
  assert.deepEqual(e.turnedBack, [{ army: 'a3', from: '8,4', to: '7,5' }]);
  assert.equal(e.ratio, '10 : 5 · 2-fach');
});

test('Angriff: Unterstützung, Gelände, Verluste und Rückzug stehen in der Erklärung', () => {
  let c = newCampaign();
  put(c, 'a4', '7,5', 6); put(c, 'a2', '7,6');
  c = seal(c, [{ kind: 'move', army: 'a1', path: ['6,5', '7,5'] }, { kind: 'support', army: 'a2', target: '7,5' }]);
  const e = explain(c.conflicts!.find((x) => x.kind === 'attack')!);
  assert.equal(e.winner, 'R');
  assert.match(e.sides[0].formula, /\+ 3 Unterstützung von Mittelland/);
  assert.match(e.result, /überrennt Mittelland \(Flussland\)/);
  assert.match(e.result, /Kerrow verliert 3 Figuren und zieht sich nach/);
});

test('Begegnung beim Platztausch zeigt beide Felder', () => {
  let c = newCampaign();
  put(c, 'a1', '7,5'); put(c, 'a3', '8,5', 10);
  c = seal(c, [{ kind: 'move', army: 'a1', path: ['8,5'] }], [{ kind: 'move', army: 'a3', path: ['7,5'] }]);
  const e = explain(c.conflicts![0]);
  assert.match(e.title, /Feldschlacht bei/);
  assert.ok(e.hex2 && e.hex2 !== e.hex);
});
