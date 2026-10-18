import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove, chooseShield, fromName as f, legalMoves, newGame, playCard, resign, resolveConversion,
  resolvePromotionRoll, scene, startGame, sqName, type GameState,
} from './rules.ts';

const fixed = (...vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };
const targets = (st: GameState, from: string) => legalMoves(st, f(from)).map((m) => sqName(m.to)).sort();

test('Startaufstellung: 12 Steine, 16 Offiziere, je 2 Karten', () => {
  const st = newGame(Math.random);
  assert.equal(st.board.filter((p) => p?.s === 'M').length, 12);
  assert.equal(st.board.filter((p) => p?.s === 'O').length, 16);
  assert.equal(st.board[f('e8')]?.t, 'FL');
  assert.equal(st.board[f('d8')]?.t, 'CAP');
  assert.equal(st.hands.M.length, 2);
  assert.equal(st.hands.O.length, 2);
});

test('Vor dem Start sind keine Züge möglich, danach nur für die Seite am Zug', () => {
  const st = newGame(Math.random);
  assert.deepEqual(targets(st, 'c3'), []);
  const started = startGame(st, 'M');
  assert.deepEqual(targets(started, 'c3'), ['b4', 'd4']);
  assert.deepEqual(targets(started, 'd7'), []);
});

test('Mannschaft: Schlagserie mit Rückwärtsschlag wird bis zum Ende geschlagen', () => {
  const st = scene([['c3', 'stone'], ['d4', 'MAR'], ['d6', 'KAP'], ['b6', 'KAN'], ['e8', 'FL']]);
  st.turn = 'M';
  const moves = legalMoves(st, f('c3'));
  assert.equal(moves.length, 1);
  assert.equal(sqName(moves[0].to), 'a5');
  assert.deepEqual(moves[0].cap.map(sqName), ['d4', 'd6', 'b6']);
  const after = applyMove(st, f('c3'), f('a5'));
  assert.equal(after.board.filter((p) => p?.s === 'O').length, 1);
  assert.equal(after.turn, 'O');
});

test('Erster Schlag nicht rückwärts', () => {
  const st = scene([['d4', 'stone'], ['d3', 'KAN'], ['e8', 'FL']]);
  st.turn = 'M';
  assert.deepEqual(targets(st, 'd4'), ['c5', 'e5']);
});

test('Seitlicher Erstschlag lässt sich abschalten', () => {
  const pieces: [string, 'stone' | 'KAN' | 'FL'][] = [['d4', 'stone'], ['e4', 'KAN'], ['e8', 'FL']];
  const on = scene(pieces); on.turn = 'M';
  assert.deepEqual(targets(on, 'd4'), ['f4']);
  const off = scene(pieces, { mPflicht: true, sideFirst: false }); off.turn = 'M';
  assert.deepEqual(targets(off, 'd4'), ['c5', 'e5']);
});

test('Offiziere: Schlagpflicht sperrt ruhige Züge anderer Figuren', () => {
  const st = scene([['a8', 'KAN'], ['a3', 'stone'], ['g8', 'MAR'], ['e8', 'FL']]);
  st.turn = 'O';
  assert.deepEqual(targets(st, 'g8'), []);
  assert.deepEqual(targets(st, 'a8'), ['a3']);
});

test('Beförderung: Pasch ergibt Turm, sonst Läufer, danach Seitenwechsel', () => {
  const st = scene([['b7', 'stone'], ['g8', 'FL'], ['h6', 'KAP']]);
  st.turn = 'M';
  const moved = applyMove(st, f('b7'), f('a8'));
  assert.deepEqual(moved.pending, { kind: 'promoM', at: f('a8') });
  assert.equal(moved.turn, 'M');
  const tower = resolvePromotionRoll(moved, [4, 4]);
  assert.equal(tower.board[f('a8')]?.t, 'PT');
  assert.equal(tower.turn, 'O');
  assert.equal(resolvePromotionRoll(moved, [2, 5]).board[f('a8')]?.t, 'PL');
});

