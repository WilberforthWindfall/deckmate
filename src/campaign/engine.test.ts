import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBattle, armyAt, autoBattle, battleGame, movePreview, newCampaign, orderProblem, sealOrders, type Campaign } from './engine.ts';
import { ADJ } from './map.ts';

const rng = () => 0.42;
const seal = (c: Campaign, r: Parameters<typeof sealOrders>[2], k: Parameters<typeof sealOrders>[2] = []) => sealOrders(sealOrders(c, 'R', r, rng), 'K', k, rng);

test('Karte: Provinzen sind zusammenhängend, Hauptstädte drei Schritte auseinander', () => {
  assert.ok(ADJ.aldfurt.includes('mittelland'));
  assert.ok(ADJ.mittelland.includes('sturmgrat'));
  assert.ok(ADJ.sturmgrat.includes('kapostra'));
  assert.ok(!ADJ.aldfurt.includes('kapostra'));
});

test('Befehle reihum: erst wenn beide versiegelt haben, wird aufgelöst', () => {
  let c = newCampaign();
  c = sealOrders(c, 'R', [{ kind: 'move', army: 'a1', to: 'mittelland' }], rng);
  assert.equal(c.phase, 'orders');
  assert.equal(c.current, 'K');
  assert.equal(armyAt(c, 'aldfurt')?.id, 'a1');
  c = sealOrders(c, 'K', [], rng);
  assert.equal(armyAt(c, 'mittelland')?.id, 'a1');
  assert.equal(c.owner.mittelland, 'R');
  assert.equal(c.round, 2);
});

test('Befehlsprüfung: nur Nachbarn, Gold für Rekruten, drei Befehle', () => {
  const c = newCampaign();
  assert.match(orderProblem(c, 'R', { kind: 'move', army: 'a1', to: 'kapostra' }, []), /Nachbarprovinz/);
  assert.match(orderProblem(c, 'R', { kind: 'move', army: 'a3', to: 'sturmgrat' }, []), /kein Heer/);
  assert.equal(orderProblem(c, 'R', { kind: 'recruit', prov: 'aldfurt' }, []), '');
  assert.match(orderProblem(c, 'R', { kind: 'recruit', prov: 'suedhafen' }, [{ kind: 'recruit', prov: 'aldfurt' }]), /Gold/);
  assert.match(orderProblem(c, 'R', { kind: 'forage', army: 'a2' }, [{ kind: 'forage', army: 'a1' }, { kind: 'recruit', prov: 'aldfurt' }, { kind: 'move', army: 'a2', to: 'westmark' }]), /3 Befehle/);
});

test('Knapper Wettlauf ins selbe Feld: Feldschlacht, das stärkere Heer führt die Offiziere', () => {
  let c = newCampaign();
  const k = c.armies.find((a) => a.id === 'a3')!; k.prov = 'sturmgrat'; k.size = 8;
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'mittelland' }], [{ kind: 'move', army: 'a3', to: 'mittelland' }]);
  assert.equal(c.phase, 'battles');
  const b = c.battles[0];
  assert.equal(b.field, true);
  assert.equal(b.attacker, 'a1');
  assert.equal(b.defFrom, 'sturmgrat');
  assert.match(c.report.join(' '), /Feldschlacht/);
  // Kerrow wins the field battle: it takes Mittelland, Ravensmoor turns back to Aldfurt
  c = applyBattle(c, b.id, { attackerWon: false, attacker: { size: 6, spec: { CAP: 1, KAP: 1, KAN: 0, MAR: 0 } }, defender: { size: 5 }, retreat: false, how: 'ausgewürfelt' });
  assert.equal(armyAt(c, 'mittelland')?.id, 'a3');
  assert.equal(armyAt(c, 'aldfurt')?.id, 'a1');
  assert.equal(c.owner.mittelland, 'K');
});

test('Gleich starker Wettlauf: der Würfel bestimmt die Offiziere', () => {
  let c = newCampaign();
  c.armies.find((a) => a.id === 'a3')!.prov = 'sturmgrat';
  c = sealOrders(sealOrders(c, 'R', [{ kind: 'move', army: 'a1', to: 'mittelland' }], () => 0.9), 'K', [{ kind: 'move', army: 'a3', to: 'mittelland' }], () => 0.9);
  assert.equal(c.battles[0].attacker, 'a3');
});

