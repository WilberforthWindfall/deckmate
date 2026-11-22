// Rule extensions of 19.11.2026: new names and layout, Rota Zora, Ugur, Steward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove, bribe, bribeTargets, chooseUgur, endTurn, fromName as f, legalMoves, LAYOUT, moveSteward, newGame, playCard,
  scene, sqName, startGame, stewardCoins, stewardMoves, winnerOf, type GameState,
} from './rules.ts';
import { act } from './actions.ts';

const targets = (st: GameState, from: string) => legalMoves(st, f(from)).map((m) => sqName(m.to)).sort();
const noExt = { mPflicht: false, sideFirst: true };

test('Rochade mit dem Captain auf d8: kurz Richtung a, lang Richtung h', () => {
  const st = scene([['d8', 'FL'], ['a8', 'KAN'], ['h8', 'KAN'], ['e1', 'stone']], noExt, LAYOUT);
  st.turn = 'O';
  assert.deepEqual(targets(st, 'd8'), ['b8', 'c7', 'c8', 'd7', 'e7', 'e8', 'f8']);
  const kurz = applyMove(st, f('d8'), f('b8'));
  assert.equal(kurz.board[f('b8')]?.t, 'FL');
  assert.equal(kurz.board[f('c8')]?.t, 'KAN');
  assert.match(kurz.log[1] ?? kurz.log[0], /Rochade kurz/);
  const lang = applyMove(st, f('d8'), f('f8'));
  assert.equal(lang.board[f('f8')]?.t, 'FL');
  assert.equal(lang.board[f('e8')]?.t, 'KAN');
});

test('Rota Zora: Offiziere ziehen noch einmal; nicht im Kartenstapel, nicht vom Maltaner Standart zu treffen', () => {
  let st = scene([['d8', 'FL'], ['a8', 'KAN'], ['h1', 'stone'], ['c1', 'stone']], noExt);
  st.hands = { M: ['blatt'], O: ['zora'] };
  st.turn = 'M';
  assert.match(playCardWhy(st, 'M'), /Keine Karten|keine Karten/);
  st.turn = 'O';
  st = playCard(st, 'O', 0, Math.random);
  st = applyMove(st, f('a8'), f('a7'));
  assert.equal(st.turn, 'O');
  assert.equal(st.hands.O.length, 0);
  for (let i = 0; i < 40; i++) assert.ok(!newGame(Math.random).hands.M.includes('zora'));
});

function playCardWhy(st: GameState, side: 'M' | 'O') {
  try { playCard(st, side, 0, Math.random); return ''; } catch (e) { return (e as Error).message; }
}

test('Rota Zora: ist Ugur erwacht, darf nur er in der verwirrten Runde ziehen', () => {
  let st = scene([['d8', 'FL'], ['a8', 'KAN'], ['h1', 'stone'], ['e4', 'U:KAP']], noExt);
  st.hands = { M: [], O: ['zora'] };
  st.turn = 'O';
  st = playCard(st, 'O', 0, Math.random);
  st = applyMove(st, f('a8'), f('a7'));
  assert.equal(st.turn, 'M');
  assert.equal(st.fx.onlyUgur, true);
  assert.deepEqual(targets(st, 'h1'), []);
  assert.ok(targets(st, 'e4').length > 0);
  st = applyMove(st, f('e4'), f('f3'));
  assert.equal(st.turn, 'O');
  assert.equal(st.fx.onlyUgur, false);
});

test('Ugur: schlägt ein Offizier den besessenen Stein, kämpft der Offizier für die Mannschaft', () => {
  let st = scene([['d8', 'FL'], ['b3', 'KAP'], ['d5', 'P:stone'], ['h1', 'stone']], noExt);
  st.turn = 'O';
  st = applyMove(st, f('b3'), f('d5'));
  const u = st.board[f('d5')]!;
  assert.deepEqual([u.t, u.s, u.ugur], ['KAP', 'M', true]);
  assert.equal(st.turn, 'M');
  // Ugur has no capture obligation, but may capture officers.
  st = scene([['d8', 'FL'], ['a8', 'KAN'], ['c6', 'U:KAP'], ['b7', 'MAR'], ['h1', 'stone']], noExt);
  st.turn = 'M';
  assert.ok(targets(st, 'h1').length > 0, 'Stein darf frei ziehen trotz möglichem Ugur-Schlag');
  assert.ok(targets(st, 'c6').includes('b7'));
});