test('Infanterist: Doppelschritt aus der Startreihe und Umwandlung auf Reihe 1', () => {
  const st = scene([['d7', 'INF'], ['e8', 'FL'], ['h1', 'stone']]);
  st.turn = 'O';
  assert.deepEqual(targets(st, 'd7'), ['d5', 'd6']);
  const conv = scene([['d2', 'INF'], ['e1', 'stone'], ['a1', 'stone'], ['e8', 'FL']]);
  conv.turn = 'O';
  assert.deepEqual(targets(conv, 'd2'), ['e1']);
  const moved = applyMove(conv, f('d2'), f('e1'));
  assert.equal(moved.pending?.kind, 'promoO');
  assert.equal(resolveConversion(moved, 'CAP').board[f('e1')]?.t, 'CAP');
});

test('First Leutnant geschlagen: Mannschaft gewinnt', () => {
  const st = scene([['d6', 'stone'], ['e7', 'FL'], ['a8', 'KAN']]);
  st.turn = 'M';
  const after = applyMove(st, f('d6'), f('f8'));
  assert.equal(after.phase, 'over');
  assert.equal(after.winner, 'M');
});

test('Karte Grog-Fass: Gegenseite setzt aus', () => {
  const st = startGame({ ...newGame(Math.random), hands: { M: ['grog'], O: [] } }, 'M');
  const played = playCard(st, 'M', 0, Math.random);
  const after = applyMove(played, f('c3'), f('d4'));
  assert.equal(after.turn, 'M');
  assert.equal(after.fx.skip.O, 0);
});

test('Karte Kühler Kopf hebt die Schlagpflicht auf', () => {
  const st = scene([['a8', 'KAN'], ['a3', 'stone'], ['g8', 'MAR'], ['e8', 'FL']]);
  st.turn = 'O'; st.hands.O = ['kopf'];
  const played = playCard(st, 'O', 0, Math.random);
  assert.ok(targets(played, 'g8').length > 0);
});

test('Karte Ehrenwache schützt bis zum Ende des gegnerischen Zugs', () => {
  const st = scene([['a8', 'KAN'], ['a3', 'stone'], ['h3', 'stone'], ['e8', 'FL']]);
  st.turn = 'M'; st.hands.M = ['wache'];
  const shielded = chooseShield(playCard(st, 'M', 0, Math.random), f('a3'));
  const afterM = applyMove(shielded, f('h3'), f('g4'));
  assert.equal(afterM.turn, 'O');
  assert.ok(!targets(afterM, 'a8').includes('a3'));
  const afterO = applyMove(afterM, f('e8'), f('d8'));
  assert.equal(afterO.board[f('a3')]?.shielded, undefined);
});

test('Karte Schiffsarzt holt die zuletzt geschlagene Figur zurück', () => {
  const st = scene([['c3', 'stone'], ['d4', 'MAR'], ['e8', 'FL'], ['h1', 'stone']]);
  st.turn = 'M';
  const afterCap = applyMove(st, f('c3'), f('e5'));
  afterCap.hands.O = ['arzt'];
  const revived = playCard(afterCap, 'O', 0, Math.random);
  assert.equal(revived.board[f('d8')]?.t, 'MAR');
});

test('Karte Maltaner Standart nimmt der Gegenseite eine Karte', () => {
  const st = startGame({ ...newGame(Math.random), hands: { M: ['blatt'], O: ['grog', 'kopf'] } }, 'M');
  const after = playCard(st, 'M', 0, fixed(0));
  assert.deepEqual(after.hands.O, ['kopf']);
});

test('Nur eine Karte pro Zug', () => {
  const st = startGame({ ...newGame(Math.random), hands: { M: ['kopf', 'grog'], O: [] } }, 'M');
  const once = playCard(st, 'M', 0, Math.random);
  assert.throws(() => playCard(once, 'M', 0, Math.random));
});

test('Aufgeben beendet die Partie zugunsten der Gegenseite', () => {
  const st = startGame(newGame(Math.random), 'O');
  const over = resign(st, 'M');
  assert.equal(over.winner, 'O');
  assert.equal(over.phase, 'over');
});

test('Zustand ist als JSON speicherbar und bleibt identisch', () => {
  const st = startGame(newGame(Math.random), 'M');
  assert.deepEqual(JSON.parse(JSON.stringify(st)), st);
});
