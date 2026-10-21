// Map generator for Angelonia. A short code (e.g. "MAN1-7F3KQ") always yields the same map: size, character and
// number of cities are part of the code, the rest is a seed word. Every generated map passes a fairness filter
// (both houses get comparable capitals, equal reach to neutral cities and land); a code tries sub-seeds until one
// passes, so the code alone is enough to rebuild it.
import {
  LAND, PROV_CHARS, buildMap, gridDist, gridNeighbours, hk,
  type GameMap, type HexKey, type House, type Land, type MapDef, type ProvinceDef,
} from './map.ts';

export const GEN_VERSION = 1;
export type MapSize = 'S' | 'M' | 'L';
export type MapChar = 'A' | 'K' | 'G' | 'S' | 'F';
export type CityLevel = 'W' | 'N' | 'V';
export interface GenParams { size: MapSize; char: MapChar; cities: CityLevel; seed: string }

export const SIZES: Record<MapSize, { n: string; cols: number; rows: number; provinces: number; neutral: number; land: number; minCap: number; rounds: number }> = {
  S: { n: 'Klein', cols: 14, rows: 15, provinces: 13, neutral: 2, land: 0.55, minCap: 8, rounds: 10 },
  M: { n: 'Mittel', cols: 20, rows: 19, provinces: 21, neutral: 4, land: 0.52, minCap: 11, rounds: 14 },
  L: { n: 'Groß', cols: 28, rows: 23, provinces: 32, neutral: 7, land: 0.5, minCap: 14, rounds: 18 },
};
export const CHARS: Record<MapChar, { n: string; text: string }> = {
  A: { n: 'Ausgewogen', text: 'Von allem etwas.' },
  K: { n: 'Küstenreich', text: 'Zerklüftete Küsten, Buchten und Halbinseln.' },
  G: { n: 'Gebirgsland', text: 'Viele Berge und Hügel, enge Pässe.' },
  S: { n: 'Sumpfmarsch', text: 'Weite Moore – Fieber und langsame Märsche.' },
  F: { n: 'Flusstäler', text: 'Viele Flüsse mit Furten, fruchtbare Täler.' },
};
export const CITY_LEVELS: Record<CityLevel, { n: string; f: number }> = {
  W: { n: 'Wenige', f: 0.5 }, N: { n: 'Normal', f: 1 }, V: { n: 'Viele', f: 1.6 },
};

// ---------- code ----------

const WORD = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomWord(rng: () => number = Math.random, n = 5) { let s = ''; for (let i = 0; i < n; i++) s += WORD[Math.floor(rng() * WORD.length)]; return s; }
export const mapCode = (p: GenParams) => `${p.size}${p.char}${p.cities}${GEN_VERSION}-${p.seed.toUpperCase()}`;
/** Reads a code like "MAN1-7F3KQ" (case and spaces don't matter). */
export function parseCode(code: string): GenParams | null {
  const m = /^([SML])([AKGSF])([WNV])(\d+)-([A-Z0-9]{1,12})$/.exec(code.trim().toUpperCase().replace(/\s+/g, ''));
  return m ? { size: m[1] as MapSize, char: m[2] as MapChar, cities: m[3] as CityLevel, seed: m[5] } : null;
}

// ---------- randomness ----------

function hashStr(s: string) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; }
export function rngFrom(s: string) {
  let a = hashStr(s);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Smooth value noise over the plane, several octaves, values in 0..1. */
function noise(rng: () => number, scale: number) {
  const grids = [1, 2, 4].map((f) => { const n = Math.ceil(scale * f) + 2; return { f, n, v: Array.from({ length: n * n }, rng) }; });
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    let sum = 0, wsum = 0;
    for (const { f, n, v } of grids) {
      const gx = x * scale * f, gy = y * scale * f, ix = Math.floor(gx), iy = Math.floor(gy), fx = sm(gx - ix), fy = sm(gy - iy);
      const g = (a: number, b: number) => v[Math.min(n - 1, Math.max(0, b)) * n + Math.min(n - 1, Math.max(0, a))];
      const top = g(ix, iy) * (1 - fx) + g(ix + 1, iy) * fx, bot = g(ix, iy + 1) * (1 - fx) + g(ix + 1, iy + 1) * fx;
      const w = 1 / f; sum += (top * (1 - fy) + bot * fy) * w; wsum += w;
    }
    return sum / wsum;
  };
}
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; };