test('Klare Übermacht mit Unterstützung gewinnt automatisch, knapp führt zur Schlacht', () => {
  let c = newCampaign();
  const k = c.armies.find((a) => a.id === 'a4')!; k.prov = 'weidenau'; k.size = 5;
  c.owner.weidenau = 'K';
  c.armies.find((a) => a.id === 'a2')!.prov = 'rotmoor';
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'weidenau' }, { kind: 'support', army: 'a2', target: 'weidenau' }]);
  assert.equal(c.owner.weidenau, 'R');
  assert.match(c.report.join(' '), /überrennt Weidenau/);

  let d = newCampaign();
  const k2 = d.armies.find((a) => a.id === 'a4')!; k2.prov = 'weidenau'; k2.size = 9;
  d = seal(d, [{ kind: 'move', army: 'a1', to: 'weidenau' }]);
  assert.equal(d.phase, 'battles');
  assert.equal(d.battles.length, 1);
  const g = battleGame(d, d.battles[0].id, Math.random);
  assert.equal(g.battle?.attacker.house, 'Ravensmoor');
  assert.equal(g.battle?.defender.house, 'Kerrow');
});

test('Schlacht-Ergebnis: Sieger zieht ein, Verlierer weicht zurück, dann neue Runde', () => {
  let c = newCampaign();
  const k = c.armies.find((a) => a.id === 'a4')!; k.prov = 'weidenau'; k.size = 9; c.owner.weidenau = 'K';
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'weidenau' }]);
  const id = c.battles[0].id;
  c = applyBattle(c, id, { attackerWon: true, attacker: { size: 7, spec: { CAP: 1, KAP: 1, KAN: 0, MAR: 0 } }, defender: { size: 4 }, retreat: false, how: 'auf dem Brett' });
  assert.equal(armyAt(c, 'weidenau')?.house, 'R');
  assert.equal(armyAt(c, 'weidenau')?.size, 7);
  assert.equal(c.owner.weidenau, 'R');
  assert.ok(c.armies.some((a) => a.id === 'a4' && a.size === 4 && a.prov !== 'weidenau'));
  assert.equal(c.phase, 'orders');
  assert.equal(c.round, 2);
});

test('Auswürfeln entscheidet eine Schlacht ohne Brett', () => {
  let c = newCampaign();
  const k = c.armies.find((a) => a.id === 'a4')!; k.prov = 'weidenau'; k.size = 9;
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'weidenau' }]);
  c = autoBattle(c, c.battles[0].id, () => 0.01);
  assert.equal(armyAt(c, 'weidenau')?.house, 'R');
});

test('Eroberte Hauptstadt beendet die Kampagne', () => {
  let c = newCampaign();
  c.armies = c.armies.filter((a) => a.id !== 'a3');
  c.armies.find((a) => a.id === 'a1')!.prov = 'sturmgrat';
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'kapostra' }]);
  assert.equal(c.phase, 'over');
  assert.equal(c.winner, 'R');
});

test('Gegenseitiger Platztausch: beide prallen ab', () => {
  let c = newCampaign();
  c.armies.find((a) => a.id === 'a1')!.prov = 'mittelland';
  c.armies.find((a) => a.id === 'a3')!.prov = 'sturmgrat';
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'sturmgrat' }], [{ kind: 'move', army: 'a3', to: 'mittelland' }]);
  assert.equal(armyAt(c, 'mittelland')?.id, 'a1');
  assert.equal(armyAt(c, 'sturmgrat')?.id, 'a3');
});

test('Rekruten sammeln sich nach dem Abmarsch: neues Heer in der Stadt', () => {
  let c = newCampaign();
  c = seal(c, [{ kind: 'move', army: 'a1', to: 'mittelland' }, { kind: 'recruit', prov: 'aldfurt' }]);
  assert.equal(armyAt(c, 'mittelland')?.size, 10);
  assert.equal(armyAt(c, 'aldfurt')?.size, 3);
});