test('Ugur ergreift den Captain: der First Lieutenant übernimmt; ohne ihn ist die Partie verloren', () => {
  let st = scene([['d8', 'FL'], ['d6', 'P:stone'], ['e8', 'CAP'], ['h1', 'stone']], noExt);
  st.board[f('d8')] = null; st.board[f('d7')] = { t: 'FL', s: 'O' };
  st.turn = 'O';
  st = applyMove(st, f('d7'), f('d6'));
  assert.equal(st.board[f('e8')]?.t, 'FL');
  assert.equal(st.board[f('e8')]?.s, 'O');
  assert.equal(st.phase, 'play');
  let lone = scene([['d7', 'FL'], ['d6', 'P:stone'], ['h1', 'stone']], noExt);
  lone.turn = 'O';
  lone = applyMove(lone, f('d7'), f('d6'));
  assert.equal(lone.phase, 'over');
  assert.equal(lone.winner, 'M');
});

test('Ugur im Fähnrich: zieht Richtung Achterdeck und springt dort über', () => {
  let st = scene([['d8', 'FL'], ['e7', 'INF'], ['f6', 'P:stone'], ['a8', 'KAN'], ['h8', 'KAP'], ['h1', 'stone']], noExt);
  st.turn = 'O';
  st = applyMove(st, f('e7'), f('f6'));
  assert.deepEqual([st.board[f('f6')]?.t, st.board[f('f6')]?.ugur], ['INF', true]);
  assert.deepEqual(targets(st, 'f6'), ['f7'], 'zieht in Gegenrichtung, zum Achterdeck');
  st = applyMove(st, f('f6'), f('f7'));
  st = applyMove(st, f('a8'), f('a7'));
  // Only the Kaplan stands on the Achterdeck besides the Captain: Ugur takes him without a choice.
  st = applyMove(st, f('f7'), f('f8'));
  assert.equal(st.pending, null);
  assert.equal(st.board[f('h8')]?.ugur, true);
  assert.deepEqual([st.board[f('f8')]?.t, st.board[f('f8')]?.s], ['INF', 'O']);
});

test('Ugur-Sprung: Wahl der Mannschaft, Fähnrich kehrt zurück; ohne Offizier auf dem Achterdeck der nächste mit höchstem Rang', () => {
  let st = scene([['d8', 'FL'], ['a8', 'KAN'], ['h8', 'KAP'], ['f7', 'U:INF'], ['h1', 'stone']], noExt);
  st.turn = 'M';
  st = applyMove(st, f('f7'), f('f8'));
  assert.deepEqual(st.pending!.options!.map(sqName).sort(), ['a8', 'h8']);
  st = chooseUgur(st, f('h8'));
  assert.deepEqual([st.board[f('f8')]?.t, st.board[f('f8')]?.s, st.board[f('f8')]?.ugur], ['INF', 'O', undefined]);
  assert.equal(st.board[f('h8')]?.ugur, true);
  assert.equal(st.turn, 'O');
  // Nobody on the Achterdeck except the moving Fähnrich: nearest non-Fähnrich, rank decides (Mörser before Kaplan).
  let s2 = scene([['h4', 'FL'], ['d6', 'KAP'], ['b6', 'KAN'], ['c7', 'U:INF'], ['h1', 'stone']], noExt);
  s2.turn = 'M';
  s2 = applyMove(s2, f('c7'), f('c8'));
  assert.equal(s2.pending, null);
  assert.equal(s2.board[f('b6')]?.ugur, true);
  // Captain alone on the Achterdeck: he is taken, the First Lieutenant takes over.
  let s3 = scene([['d8', 'FL'], ['e5', 'CAP'], ['c7', 'U:INF'], ['h1', 'stone']], noExt);
  s3.turn = 'M';
  s3 = applyMove(s3, f('c7'), f('c8'));
  assert.equal(s3.board[f('d8')]?.ugur, true);
  assert.equal(s3.board[f('e5')]?.t, 'FL');
});