// ---------- names ----------

const PRE = ['Ald', 'Bren', 'Dorn', 'Eich', 'Fal', 'Grau', 'Hag', 'Hohen', 'Kalt', 'Lind', 'Mar', 'Nord', 'Ost', 'Raben', 'Rot', 'Sal', 'Schwarz', 'Silber',
  'Stein', 'Sturm', 'Süd', 'Tann', 'Weiß', 'West', 'Wolf', 'Wil', 'Gold', 'Eis', 'Heid', 'Blau', 'Brun', 'Elm', 'Fenn', 'Hart', 'Kron', 'Lerch', 'Mittel',
  'Neu', 'Alt', 'Asch', 'Birk', 'Dunkel', 'Erl', 'Frei', 'Grün', 'Hasel', 'Igel', 'Kiefer', 'Lang', 'Mühl', 'Otter', 'Rosen', 'Schilf', 'Tief', 'Ulm', 'Wacht'];
const SUF: Record<Land, string[]> = {
  K: ['hafen', 'küste', 'bucht', 'strand', 'kap', 'sund'], G: ['grat', 'kamm', 'fels', 'horn', 'berg', 'zinne'], W: ['wald', 'forst', 'hain', 'tann', 'holz'],
  S: ['moor', 'bruch', 'fenn', 'ried', 'sumpf'], F: ['furt', 'au', 'bach', 'brück', 'wasser'], A: ['feld', 'au', 'heim', 'dorf', 'land', 'acker'],
  H: ['mark', 'hügel', 'höh', 'heim', 'leite'],
};

// ---------- generation ----------

type Grid = { cols: number; rows: number; land: (Land | null)[] };
const idxOf = (g: Grid, c: number, r: number) => r * g.cols + c;
const nbrs = (g: Grid, i: number) => gridNeighbours(i % g.cols, Math.floor(i / g.cols), g.cols, g.rows).map(([c, r]) => idxOf(g, c, r));

function landmass(p: GenParams, rng: () => number): Grid {
  const S = SIZES[p.size];
  const g: Grid = { cols: S.cols, rows: S.rows, land: Array(S.cols * S.rows).fill(null) };
  const n1 = noise(rng, p.char === 'K' ? 4.2 : 2.6);
  const target = S.land * (p.char === 'K' ? 0.86 : 1);
  const v: number[] = [];
  for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
    const x = (c + (r % 2) / 2) / S.cols, y = r / S.rows, nx = x * 2 - 1, ny = y * 2 - 1;
    const fall = 1 - Math.pow(nx * nx + ny * ny, 0.75);
    const edge = c === 0 || r === 0 || c === S.cols - 1 || r === S.rows - 1;
    v.push(edge ? -9 : fall * 0.95 + (n1(x, y) - 0.5) * (p.char === 'K' ? 1.2 : 0.8));
  }
  const thr = quantile(v, 1 - target);
  v.forEach((x, i) => { g.land[i] = x > thr ? 'A' : null; });
  // keep the largest island, fill inland lakes
  const seen = new Set<number>(); let best: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (!g.land[i] || seen.has(i)) continue;
    const comp = [i]; seen.add(i);
    for (let k = 0; k < comp.length; k++) for (const n of nbrs(g, comp[k])) if (g.land[n] && !seen.has(n)) { seen.add(n); comp.push(n); }
    if (comp.length > best.length) best = comp;
  }
  const keep = new Set(best);
  g.land = g.land.map((l, i) => (keep.has(i) ? l : null));
  const sea = new Set<number>([0]); const q = [0];
  for (let k = 0; k < q.length; k++) for (const n of nbrs(g, q[k])) if (!g.land[n] && !sea.has(n)) { sea.add(n); q.push(n); }
  g.land = g.land.map((l, i) => (l || sea.has(i) ? l : 'A'));
  return g;
}

