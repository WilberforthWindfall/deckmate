// KI-Probelauf: the computer plays a map against itself a number of times; the result becomes the map's seal
// ("geprüft 14 : 16"). Runs in small slices so the page stays responsive.
import { autoBattle, finalScore, newCampaign, sealOrders, type Campaign } from './engine.ts';
import { aiOrders } from './ai.ts';
import { rngFrom, SIZES, sizeOfDef } from './mapgen.ts';
import { activateMap, activeMap, type House, type MapDef } from './map.ts';

export interface TrialResult { R: number; K: number; draws: number; games: number }

/** One full campaign of AI against AI on a map (normal level, battles rolled out). */
export function trialGame(def: MapDef, seed: string, rounds = SIZES[sizeOfDef(def)].rounds): House | null {
  const rng = rngFrom(seed);
  let c: Campaign = newCampaign({ maxRounds: rounds, goals: true, experience: true, map: def }, rng);
  for (let guard = 0; c.phase !== 'over' && guard < 400; guard++) {
    if (c.phase === 'battles') { c = autoBattle(c, c.battles[0].id, rng); continue; }
    for (const h of ['R', 'K'] as House[]) {
      if (c.sealed[h] || c.phase !== 'orders') continue;
      c = sealOrders(c, h, aiOrders(c, h, 'normal', rng), rng);
    }
  }
  if (c.winner) return c.winner;
  const r = finalScore(c, 'R'), k = finalScore(c, 'K');
  return r === k ? null : r > k ? 'R' : 'K';
}

/**
 * Plays `games` campaigns, yielding to the browser between them. `onProgress` gets the running tally;
 * `cancel()` on the returned handle stops early.
 */
export function runTrial(def: MapDef, games: number, onProgress: (t: TrialResult) => void): { done: Promise<TrialResult>; cancel: () => void } {
  let stop = false;
  const t: TrialResult = { R: 0, K: 0, draws: 0, games: 0 };
  const done = new Promise<TrialResult>((resolve) => {
    const step = () => {
      if (stop || t.games >= games) { resolve(t); return; }
      const before = activeMap(); // a campaign may be open behind the dialog – keep its map active
      let w: House | null;
      try { w = trialGame(def, `${def.id}/probe/${t.games}`); } finally { activateMap(before); }
      if (w) t[w]++; else t.draws++;
      t.games++;
      onProgress({ ...t });
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
  return { done, cancel: () => { stop = true; } };
}

/** Seal text and whether the result looks fair (each house wins 35–65 % of decided games). */
export function trialVerdict(t: TrialResult) {
  const dec = t.R + t.K;
  const share = dec ? t.R / dec : 0.5;
  const fair = share >= 0.35 && share <= 0.65;
  return { share, fair, text: `${t.R} : ${t.K}${t.draws ? ` (${t.draws} unentschieden)` : ''}` };
}
