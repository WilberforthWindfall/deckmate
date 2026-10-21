import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentBonus, buildingOwnerOf, applyBattle, armyAt, armyById, autoBattle, battleGame, buildingActive, hasNear, income, movePreview, newCampaign,
  finalScore, goalMet, goalProgress, levelOf, orderCost, rankOf, score, strength, orderProblem, rangeOf, recruitSize, researchOf, sealOrders, trainCost, type Campaign, type Order,
} from './engine.ts';
import { cityHex, hexDist } from './map.ts';

const rng = () => 0.42;
const seal = (c: Campaign, r: Order[], k: Order[] = []) => sealOrders(sealOrders(c, 'R', r, rng), 'K', k, rng);
const put = (c: Campaign, id: string, hex: string, size?: number) => { const a = armyById(c, id)!; a.hex = hex; if (size) a.size = size; return a; };

test('Reichweite: kleine Heere sind schneller, ohne Spezialisten einen Punkt langsamer', () => {
  const s = { CAP: 1, KAP: 0, KAN: 0, MAR: 0 }, none = { CAP: 0, KAP: 0, KAN: 0, MAR: 0 };
  assert.equal(rangeOf({ id: 'x', house: 'R', hex: '5,5', size: 6, spec: s }), 5);
  assert.equal(rangeOf({ id: 'x', house: 'R', hex: '5,5', size: 6, spec: none }), 4);
  assert.equal(rangeOf({ id: 'x', house: 'R', hex: '5,5', size: 10, spec: s }), 4);
  assert.equal(rangeOf({ id: 'x', house: 'R', hex: '5,5', size: 14, spec: s }), 3);
  assert.equal(rangeOf({ id: 'x', house: 'R', hex: '5,5', size: 14, spec: none }), 2);
});

test('Wege: Feld für Feld, Gebirge kostet doppelt, Reichweite begrenzt', () => {
  const c = newCampaign();
  put(c, 'a1', '8,5');
  assert.equal(orderProblem(c, 'R', { kind: 'move', army: 'a1', path: ['9,5', '10,5'] }, []), ''); // 2 + 2 = 4
  assert.match(orderProblem(c, 'R', { kind: 'move', army: 'a1', path: ['9,5', '10,5', '11,5'] }, []), /kostet 6/);
  assert.match(orderProblem(c, 'R', { kind: 'move', army: 'a1', path: ['10,5'] }, []), /zusammenhängen/);
});

test('Befehle reihum; Felder auf dem Weg werden eigen, Provinzbesitz nach Mehrheit', () => {
  let c = newCampaign();
  c = sealOrders(c, 'R', [{ kind: 'move', army: 'a1', path: ['6,5', '7,5'] }], rng);
  assert.equal(c.phase, 'orders');
  assert.equal(c.current, 'K');
  c = sealOrders(c, 'K', [], rng);
  assert.equal(armyAt(c, '7,5')?.id, 'a1');
  assert.equal(c.hexOwner['7,5'], 'R');
  assert.equal(c.owner.mittelland, 'R');
  assert.equal(c.round, 2);
  assert.deepEqual(c.reveal?.walk.a1, ['5,5', '6,5', '7,5']);
});

test('Durch eigene Heere hindurchziehen vereint nicht, am Ziel schon', () => {
  let c = newCampaign();
  put(c, 'a1', '6,5'); put(c, 'a2', '4,5');
  c = seal(c, [{ kind: 'move', army: 'a2', path: ['5,5', '6,5', '7,5'] }]);
  assert.equal(armyAt(c, '6,5')?.id, 'a1');
  assert.equal(armyAt(c, '7,5')?.id, 'a2');
  let d = newCampaign();
  put(d, 'a1', '6,5'); put(d, 'a2', '4,5');
  d = seal(d, [{ kind: 'move', army: 'a2', path: ['5,5', '6,5'] }]);
  assert.equal(d.armies.filter((a) => a.house === 'R').length, 1);
  assert.equal(armyAt(d, '6,5')?.size, 16);
});