function terrain(g: Grid, p: GenParams, rng: () => number) {
  const H = noise(rng, 2.2), Wn = noise(rng, 2.8);
  const landIdx = g.land.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
  // distance to the sea (in hexes)
  const cd = new Map<number, number>(); const q: number[] = [];
  for (const i of landIdx) if (nbrs(g, i).some((n) => !g.land[n])) { cd.set(i, 1); q.push(i); }
  for (let k = 0; k < q.length; k++) for (const n of nbrs(g, q[k])) if (g.land[n] && !cd.has(n)) { cd.set(n, cd.get(q[k])! + 1); q.push(n); }
  const pos = (i: number) => [((i % g.cols) + (Math.floor(i / g.cols) % 2) / 2) / g.cols, Math.floor(i / g.cols) / g.rows];
  const height = new Map(landIdx.map((i) => [i, H(...(pos(i) as [number, number])) * 0.75 + Math.min(1, (cd.get(i)! - 1) / 4) * 0.35]));
  const wet = new Map(landIdx.map((i) => [i, Wn(...(pos(i) as [number, number]))]));
  const share = { G: 0.13, H: 0.13, S: 0.11, W: 0.18, K: 0.6 };
  if (p.char === 'G') { share.G = 0.24; share.H = 0.2; }
  if (p.char === 'S') { share.S = 0.27; share.W = 0.14; }
  if (p.char === 'K') share.K = 0.85;
  if (p.char === 'F') { share.S = 0.08; share.G = 0.11; }
  const coast = landIdx.filter((i) => cd.get(i) === 1);
  const inner = landIdx.filter((i) => cd.get(i)! > 1);
  for (const i of coast) g.land[i] = rng() < share.K ? 'K' : null;
  const rest = landIdx.filter((i) => g.land[i] !== 'K');
  const hs = rest.map((i) => height.get(i)!);
  const tG = quantile(hs, 1 - share.G), tH = quantile(hs, 1 - share.G - share.H);
  for (const i of rest) { const h = height.get(i)!; g.land[i] = h >= tG && cd.get(i)! > 1 ? 'G' : h >= tH ? 'H' : null; }
  const low = rest.filter((i) => !g.land[i]);
  const ws = low.map((i) => wet.get(i)!);
  const tS = quantile(ws, 1 - share.S / (1 - share.G - share.H)), tW = quantile(ws, 1 - (share.S + share.W) / (1 - share.G - share.H));
  for (const i of low) { const w = wet.get(i)!; g.land[i] = w >= tS ? 'S' : w >= tW ? 'W' : 'A'; }
  // rivers: from the highlands downhill to the sea, they turn into fords
  const nRiv = Math.round((p.size === 'S' ? 1 : p.size === 'M' ? 2 : 3) * (p.char === 'F' ? 2.2 : 1));
  const used = new Set<number>();
  const sources = inner.filter((i) => g.land[i] === 'G' || g.land[i] === 'H').sort((a, b) => height.get(b)! - height.get(a)!);
  for (let r = 0, si = 0; r < nRiv && si < sources.length; si++) {
    const s0 = sources[Math.floor(rng() * Math.min(sources.length, 12 + si))];
    if ([...used].some((u) => gridDist([u % g.cols, Math.floor(u / g.cols)], [s0 % g.cols, Math.floor(s0 / g.cols)]) < 3)) continue;
    let at = s0; const path: number[] = [];
    for (let step = 0; step < 40; step++) {
      const opts = nbrs(g, at).filter((n) => !path.includes(n) && n !== s0);
      if (opts.some((n) => !g.land[n])) break; // reached the sea
      const land = opts.filter((n) => g.land[n]);
      if (!land.length) break;
      land.sort((a, b) => (height.get(a)! + rng() * 0.15) - (height.get(b)! + rng() * 0.15) || cd.get(a)! - cd.get(b)!);
      at = land[0]; path.push(at);
    }
    if (path.length < 3) continue;
    for (const i of path) { if (g.land[i] !== 'K') g.land[i] = 'F'; used.add(i); }
    r++;
  }
}

