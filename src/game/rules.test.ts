import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove, chooseShield, endTurn, fromName as f, legalMoves, newGame, playCard, resign, resolveConversion,
  resolvePromotionRoll, scene, startGame, sqName, type GameState,
} from './rules.ts';

const fixed = (...vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };
const targets = (st: GameState, from: string) => legalMoves(st, f(from)).map((m) => sqName(m.to)).sort();

test('Startaufstellung: 16 Steine, 16 Offiziere, je 2 Karten', () => {
  const st = newGame(Math.random);
  assert.equal(st.board.filter((p) => p?.s === 'M').length, 16);
  for (const n of ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']) assert.equal(st.board[f(n)]?.t, 'stone', n);
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

test('Mannschaft: Schlagserie mit Rückwärtsschlag, darf nach jedem Sprung beendet werden', () => {
  const st = scene([['c3', 'stone'], ['d4', 'MAR'], ['d6', 'KAP'], ['b6', 'KAN'], ['e8', 'FL']]);
  st.turn = 'M';
  const moves = legalMoves(st, f('c3')).filter((m) => m.cap.length);
  assert.deepEqual(moves.map((m) => sqName(m.to)).sort(), ['a5', 'c7', 'e5']);
  const full = moves.find((m) => sqName(m.to) === 'a5')!;
  assert.deepEqual(full.cap.map(sqName), ['d4', 'd6', 'b6']);
  const after = applyMove(st, f('c3'), f('a5'));
  assert.equal(after.board.filter((p) => p?.s === 'O').length, 1);
  assert.equal(after.turn, 'O');
  // Nach dem ersten Sprung aufhören: nur d4 geschlagen, KAP und KAN bleiben stehen.
  const stop = applyMove(st, f('c3'), f('e5'));
  assert.equal(stop.board[f('d4')], null);
  assert.equal(stop.board[f('d6')]?.t, 'KAP');
  assert.equal(stop.board[f('b6')]?.t, 'KAN');
});

test('Erster Schlag nicht rückwärts', () => {
  const st = scene([['d4', 'stone'], ['d3', 'KAN'], ['e8', 'FL']]);
  st.turn = 'M';
  assert.deepEqual(targets(st, 'd4'), ['c5', 'e5']);
});

test('Seitlicher Erstschlag lässt sich abschalten', () => {
  const pieces: [string, 'stone' | 'KAN' | 'FL'][] = [['d4', 'stone'], ['e4', 'KAN'], ['e8', 'FL']];
  const caps = (st: GameState) => legalMoves(st, f('d4')).filter((m) => m.cap.length).map((m) => sqName(m.to));
  const on = scene(pieces); on.turn = 'M';
  assert.deepEqual(caps(on), ['f4']);
  const off = scene(pieces, { mPflicht: false, sideFirst: false }); off.turn = 'M';
  assert.deepEqual(caps(off), []);
});

test('Mannschaft: keine Schlagpflicht, ruhige Züge bleiben erlaubt', () => {
  const st = scene([['d4', 'stone'], ['e5', 'KAN'], ['a3', 'stone'], ['e8', 'FL']], { mPflicht: true, sideFirst: true });
  st.turn = 'M';
  assert.ok(targets(st, 'd4').includes('f6'));
  assert.deepEqual(targets(st, 'a3'), ['b4']);
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

test('Fähnrich: Doppelschritt aus der Startreihe und Umwandlung auf Reihe 1', () => {
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

test('Ruhe vor dem Sturm: Die Offiziere dürfen im nächsten Zug nicht schlagen, trotz Schlagpflicht', () => {
  const st = scene([['a8', 'KAN'], ['a3', 'stone'], ['h3', 'stone'], ['e8', 'FL']]);
  st.turn = 'M'; st.hands.M = ['kopf'];
  const played = applyMove(playCard(st, 'M', 0, Math.random), f('h3'), f('g4'));
  assert.equal(played.turn, 'O');
  assert.equal(played.fx.calm, 'O');
  assert.ok(!targets(played, 'a8').includes('a3'));
  assert.ok(targets(played, 'a8').length > 0, 'ruhige Züge bleiben erlaubt');
  assert.ok(targets(played, 'e8').length > 0, 'ohne Schlagpflicht dürfen auch andere Figuren ziehen');
  const afterO = applyMove(played, f('e8'), f('d8'));
  assert.equal(afterO.fx.calm, null, 'wirkt nur einen Zug');
});

test('Ruhe vor dem Sturm wirkt auch nach dem Ziehen und gegen die Mannschaft', () => {
  let st = scene([['c3', 'stone'], ['d4', 'MAR'], ['e8', 'FL'], ['h8', 'KAN']]);
  st.turn = 'O'; st.hands.O = ['kopf'];
  st = applyMove(st, f('e8'), f('f8'));
  assert.equal(st.turn, 'O', 'Karte nach dem Zug noch spielbar');
  st = playCard(st, 'O', 0, Math.random);
  assert.equal(st.turn, 'M');
  assert.deepEqual(targets(st, 'c3'), ['b4']);
});

test('Ruhe vor dem Sturm verpufft, wenn die Gegenseite nur schlagen könnte', () => {
  let st = scene([['a8', 'FL'], ['b8', 'stone'], ['a7', 'stone'], ['b7', 'stone'], ['h3', 'stone']]);
  st.turn = 'M'; st.hands.M = ['kopf'];
  st = applyMove(playCard(st, 'M', 0, Math.random), f('h3'), f('g4'));
  assert.deepEqual(targets(st, 'a8'), ['a7', 'b7', 'b8']);
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

test('Karte nach dem Ziehen: Zug wartet, bis Karte gespielt oder Zug beendet', () => {
  let st = startGame(newGame(Math.random), 'M');
  st.hands.M = ['grog', 'boee'];
  st = applyMove(st, f('c3'), f('d4'));
  assert.equal(st.turn, 'M');
  assert.equal(st.fx.moved, true);
  assert.deepEqual(targets(st, 'e3'), [], 'nach dem Zug keine weiteren Züge');
  assert.throws(() => playCard(st, 'M', 1, Math.random), /nur vor dem Ziehen/);
  const after = playCard(st, 'M', 0, Math.random);
  assert.equal(after.turn, 'M', 'Grog nach dem Zug: Offiziere setzen aus, Mannschaft zieht erneut');
  assert.equal(after.fx.moved, false);
  const ended = endTurn(st, 'M');
  assert.equal(ended.turn, 'O');
});

test('Ohne spielbare Karte geht der Zug nach dem Ziehen sofort weiter', () => {
  let st = startGame(newGame(Math.random), 'M');
  st.hands.M = ['boee'];
  st = applyMove(st, f('c3'), f('d4'));
  assert.equal(st.turn, 'O');
});

test('Ehrenwache nach dem Ziehen: Figur wählen beendet den Zug, Schutz hält über den Gegnerzug', () => {
  let st = startGame(newGame(Math.random), 'O');
  st.hands.O = ['wache'];
  st = applyMove(st, f('d7'), f('d6'));
  st = playCard(st, 'O', 0, Math.random);
  assert.equal(st.fx.shieldPick, true);
  st = chooseShield(st, f('d6'));
  assert.equal(st.turn, 'M');
  assert.equal(st.board[f('d6')]?.shielded, true);
  const any = st.board.some((p, i) => p?.s === 'M' && legalMoves(st, i).length);
  assert.ok(any, 'Mannschaft kann ziehen');
});

test('Ehrenwache vor dem Ziehen: danach sind eigene Züge möglich', () => {
  let st = startGame(newGame(Math.random), 'O');
  st.hands.O = ['wache'];
  st = chooseShield(playCard(st, 'O', 0, Math.random), f('e8'));
  assert.equal(st.turn, 'O');
  assert.ok(st.board.some((p, i) => p?.s === 'O' && legalMoves(st, i).length));
});

test('Achterdeck: Eine Schlagserie endet auf Reihe 8, der Stein wird befördert (Beta-Feedback 30.10.)', () => {
  // Stein a6 springt über b7 auf c8. Früher schlug er von dort weiter über c7 nach c6 und wurde nie befördert.
  const st = scene([['a6', 'stone'], ['b7', 'INF'], ['c7', 'INF'], ['e8', 'FL'], ['h1', 'stone']]);
  st.turn = 'M';
  const moves = legalMoves(st, f('a6')).filter((m) => m.cap.length);
  assert.deepEqual(moves.map((m) => sqName(m.to)), ['c8']);
  assert.deepEqual(moves[0].cap.map(sqName), ['b7']);
  const after = applyMove(st, f('a6'), f('c8'));
  assert.deepEqual(after.pending, { kind: 'promoM', at: f('c8') });
  assert.equal(after.board[f('c7')]?.t, 'INF');
  const promoted = resolvePromotionRoll(after, [3, 3]);
  assert.equal(promoted.board[f('c8')]?.t, 'PT');
});

test('Beförderte Steine gelten als Offiziere und haben Schlagpflicht', () => {
  const st = scene([['a8', 'PT'], ['a3', 'KAN'], ['h3', 'stone'], ['e7', 'FL']]);
  st.turn = 'M';
  assert.deepEqual(targets(st, 'h3'), []);
  assert.deepEqual(targets(st, 'a8'), ['a3']);
  const plain = scene([['b4', 'stone'], ['c5', 'KAN'], ['h3', 'stone'], ['e8', 'FL']]);
  plain.turn = 'M';
  assert.ok(targets(plain, 'h3').length > 0, 'Normale Steine bleiben ohne Schlagpflicht');
});

test('Protokoll: vollständige Zugliste neben dem kurzen Logbuch', () => {
  let st = startGame(newGame(Math.random), 'M');
  st = applyMove(st, f('c3'), f('d4'));
  assert.ok((st.record ?? []).some((l) => l.includes('c3 → d4')));
  assert.equal(st.record?.[0], 'Neue Partie. Karten verteilt.');
});

test('Feedback-Schnappschuss: Brett als Text mit Reihe 8 oben', async () => {
  const { boardText, gameSnapshot } = await import('./snapshot.ts');
  const st = startGame(newGame(Math.random), 'M');
  const text = boardText(st);
  assert.match(text.split('\n')[0], /^8  K M P C F P M K/);
  assert.match(text.split('\n')[7], /^1  s s s s s s s s/);
  assert.equal(gameSnapshot(st).record.at(-1), 'Mannschaft beginnen');
});

test('Ausgespielte Karte wird für die Gegenseite gemerkt', () => {
  const st = startGame({ ...newGame(Math.random), hands: { M: ['grog'], O: [] } }, 'M');
  const played = playCard(st, 'M', 0, Math.random);
  assert.equal(played.lastCard?.key, 'grog');
  assert.equal(played.lastCard?.side, 'M');
  assert.equal(played.lastCard?.v, played.v);
});

test('Geschlagene Figuren als Text', async () => {
  const { capturedText } = await import('./battle.ts');
  assert.equal(capturedText(['stone', 'stone', 'PT']), '2 Steine, 1 beförderter Turm');
  assert.equal(capturedText([]), '');
});