test('Begegnung im selben Schritt: klare Übermacht besetzt, knapp wird Feldschlacht', () => {
  let c = newCampaign();
  put(c, 'a3', '8,5', 5);
  c = seal(c, [{ kind: 'move', army: 'a1', path: ['6,5', '7,5'] }], [{ kind: 'move', army: 'a3', path: ['8,4', '7,5'] }]);
  assert.equal(armyAt(c, '7,5')?.id, 'a1');
  assert.equal(armyAt(c, '8,4')?.id, 'a3');
  assert.equal(c.conflicts?.[0].kind, 'meet');

  let d = newCampaign();
  put(d, 'a3', '8,5', 8);
  d = seal(d, [{ kind: 'move', army: 'a1', path: ['6,5', '7,5'] }], [{ kind: 'move', army: 'a3', path: ['8,4', '7,5'] }]);
  assert.equal(d.phase, 'battles');
  const b = d.battles[0];
  assert.deepEqual([b.field, b.hex, b.attacker, b.from, b.defFrom], [true, '7,5', 'a1', '6,5', '8,4']);
  d = applyBattle(d, b.id, { attackerWon: false, attacker: { size: 6, spec: { CAP: 1, KAP: 1, KAN: 0, MAR: 0 } }, defender: { size: 5 }, retreat: false, how: 'ausgewürfelt' });
  assert.equal(armyAt(d, '7,5')?.id, 'a3');
  assert.equal(armyAt(d, '6,5')?.id, 'a1');
  assert.equal(d.round, 2);
});

test('Platztausch: die Heere begegnen sich unterwegs', () => {
  let c = newCampaign();
  put(c, 'a1', '7,5'); put(c, 'a3', '8,5', 5);
  c = seal(c, [{ kind: 'move', army: 'a1', path: ['8,5'] }], [{ kind: 'move', army: 'a3', path: ['7,5'] }]);
  assert.equal(armyAt(c, '8,5')?.id, 'a1');
  const k = armyById(c, 'a3')!;
  assert.ok(k.hex !== '7,5' && k.hex !== '8,5' && hexDist(k.hex, '8,5') === 1);
  const m = c.conflicts![0];
  assert.ok(m.kind === 'meet' && m.swap && m.winner === 'R');
});

test('Angriff auf ein stehendes Heer: Überrennen mit Rückzug; Gelände stärkt Verteidiger', () => {
  let c = newCampaign();
  put(c, 'a4', '7,5', 5);
  c = seal(c, [{ kind: 'move', army: 'a1', path: ['6,5', '7,5'] }]);
  assert.equal(armyAt(c, '7,5')?.id, 'a1');
  const k = c.conflicts!.find((x) => x.kind === 'attack');
  assert.ok(k && k.kind === 'attack' && k.outcome === 'overrun' && k.defLost === 3);

  let d = newCampaign();
  put(d, 'a4', '9,5', 8); // Gebirge ×1,3 → 10,4
  put(d, 'a1', '8,5');
  d = seal(d, [{ kind: 'move', army: 'a1', path: ['9,5'] }]);
  assert.equal(d.battles[0].defStrength, 10.4);
  const g = battleGame(d, d.battles[0].id, Math.random);
  assert.equal(g.battle?.attacker.house, 'Ravensmoor');
  d = autoBattle(d, d.battles[0].id, () => 0.01);
  assert.equal(armyAt(d, '9,5')?.house, 'R');
});

test('Städte fallen nur über das Stadtfeld', () => {
  let c = newCampaign();
  put(c, 'a3', '7,5', 10);
  c = seal(c, [{ kind: 'move', army: 'a1', path: ['5,4'] }], [{ kind: 'move', army: 'a3', path: ['6,5'] }]);
  assert.equal(c.hexOwner['6,5'], 'K');
  assert.equal(c.owner.aldfurt, 'R');
  c = seal(c, [], [{ kind: 'move', army: 'a3', path: ['5,5'] }]);
  assert.equal(c.owner.aldfurt, 'K');
  assert.equal(c.phase, 'over');
  assert.equal(c.winner, 'K');
});

test('Bauen im Umland, Mauer nur auf dem Stadtfeld, Gebäude ruht unter feindlichem Heer', () => {
  const c = newCampaign();
  c.gold.R = 20;
  assert.equal(orderProblem(c, 'R', { kind: 'build', hex: '5,6', b: 'kaserne' }, []), '');
  assert.match(orderProblem(c, 'R', { kind: 'build', hex: '5,5', b: 'kaserne' }, []), /Stadtmauer/);
  assert.equal(orderProblem(c, 'R', { kind: 'build', hex: '5,5', b: 'mauer' }, []), '');
  assert.match(orderProblem(c, 'R', { kind: 'build', hex: '5,6', b: 'mauer' }, []), /Stadtfeld/);
  assert.match(orderProblem(c, 'R', { kind: 'build', hex: '8,5', b: 'markt' }, []), /eigenen Feldern/);
  assert.ok(hasNear(c, 'aldfurt', 'kapelle', 'R'));
  put(c, 'a3', '6,5');
  assert.equal(buildingActive(c, '6,5'), false);
  assert.ok(!hasNear(c, 'aldfurt', 'kapelle', 'R'));
  assert.match(orderProblem(c, 'R', { kind: 'train', prov: 'aldfurt', spec: 'KAP' }, []), /aktive Kapelle/);
});