function provinces(g: Grid, p: GenParams, rng: () => number) {
  const S = SIZES[p.size];
  const landIdx = g.land.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
  const cr = (i: number): [number, number] => [i % g.cols, Math.floor(i / g.cols)];
  const d = (a: number, b: number) => gridDist(cr(a), cr(b));
  const coastal = (i: number) => nbrs(g, i).some((n) => !g.land[n]);
  // farthest-point seeds, then two rounds of relaxation towards the middle of each region
  let seeds: number[] = [landIdx.filter((i) => !coastal(i))[Math.floor(rng() * landIdx.length * 0.5)] ?? landIdx[0]];
  while (seeds.length < S.provinces) {
    let best = -1, bd = -1;
    for (const i of landIdx) { const m = Math.min(...seeds.map((s) => d(s, i))) + rng() * 0.9 - (coastal(i) ? 0.3 : 0); if (m > bd) { bd = m; best = i; } }
    seeds.push(best);
  }
  const grow = (ss: number[]) => {
    const owner = new Map<number, number>(); const q: number[] = [];
    ss.forEach((s, k) => { owner.set(s, k); q.push(s); });
    for (let k = 0; k < q.length; k++) for (const n of nbrs(g, q[k])) if (g.land[n] && !owner.has(n)) { owner.set(n, owner.get(q[k])!); q.push(n); }
    return owner;
  };
  for (let it = 0; it < 2; it++) {
    const owner = grow(seeds);
    seeds = seeds.map((s, k) => {
      const mine = landIdx.filter((i) => owner.get(i) === k);
      if (!mine.length) return s;
      const [mx, my] = mine.reduce(([x, y], i) => [x + cr(i)[0], y + cr(i)[1]], [0, 0]).map((v) => v / mine.length);
      return mine.reduce((a, b) => (Math.hypot(cr(a)[0] - mx, cr(a)[1] - my) <= Math.hypot(cr(b)[0] - mx, cr(b)[1] - my) ? a : b));
    });
  }
  return { seeds, owner: grow(seeds) };
}

