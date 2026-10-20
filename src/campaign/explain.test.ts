import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, sealOrders, type Campaign, type Order } from './engine.ts';
import { explain } from './explain.ts';

const seal = (c: Campaign, r: Order[], k: Order[] = []) => sealOrders(sealOrders(c, 'R', r, () => 0.5), 'K', k, () => 0.5);

test('Wettlauf: Konflikt mit Stärken und Erklärung, Unterlegener kehrt um', () => {
  let c = newCampaign();
  c.armies.find((a) => a.id === 'a3')!.prov = 'sturmgrat';
  c.armies.find((a) => a.id === 'a3')!.size = 5;
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'mittelland' }], [{ kind: 'move', army: 'a3', to: 'mittelland' }]);
  assert.equal(c.conflicts?.length, 1);
  const e = explain(c.conflicts![0]);
  assert.equal(e.title, 'Wettlauf um Mittelland');
  assert.equal(e.winner, 'R');
  assert.match(e.result, /Kerrow kehrt nach Sturmgrat um/);
  assert.deepEqual(e.turnedBack, [{ army: 'a3', from: 'sturmgrat', to: 'mittelland' }]);
  assert.equal(e.ratio, '10 : 5 · 2-fach');
});

test('Angriff überrennt: Unterstützung, Verluste und Rückzug stehen in der Erklärung', () => {
  let c = newCampaign();
  const k = c.armies.find((a) => a.id === 'a4')!; k.prov = 'weidenau'; k.size = 5;
  c.owner.weidenau = 'K';
  c.armies.find((a) => a.id === 'a2')!.prov = 'rotmoor';
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'weidenau' }, { kind: 'support', army: 'a2', target: 'weidenau' }]);
  const e = explain(c.conflicts!.find((x) => x.kind === 'attack')!);
  assert.equal(e.winner, 'R');
  assert.match(e.sides[0].formula, /\+ 3 Unterstützung aus Rotmoor/);
  assert.match(e.result, /überrennt Weidenau/);
  assert.match(e.result, /Kerrow verliert 3 Figuren/);
});

test('Platztausch: beide prallen ab', () => {
  let c = newCampaign();
  c.armies.find((a) => a.id === 'a1')!.prov = 'mittelland';
  c.armies.find((a) => a.id === 'a3')!.prov = 'sturmgrat';
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'sturmgrat' }], [{ kind: 'move', army: 'a3', to: 'mittelland' }]);
  const e = explain(c.conflicts![0]);
  assert.equal(e.title, 'Zusammenstoß zwischen Mittelland und Sturmgrat');
  assert.equal(e.turnedBack.length, 2);
});