test('Einzelgänger: ausbilden, losschicken, Bonus auf passendem Gebäude, ins Heer eintreten', () => {
  let c = newCampaign();
  c.gold.R = 20;
  put(c, 'a1', '5,4');
  c = seal(c, [{ kind: 'train', prov: 'aldfurt', spec: 'KAP', alone: true }]);
  const ag = c.agents.find((a) => a.house === 'R')!;
  assert.equal(ag.hex, cityHex('aldfurt'));
  c = seal(c, [{ kind: 'agent', agent: ag.id, path: ['6,5'] }]);
  const placed = c.agents.find((a) => a.id === ag.id)!;
  assert.match(agentBonus(c, placed)?.text ?? '', /Zulauf/);
  assert.equal(recruitSize(c, 'aldfurt', 'R'), 4);
  c = seal(c, [{ kind: 'agent', agent: ag.id, path: ['5,5', '5,4'] }]);
  assert.equal(c.agents.length, 0);
  assert.equal(armyById(c, 'a1')!.spec.KAP, 2);
});

test('Kaplan auf dem Markt bringt Gold; Märkte schicken Händler, die bei Ankunft zahlen', () => {
  let c = newCampaign();
  c.buildings['4,7'] = 'markt'; c.hexOwner['4,7'] = 'R';
  c.agents.push({ id: 'g1', house: 'R', spec: 'KAP', hex: '4,7' });
  assert.equal(income(c, 'R').agents, 2);
  assert.equal(income(c, 'R').markets, 1);
  c = seal(c, []);
  const t = c.traders.find((x) => x.house === 'R')!;
  assert.ok(t && t.market === '4,7');
  const gold = c.gold.R, cargo = t.gold;
  c = seal(c, []);
  c = seal(c, []);
  assert.ok(!c.traders.some((x) => x.id === t.id));
  assert.ok(c.gold.R >= gold + cargo);
});

test('Händler werden von feindlichen Heeren überfallen', () => {
  let c = newCampaign();
  c.traders.push({ id: 't1', house: 'R', hex: '4,7', market: '4,7', to: cityHex('aldfurt'), gold: 6 });
  put(c, 'a4', '5,6');
  const before = c.gold.K;
  c = seal(c, []);
  assert.ok(!c.traders.length);
  assert.ok(c.gold.K >= before + 3);
});

test('Vorschau am Zielfeld', () => {
  const c = newCampaign();
  assert.equal(movePreview(c, 'R', 'a1', '7,5', []).text, 'besetzen');
  assert.equal(movePreview(c, 'R', 'a1', '6,5', []).text, 'verlegen');
  put(c, 'a3', '7,5', 10);
  assert.equal(movePreview(c, 'R', 'a1', '7,5', []).tone, 'risk');
  put(c, 'a4', cityHex('tiefland'), 1);
  assert.equal(movePreview(c, 'R', 'a2', cityHex('kapostra'), []).text, 'Stadt einnehmen');
});

test('Gebäude: ruht, solange ein feindliches Heer darauf steht; zieht es weiter, ist es erobert', () => {
  let c = newCampaign();
  put(c, 'a3', '7,5', 10);
  put(c, 'a1', '5,4');
  c = seal(c, [], [{ kind: 'move', army: 'a3', path: ['6,5'] }]);
  assert.equal(c.hexOwner['6,5'], 'K');
  assert.equal(buildingOwnerOf(c, '6,5'), 'R');
  assert.equal(buildingActive(c, '6,5'), false);
  c = seal(c, [], [{ kind: 'move', army: 'a3', path: ['7,5'] }]);
  assert.equal(buildingOwnerOf(c, '6,5'), 'K');
  assert.equal(buildingActive(c, '6,5'), true);
  assert.match(c.report.join(' '), /Kerrow erobert bei Aldfurt: Kapelle/);
});