test('Gebäude: Bauen kostet Gold und einen Befehl, schaltet Ausbildung frei', () => {
  let c = newCampaign();
  assert.match(orderProblem(c, 'R', { kind: 'train', prov: 'aldfurt', spec: 'KAN' }, []), /Gießerei/);
  assert.equal(orderProblem(c, 'R', { kind: 'train', prov: 'aldfurt', spec: 'KAP' }, []), '', 'Hauptstadt startet mit Kapelle');
  assert.match(orderProblem(c, 'R', { kind: 'build', prov: 'aldfurt', b: 'kapelle' }, []), /steht hier schon/);
  assert.match(orderProblem(c, 'R', { kind: 'build', prov: 'aldfurt', b: 'giesserei' }, []), /Gold/);
  c.gold.R = 10;
  c = seal(c, [{ kind: 'build', prov: 'aldfurt', b: 'giesserei' }]);
  assert.deepEqual(c.buildings.aldfurt, ['kapelle', 'giesserei']);
  assert.equal(orderProblem(c, 'R', { kind: 'train', prov: 'aldfurt', spec: 'KAN' }, []), '');
});

test('Gebäude: Kaserne rekrutiert 4, Markt bringt Gold, Mauer stärkt Verteidiger', () => {
  let c = newCampaign();
  c.buildings.suedhafen = ['kaserne', 'markt'];
  c = seal(c, [{ kind: 'recruit', prov: 'suedhafen' }]);
  assert.equal(armyAt(c, 'suedhafen')?.size, 10);
  assert.equal(c.gold.R, 4 - 3 + 3 + 4 + 2);

  let d = newCampaign();
  const k = d.armies.find((a) => a.id === 'a4')!; k.size = 8;
  Object.assign(d.armies.find((a) => a.id === 'a1')!, { prov: 'weidenau', size: 6 });
  d.owner.weidenau = 'R';
  d = seal(d, [{ kind: 'move', army: 'a1', to: 'ostkueste' }]);
  assert.equal(d.phase, 'battles', 'ohne Mauer knapp');
  let e = newCampaign();
  e.buildings.ostkueste = ['mauer'];
  const k2 = e.armies.find((a) => a.id === 'a4')!; k2.size = 8;
  Object.assign(e.armies.find((a) => a.id === 'a1')!, { prov: 'weidenau', size: 6 });
  e = seal(e, [{ kind: 'move', army: 'a1', to: 'ostkueste' }]);
  assert.match(e.report.join(' '), /klar ab/);
});

test('Vorschau: leere Ziele, eigene Heere und Kräfteverhältnis', () => {
  const c = newCampaign();
  assert.equal(movePreview(c, 'R', 'a1', 'mittelland', []).text, 'besetzen');
  assert.equal(movePreview(c, 'R', 'a1', 'westmark', []).text, 'verlegen');
  const near = structuredClone(c);
  near.armies.find((a) => a.id === 'a3')!.prov = 'mittelland';
  near.owner.mittelland = 'K';
  // 10 gegen 10 auf Ackerland: knapp
  assert.equal(movePreview(near, 'R', 'a1', 'mittelland', []).tone, 'risk');
  near.armies.find((a) => a.id === 'a3')!.size = 5;
  assert.equal(movePreview(near, 'R', 'a1', 'mittelland', []).tone, 'ok');
});

test('Aufdecken: Auflösung merkt sich Stellung und Befehle vor dem Marsch', () => {
  let c = newCampaign();
  c = sealOrders(c, 'R', [{ kind: 'move', army: 'a1', to: 'mittelland' }], () => 0.5);
  c = sealOrders(c, 'K', [{ kind: 'forage', army: 'a4' }], () => 0.5);
  assert.equal(c.reveal?.round, 1);
  assert.equal(c.reveal?.armies.find((a) => a.id === 'a1')?.prov, 'aldfurt');
  assert.equal(c.reveal?.orders.K[0].kind, 'forage');
  assert.equal(armyAt(c, 'mittelland')?.id, 'a1');
});
