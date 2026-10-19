import { test } from 'node:test';
import assert from 'node:assert/strict';
import { battleResult, crewLineup, deployText, newBattle, officerLineup, removePiece } from './battle.ts';
import { applyMove, fromName as f, legalMoves, resign, sqName, startGame, type Army, type BattleInfo } from './rules.ts';

const rav: Army = { house: 'Ravensmoor', size: 12, spec: { CAP: 1, KAP: 2, KAN: 1, MAR: 1 } };
const ker: Army = { house: 'Kerrow', size: 10, spec: { CAP: 0, KAP: 0, KAN: 0, MAR: 0 } };
const info = (terrain: BattleInfo['terrain'] = 'fluss'): BattleInfo => ({ province: 'Mittelland', terrain, attacker: rav, defender: ker });
const count = (st: ReturnType<typeof newBattle>, s: 'M' | 'O') => st.board.filter((p) => p?.s === s).length;

test('Aufstellung: Heer bestimmt, welche Figuren fehlen', () => {
  assert.deepEqual(officerLineup(rav), { FL: 1, CAP: 1, KAP: 2, KAN: 1, MAR: 1, INF: 6 });
  assert.equal(crewLineup(ker), 10);
  const st = newBattle(info(), Math.random);
  assert.deepEqual(st.deploy, { O: { KAN: 1, MAR: 1, INF: 2 }, M: { stone: 2 } });
  assert.equal(deployText(st, 'O'), '1 Kanonade, 1 Marine, 2 Infanteristen');
  assert.throws(() => startGame(st, 'M'), /Erst aufstellen/);
});

test('Aufstellung: jede Seite wählt selbst, der First Leutnant bleibt', () => {
  let st = newBattle(info(), Math.random);
  assert.throws(() => removePiece(st, f('e8')), /First Leutnant/);
  assert.throws(() => removePiece(st, f('d8')), /keine/);
  for (const n of ['a8', 'b8', 'a7', 'h7', 'a3', 'g3']) st = removePiece(st, f(n));
  assert.equal(st.deploy, undefined);
  assert.equal(count(st, 'O'), 12);
  assert.equal(count(st, 'M'), 10);
  st = startGame(st, 'O');
  assert.equal(st.phase, 'play');
});

test('Furt: Infanteristen ohne Doppelschritt, in der Ebene mit', () => {
  const ford = startGame(newBattle({ ...info(), attacker: { ...rav, size: 16, spec: { CAP: 1, KAP: 2, KAN: 2, MAR: 2 } }, defender: { ...ker, size: 12 } }, Math.random), 'O');
  assert.deepEqual(legalMoves(ford, f('d7')).map((m) => sqName(m.to)), ['d6']);
  const plain = startGame(newBattle({ ...info('ebene'), attacker: { ...rav, size: 16, spec: { CAP: 1, KAP: 2, KAN: 2, MAR: 2 } }, defender: { ...ker, size: 12 } }, Math.random), 'O');
  assert.deepEqual(legalMoves(plain, f('d7')).map((m) => sqName(m.to)).sort(), ['d5', 'd6']);
});

test('Gelände: Gebirge gibt dem Verteidiger eine Karte, auf dem Hügel beginnt die Mannschaft', () => {
  assert.equal(newBattle(info('gebirge'), Math.random).hands.M.length, 3);
  const hill = newBattle({ ...info('huegel'), attacker: { ...rav, size: 16, spec: { CAP: 1, KAP: 2, KAN: 2, MAR: 2 } }, defender: { ...ker, size: 12 } }, Math.random);
  assert.throws(() => startGame(hill, 'O'), /Mannschaft/);
  assert.equal(startGame(hill, 'M').turn, 'M');
});

test('Ergebnis: Überlebende gehen zurück, Aufgabe der Mannschaft ist Rückzug', () => {
  let st = newBattle({ ...info('ebene'), attacker: { ...rav, size: 16, spec: { CAP: 1, KAP: 2, KAN: 2, MAR: 2 } }, defender: { ...ker, size: 12 } }, Math.random);
  st = startGame(st, 'M');
  st.hands = { M: [], O: [] };
  st = applyMove(st, f('c3'), f('d4'));
  st = resign(st, 'M');
  const r = battleResult(st)!;
  assert.equal(r.winner, 'O');
  assert.equal(r.headline, 'Ravensmoor erobert Mittelland');
  assert.match(r.detail, /zieht sich zurück und rettet 12 Steine/);
  assert.equal(r.attacker.size, 16);
  assert.equal(r.defender.lost, 0);
});
