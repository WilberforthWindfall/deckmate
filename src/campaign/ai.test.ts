import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoBattle, finalScore, newCampaign, orderProblem, sealOrders, score, type Campaign } from './engine.ts';
import { aiOrders, type AiLevel } from './ai.ts';
import type { House } from './map.ts';

const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

function play(levels: Record<House, AiLevel | null>, seed: number, rounds = 10) {
  const rng = seeded(seed);
  let c: Campaign = newCampaign({ maxRounds: rounds, goals: true, experience: true }, rng);
  let guard = 0;
  while (c.phase !== 'over' && guard++ < 200) {
    if (c.phase === 'battles') { c = autoBattle(c, c.battles[0].id, rng); continue; }
    for (const h of ['R', 'K'] as House[]) {
      if (c.sealed[h] || c.phase !== 'orders') continue;
      const os = levels[h] ? aiOrders(c, h, levels[h]!, rng) : [];
      const ok: typeof os = [];
      for (const o of os) { assert.equal(orderProblem(c, h, o, ok), '', `ungültiger KI-Befehl ${JSON.stringify(o)}`); ok.push(o); }
      c = sealOrders(c, h, os, rng);
    }
  }
  assert.equal(c.phase, 'over');
  return c;
}

test('KI gegen KI: alle Befehle gültig, die Kampagne endet', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const c = play({ R: 'normal', K: 'normal' }, seed);
    assert.ok(c.round >= 1);
  }
  for (const seed of [7, 8]) play({ R: 'leicht', K: 'normal' }, seed);
});

test('KI schlägt einen untätigen Gegner', () => {
  let wins = 0;
  for (const seed of [11, 12, 13, 14]) {
    const c = play({ R: null, K: 'normal' }, seed);
    if (c.winner === 'K') wins++;
    assert.ok(finalScore(c, 'K') >= score(c, 'R') || c.winner === 'K');
  }
  assert.ok(wins >= 3, `nur ${wins} von 4 gewonnen`);
});

test('KI spielt auch auf generierten Karten gültig bis zum Ende', async () => {
  const { generateMap } = await import('./mapgen.ts');
  const { trialGame } = await import('./trial.ts');
  for (const code of [{ size: 'S', char: 'G', cities: 'V', seed: 'KI1' }, { size: 'L', char: 'K', cities: 'W', seed: 'KI2' }] as const) {
    const w = trialGame(generateMap(code), 'probe');
    assert.ok(w === null || w === 'R' || w === 'K');
  }
});