test('Steward: Bestechung nur bei Schlagpflicht, Stein wird unschlagbar, Schlagpflicht verfällt', () => {
  let st = scene([['d8', 'FL'], ['a8', 'KAN'], ['a3', 'stone'], ['h3', 'stone']]);
  st.purse = { M: ['penny'], O: ['crown', 'farthing'] };
  st.turn = 'O';
  assert.deepEqual(bribeTargets(st).map(sqName), ['a3']);
  st = bribe(st, f('a3'), 'crown');
  assert.equal(st.board[f('a3')]?.t, 'STW');
  assert.deepEqual(st.purse!.O, ['farthing']);
  assert.ok(!legalMoves(st, f('a8')).some((m) => m.cap.length), 'Steward kann nicht geschlagen werden');
  assert.ok(legalMoves(st, f('d8')).length > 0, 'Schlagpflicht verfällt');
  assert.deepEqual(stewardCoins(st.board), { crown: 1 });
  // Without capture obligation there is nothing to bribe.
  const calm = scene([['d8', 'FL'], ['a8', 'KAN'], ['b3', 'stone']]);
  calm.purse = { M: [], O: ['crown'] }; calm.turn = 'O';
  assert.deepEqual(bribeTargets(calm), []);
});

test('Steward: bewegen mit Münze, nur mit eigener Figur daneben oder in Schlagreichweite, einmal vor dem Zug', () => {
  let st = scene([['d8', 'FL'], ['a8', 'KAN'], ['a4', 'STW'], ['b3', 'stone'], ['h1', 'stone']]);
  st.purse = { M: ['penny', 'farthing'], O: ['sov'] };
  st.turn = 'M';
  assert.ok(stewardMoves(st, f('a4')).length > 0, 'Stein b3 steht daneben');
  st = moveSteward(st, f('a4'), f('a5'), 'penny');
  assert.deepEqual(st.board[f('a5')]?.coins, ['penny']);
  assert.deepEqual(stewardMoves(st, f('a5')), [], 'nur einmal pro Zug');
  st = applyMove(st, f('h1'), f('g2'));
  // Officers: the Mörser on a8 could "capture" the Steward on a5 → may move him.
  assert.ok(stewardMoves(st, f('a5')).length > 0);
  st = act(st, { type: 'steward', from: f('a5'), to: f('b5'), coin: 'sov' }, Math.random);
  assert.equal(st.board[f('b5')]?.coins?.length, 2);
  assert.deepEqual(st.purse!.O, []);
  // Without coins no more moves.
  st = applyMove(st, f('a8'), f('a7'));
  st = applyMove(st, f('g2'), f('f3'));
  assert.deepEqual(stewardMoves(st, f('b5')), []);
});

test('Steward zählt nicht für den Sieg der Offiziere', () => {
  const st = scene([['d8', 'FL'], ['a4', 'STW']]);
  assert.equal(winnerOf(st.board), 'O');
});

test('Erweiterungen sind abschaltbar und in alten Partien aus', () => {
  const st = newGame(Math.random, noExt);
  assert.ok(!st.hands.O.includes('zora'));
  assert.ok(!st.board.some((p) => p?.possessed));
  assert.equal(st.purse, undefined);
  const s = startGame(newGame(Math.random), 'O');
  assert.equal(endTurnWhy(s), 'Erst ziehen, dann den Zug beenden.');
});

function endTurnWhy(st: GameState) { try { endTurn(st, st.turn); return ''; } catch (e) { return (e as Error).message; } }

test('Wiederholung: jede Aktion legt ein Bild für die Bibliothek ab', () => {
  let st = act(newGame(Math.random), { type: 'start' }, Math.random);
  st = act(st, { type: 'move', from: f('d7'), to: f('d5') }, Math.random);
  assert.equal(st.replay?.length, 2);
});

test('Die Offiziere beginnen immer – auch wenn eine alte Oberfläche die Mannschaft oder Würfeln schickt', () => {
  for (const first of ['M', 'O', 'roll', undefined] as const) assert.equal(act(newGame(Math.random), { type: 'start', first }, Math.random).turn, 'O');
});