test('Forschung schaltet den Ausbau frei; Stufen wirken auf Rekruten, Ausbildung und Mauer', () => {
  let c = newCampaign();
  c.gold.R = 60;
  // the chapel next to Aldfurt cannot grow without research
  assert.match(orderProblem(c, 'R', { kind: 'upgrade', hex: '6,5' }, []), /Forschung „Liturgie“/);
  // research takes no order: three orders plus research are fine, a second research is not
  const three: Order[] = [{ kind: 'build', hex: '5,6', b: 'kaserne' }, { kind: 'forage', army: 'a1' }, { kind: 'forage', army: 'a2' }];
  assert.equal(orderProblem(c, 'R', { kind: 'research', branch: 'glaube' }, three), '');
  assert.match(orderProblem(c, 'R', { kind: 'research', branch: 'militaer' }, [...three, { kind: 'research', branch: 'glaube' }]), /eine Forschung/);
  c = seal(c, [...three, { kind: 'research', branch: 'militaer' }]);
  assert.equal(researchOf(c, 'R', 'militaer'), 1);
  assert.equal(levelOf(c, '5,6'), 1);
  assert.equal(recruitSize(c, 'aldfurt', 'R'), 4);
  // Kaserne II: one more recruit, marines 1 gold cheaper
  assert.equal(orderProblem(c, 'R', { kind: 'upgrade', hex: '5,6' }, []), '');
  assert.equal(orderCost(c, 'R', { kind: 'upgrade', hex: '5,6' }), 6);
  c = seal(c, [{ kind: 'upgrade', hex: '5,6' }]);
  assert.equal(levelOf(c, '5,6'), 2);
  assert.equal(recruitSize(c, 'aldfurt', 'R'), 5);
  assert.equal(trainCost(c, 'aldfurt', 'R', 'MAR'), 3);
  assert.equal(trainCost(c, 'aldfurt', 'R', 'KAP'), 4);
  // level III needs the second research
  assert.match(orderProblem(c, 'R', { kind: 'upgrade', hex: '5,6' }, []), /Kriegskunst/);
});

test('Erfahrung: Sieger steigen auf, Veteranen sind stärker, Vereinigen verwässert', () => {
  let c = newCampaign({ experience: true, goals: false });
  const a1 = armyById(c, 'a1')!;
  assert.equal(rankOf(a1), 0);
  a1.xp = 4;
  assert.equal(rankOf(a1), 2);
  assert.equal(strength(c, a1, '7,5', [], false), 12); // 10 × 1,2
  // merging 6 green soldiers into 10 veterans: 4 × 10 / 16 → 2 (Erprobt)
  put(c, 'a2', '5,6');
  c = seal(c, [{ kind: 'move', army: 'a2', path: ['5,5'] }]);
  const merged = c.armies.find((a) => a.house === 'R' && a.hex === cityHex('aldfurt'))!;
  assert.equal(merged.size, 16);
  assert.equal(rankOf(merged), 1);
  // a clear win gives experience
  const off = newCampaign({ experience: false, goals: false });
  armyById(off, 'a1')!.xp = 9;
  assert.equal(strength(off, armyById(off, 'a1')!, '7,5', [], false), 10);
  let w = newCampaign({ experience: true, goals: false });
  put(w, 'a3', '7,5', 4);
  w = seal(w, [{ kind: 'move', army: 'a1', path: ['6,5', '7,5'] }]);
  assert.equal(armyById(w, 'a1')!.xp, 1);
});

test('Geheime Ziele: verdeckt gezogen, zählen am Ende mit', () => {
  const c = newCampaign({ maxRounds: 6, goals: true, experience: true }, () => 0.1);
  assert.equal(c.maxRounds, 6);
  assert.ok(c.goals?.R && c.goals?.K);
  c.goals!.R = { kind: 'cities', n: 2 };
  assert.deepEqual(goalProgress(c, 'R', c.goals!.R), [2, 2]);
  assert.ok(goalMet(c, 'R'));
  assert.equal(finalScore(c, 'R'), score(c, 'R') + 4);
  const none = newCampaign({ goals: false });
  assert.equal(none.goals, undefined);
});

test('Generierte Karte: gleicher Code ergibt dieselbe Karte, Kampagne läuft darauf', async () => {
  const { generateMap, parseCode, mapCode, fairness } = await import('./mapgen.ts');
  const p = parseCode('man1-test7')!;
  assert.equal(mapCode(p), 'MAN1-TEST7');
  const a = generateMap(p), b = generateMap(p);
  assert.deepEqual(a, b);
  assert.equal(a.provinces.length, 21);
  assert.ok(fairness(a).ok);
  const c = newCampaign({ map: a, maxRounds: 4 });
  assert.equal(c.map?.id, a.id);
  assert.equal(c.armies.length, 4);
  for (const h of ['R', 'K'] as const) assert.equal(a.provinces.filter((x) => x.start === h).length, 3);
  // the classic map is back as soon as a classic campaign is used
  const old = newCampaign({});
  assert.equal(old.map, undefined);
  assert.equal(cityHex('aldfurt'), '5,5');
  assert.ok(hexDist(old.armies[0].hex, old.armies[2].hex) > 3);
});