function toDef(g: Grid, seeds: number[], owner: Map<number, number>, p: GenParams, rng: () => number, attempt: number): MapDef | null {
  const S = SIZES[p.size];
  const cr = (i: number): [number, number] => [i % g.cols, Math.floor(i / g.cols)];
  const used = new Set<string>();
  const usedPre = new Set<string>();
  const provs: ProvinceDef[] = seeds.map((s, k) => {
    const lands = [...owner].filter(([, o]) => o === k).map(([i]) => g.land[i]!);
    const count: Partial<Record<Land, number>> = {};
    for (const l of lands) count[l] = (count[l] ?? 0) + 1;
    const land = (Object.keys(count) as Land[]).sort((a, b) => count[b]! - count[a]!)[0];
    let n = '';
    for (let t = 0; t < 40 && (!n || used.has(n)); t++) {
      const pre = PRE[Math.floor(rng() * PRE.length)];
      if (usedPre.has(pre) && t < 30) continue;
      const suf = SUF[land][Math.floor(rng() * SUF[land].length)];
      n = pre + suf; if (!used.has(n)) usedPre.add(pre);
    }
    used.add(n);
    return { id: `p${k}`, n, seed: cr(s), land };
  });
  // province graph
  const adj: Set<number>[] = seeds.map(() => new Set());
  for (const [i, o] of owner) for (const nn of nbrs(g, i)) { const q = owner.get(nn); if (q !== undefined && q !== o) adj[o].add(q); }
  const pd = (a: number) => { const dist = seeds.map(() => Infinity); dist[a] = 0; const q = [a]; for (let k = 0; k < q.length; k++) for (const n of adj[q[k]]) if (dist[n] === Infinity) { dist[n] = dist[q[k]] + 1; q.push(n); } return dist; };
  const all = seeds.map((_, k) => pd(k));
  // capitals: one of the most distant pairs of well-connected provinces
  const cand = seeds.map((_, k) => k).filter((k) => adj[k].size >= 3);
  const pairs: [number, number, number][] = [];
  for (const a of cand) for (const b of cand) if (a < b && all[a][b] < Infinity) pairs.push([a, b, all[a][b] + gridDist(cr(seeds[a]), cr(seeds[b])) * 0.15]);
  pairs.sort((x, y) => y[2] - x[2]);
  if (!pairs.length) return null;
  const [a0, b0] = pairs[Math.floor(rng() * Math.min(pairs.length, 6))];
  const [ca, cb] = rng() < 0.5 ? [a0, b0] : [b0, a0];
  const start: Record<House, number[]> = { R: [ca], K: [cb] };
  for (const [h, cap, foe] of [['R', ca, cb], ['K', cb, ca]] as [House, number, number][]) {
    const taken = new Set([...start.R, ...start.K]);
    const nb = [...adj[cap]].filter((x) => !taken.has(x) && all[foe][x] > 1).sort((x, y) => all[foe][y] - all[foe][x] + (rng() - 0.5));
    if (nb.length < 2) return null;
    start[h].push(nb[0], nb[1]);
  }
  provs[ca].capital = 'R'; provs[cb].capital = 'K';
  // capitals stand on open land, so neither starts behind a wall of forest or hills
  for (const k of [ca, cb]) if (g.land[seeds[k]] !== 'K') g.land[seeds[k]] = 'A';
  for (const h of ['R', 'K'] as House[]) for (const k of start[h]) provs[k].start = h;
  // second army and city: the start province farther from the own capital's neighbours
  const second: Record<House, string> = { R: '', K: '' };
  for (const h of ['R', 'K'] as House[]) {
    const k = start[h][1 + Math.floor(rng() * 2)];
    provs[k].city = true; second[h] = provs[k].id;
  }
  provs[ca].city = true; provs[cb].city = true;
  // neutral cities spread over the rest, alternately on the side of each house so neither gets the easy ones
  const nNeutral = Math.max(1, Math.round(S.neutral * CITY_LEVELS[p.cities].f));
  const cities = provs.map((_, k) => k).filter((k) => provs[k].city);
  const free = provs.map((_, k) => k).filter((k) => !provs[k].start);
  for (let i = 0; i < nNeutral && free.length; i++) {
    let best = -1, bs = -Infinity;
    for (const k of free) {
      if (provs[k].city) continue;
      const spread = Math.min(...cities.map((x) => all[x][k]));
      const bal = -Math.abs(all[ca][k] - all[cb][k]) * 0.9;
      const s = spread + bal + rng() * 0.8;
      if (s > bs) { bs = s; best = k; }
    }
    if (best < 0) break;
    provs[best].city = true; cities.push(best);
  }
  const rows: string[] = [], provRows: string[] = [];
  for (let r = 0; r < g.rows; r++) {
    let a = '', b = '';
    for (let c = 0; c < g.cols; c++) { const i = r * g.cols + c; a += g.land[i] ?? '~'; b += g.land[i] ? PROV_CHARS[owner.get(i)!] : '.'; }
    rows.push(a); provRows.push(b);
  }
  // city hexes keep their land, but a city never stands in a river ford
  const code = mapCode(p);
  return { id: `gen:${code}${attempt ? `#${attempt}` : ''}`, name: `Angelonia · ${code}`, code, rows, provRows, provinces: provs, second };
}

// ---------- fairness ----------

export interface FairRow { label: string; R: number; K: number; ok: boolean; unit?: string }
export interface Fairness { score: number; ok: boolean; rows: FairRow[] }

/** Movement costs from a hex over the whole map (Dijkstra with mountain and swamp costs). */
function costs(m: GameMap, from: HexKey) {
  const step = (k: HexKey) => (m.hex[k].land === 'G' || m.hex[k].land === 'S' ? 2 : 1);
  const cost: Record<HexKey, number> = { [from]: 0 }; const open = [from];
  while (open.length) {
    open.sort((a, b) => cost[a] - cost[b]);
    const k = open.shift()!;
    for (const n of m.hexAdj[k]) { const nc = cost[k] + step(n); if (!(n in cost) || nc < cost[n]) { cost[n] = nc; open.push(n); } }
  }
  return cost;
}

/** How evenly a map treats both houses (measured, not played). */
export function fairness(def: MapDef): Fairness {
  const m = buildMap(def);
  const cap = (h: House) => m.provinces.find((p) => p.capital === h)!;
  const capHex = (h: House) => hk(...cap(h).seed);
  const cR = costs(m, capHex('R')), cK = costs(m, capHex('K'));
  const neutral = m.provinces.filter((p) => p.city && !p.start);
  const d = (c: Record<HexKey, number>, p: ProvinceDef) => c[hk(...p.seed)] ?? 99;
  const reach = (c: Record<HexKey, number>, o: Record<HexKey, number>) => neutral.reduce((s, p) => s + (d(c, p) < d(o, p) ? 1 : d(c, p) === d(o, p) ? 0.5 : 0), 0);
  const land = (c: Record<HexKey, number>, o: Record<HexKey, number>) => Object.keys(m.hex).filter((k) => c[k] < o[k]).length + Object.keys(m.hex).filter((k) => c[k] === o[k]).length / 2;
  const nearCity = (c: Record<HexKey, number>) => Math.min(...neutral.map((p) => d(c, p)));
  const approach = (h: House) => m.hexAdj[capHex(h)].length;
  const defense = (h: House) => LAND[m.hex[capHex(h)].land!].defense;
  const second = (h: House, c: Record<HexKey, number>) => c[hk(...m.prov[def.second[h]].seed)];
  const total = Object.keys(m.hex).length;
  const between = cR[capHex('K')];
  const S = SIZES[(parseCode(def.code ?? '')?.size ?? 'S') as MapSize];
  const rows: FairRow[] = [
    { label: 'Neutrale Städte näher dran', R: reach(cR, cK), K: reach(cK, cR), ok: Math.abs(reach(cR, cK) - reach(cK, cR)) <= (neutral.length % 2 ? 1 : 0) + 0.01 },
    { label: 'Weg zur nächsten neutralen Stadt', R: nearCity(cR), K: nearCity(cK), ok: Math.abs(nearCity(cR) - nearCity(cK)) <= 1, unit: 'BP' },
    { label: 'Land in eigener Reichweite', R: Math.round(land(cR, cK)), K: Math.round(land(cK, cR)), ok: Math.abs(land(cR, cK) - land(cK, cR)) <= total * 0.05, unit: 'Felder' },
    { label: 'Zugänge zur Hauptstadt', R: approach('R'), K: approach('K'), ok: Math.abs(approach('R') - approach('K')) <= 1 },
    { label: 'Verteidigung der Hauptstadt', R: defense('R'), K: defense('K'), ok: Math.abs(defense('R') - defense('K')) <= 0.15, unit: '×' },
    { label: 'Weg zur zweiten eigenen Stadt', R: second('R', cR), K: second('K', cK), ok: Math.abs(second('R', cR) - second('K', cK)) <= 2, unit: 'BP' },
  ];
  const okDist = between >= S.minCap;
  const imbalance = [
    Math.abs(rows[0].R - rows[0].K) / Math.max(1, neutral.length),
    Math.abs(rows[1].R - rows[1].K) / 6,
    Math.abs(land(cR, cK) - land(cK, cR)) / total,
    Math.abs(rows[3].R - rows[3].K) / 6,
    Math.abs(rows[4].R - rows[4].K),
    Math.abs(rows[5].R - rows[5].K) / 8,
  ];
  const score = Math.max(0, Math.round(100 - imbalance.reduce((a, b) => a + b, 0) * 60 - (okDist ? 0 : 15)));
  return { score, ok: okDist && rows.every((r) => r.ok), rows };
}

/** Distance between the capitals in movement points (for the preview). */
export function capitalDistance(def: MapDef) {
  const m = buildMap(def);
  const a = m.provinces.find((p) => p.capital === 'R')!, b = m.provinces.find((p) => p.capital === 'K')!;
  return costs(m, hk(...a.seed))[hk(...b.seed)];
}

// ---------- entry point ----------

/** The map for a code. Deterministic: tries sub-seeds until a map passes the fairness filter, else the fairest one. */
export function generateMap(p: GenParams): MapDef {
  let best: { def: MapDef; f: Fairness } | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const rng = rngFrom(`${mapCode(p)}#${attempt}`);
    const g = landmass(p, rng);
    terrain(g, p, rng);
    const { seeds, owner } = provinces(g, p, rng);
    const def = toDef(g, seeds, owner, p, rng, 0);
    if (!def) continue;
    const f = fairness(def);
    def.fairness = { score: f.score };
    if (f.ok) return def;
    if (!best || f.score > best.f.score) best = { def, f };
  }
  return best!.def;
}

export const sizeOfDef = (def: MapDef): MapSize => parseCode(def.code ?? '')?.size ?? 'S';
