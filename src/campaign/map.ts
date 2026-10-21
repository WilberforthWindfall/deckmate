// Campaign maps of Angelonia: pointy-top hex grid (odd rows shifted right), grouped into provinces.
// The classic map is hand-made; generated maps come from mapgen.ts.
// Pure data + geometry helpers, no UI.

export type House = 'R' | 'K';
export type Land = 'A' | 'W' | 'S' | 'G' | 'F' | 'K' | 'H';

export const HOUSES: Record<House, { n: string; color: string; light: string }> = {
  R: { n: 'Ravensmoor', color: '#A8322D', light: '#F2C9C2' },
  K: { n: 'Kerrow', color: '#2C5DB8', light: '#C9D8F2' },
};

export const LAND: Record<Land, { n: string; tile: string; forage: number; defense: number; battle: 'ebene' | 'fluss' | 'gebirge' | 'huegel'; note: string }> = {
  A: { n: 'Ackerland', tile: 'acker', forage: 2, defense: 1, battle: 'ebene', note: 'Fourage bringt +2 statt +1.' },
  W: { n: 'Wald', tile: 'wald', forage: 1, defense: 1.1, battle: 'ebene', note: 'Verteidiger etwas stärker.' },
  S: { n: 'Sumpf', tile: 'sumpf', forage: 1, defense: 1, battle: 'ebene', note: 'Fieber: Heere verlieren 1 Figur pro Runde.' },
  G: { n: 'Gebirge', tile: 'gebirge', forage: 0, defense: 1.3, battle: 'gebirge', note: 'Verteidiger deutlich stärker, keine Fourage.' },
  F: { n: 'Flussland', tile: 'fluss', forage: 1, defense: 1, battle: 'fluss', note: 'Schlacht an der Furt.' },
  K: { n: 'Küste', tile: 'kueste', forage: 1, defense: 1, battle: 'ebene', note: 'Keine Besonderheit.' },
  H: { n: 'Hügelland', tile: 'huegel', forage: 1, defense: 1.2, battle: 'huegel', note: 'Verteidiger stärker, in der Schlacht beginnt er.' },
};

const CLASSIC_ROWS = [
  '~~~~~~~~~~~~~~',
  '~~KKKWWWGG~~~~',
  '~KKKWWWFGGGK~~',
  '~KHHWWFFGGGKK~',
  '~HHHAAFFAGGGKK',
  '~~HHAAAFAGGGHK',
  '~~HHAAAFFGGHHK',
  '~KHSSAFFAAGHKK',
  '~KKSSSFAAAHKK~',
  '~~KSSSFAAAKK~~',
  '~~KKSAFAAKK~~~',
  '~~~KSAAAAK~~~~',
  '~~~~~~KAAK~~~~',
  '~~~~~~~KK~~~~~',
  '~~~~~~~~~~~~~~',
];

export interface ProvinceDef { id: string; n: string; seed: [number, number]; land: Land; city?: boolean; capital?: House; start?: House }

/**
 * A complete campaign map. It lives in the campaign state, so a running game never changes when the generator does.
 * `rows`: one character per hex (land letter or "~" for sea). `provRows`: province index per hex (see PROV_CHARS,
 * "." for sea); without it every land hex belongs to the nearest province seed.
 */
export interface MapDef {
  id: string;
  name: string;
  rows: string[];
  provRows?: string[];
  provinces: ProvinceDef[];
  /** Province where each house's second army starts. */
  second: Record<House, string>;
  fix?: Record<string, string>;
  /** Generated maps: the code it was made from and its fairness check. */
  code?: string;
  fairness?: { score: number; trial?: { R: number; K: number; draws: number; games: number } };
}
export const PROV_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const CLASSIC: MapDef = {
  id: 'klassisch', name: 'Angelonia (klassisch)', rows: CLASSIC_ROWS, second: { R: 'suedhafen', K: 'ostkueste' },
  fix: { '6,5': 'aldfurt', '6,4': 'aldfurt', '7,4': 'mittelland', '6,3': 'mittelland', '7,3': 'mittelland', '8,4': 'mittelland' },
  provinces: [
    { id: 'nordheim', n: 'Nordheim', seed: [2, 2], land: 'K', city: true },
    { id: 'grauwald', n: 'Grauwald', seed: [5, 2], land: 'W' },
    { id: 'hochkamm', n: 'Hochkamm', seed: [9, 2], land: 'G' },
    { id: 'kapostra', n: 'Kap Ostra', seed: [12, 4], land: 'K', city: true, capital: 'K', start: 'K' },
    { id: 'westmark', n: 'Westmark', seed: [2, 5], land: 'H', start: 'R' },
    { id: 'aldfurt', n: 'Aldfurt', seed: [5, 5], land: 'A', city: true, capital: 'R', start: 'R' },
    { id: 'mittelland', n: 'Mittelland', seed: [7, 5], land: 'F' },
    { id: 'sturmgrat', n: 'Sturmgrat', seed: [10, 6], land: 'G', start: 'K' },
    { id: 'suedhafen', n: 'Südhafen', seed: [2, 8], land: 'K', city: true, start: 'R' },
    { id: 'rotmoor', n: 'Rotmoor', seed: [4, 9], land: 'S' },
    { id: 'weidenau', n: 'Weidenau', seed: [8, 8], land: 'A' },
    { id: 'ostkueste', n: 'Ostküste', seed: [11, 8], land: 'K', city: true, start: 'K' },
    { id: 'tiefland', n: 'Tiefland', seed: [7, 11], land: 'A', city: true },
  ],
};

export const HEX_R = 34;
const HEX_W = Math.sqrt(3) * HEX_R;
export const center = (c: number, r: number): [number, number] => [44 + c * HEX_W + (r % 2 ? HEX_W / 2 : 0), 52 + r * 1.5 * HEX_R];
export const mapSize = (cols: number, rows: number) => ({ w: 44 + cols * HEX_W + HEX_W / 2 + 10, h: 52 + (rows - 1) * 1.5 * HEX_R + HEX_R + 18 });

const cube = (c: number, r: number) => { const x = c - (r - (r & 1)) / 2; return [x, -x - r, r]; };
const dist = (a: [number, number], b: [number, number]) => { const p = cube(...a), q = cube(...b); return Math.max(...p.map((v, i) => Math.abs(v - q[i]))); };
export const gridDist = dist;

export interface Hex { c: number; r: number; land: Land | null; prov: string | null }
export type HexKey = string;
export const hk = (c: number, r: number): HexKey => `${c},${r}`;
export const parseHex = (k: HexKey): [number, number] => k.split(',').map(Number) as [number, number];

/** Everything derived from a MapDef: hexes with provinces, adjacency, lookups. Pure – also used for previews. */
export interface GameMap {
  def: MapDef; cols: number; rows: number; w: number; h: number;
  hexes: Hex[]; provinces: ProvinceDef[]; prov: Record<string, ProvinceDef>; adj: Record<string, string[]>;
  hex: Record<HexKey, Hex>; hexAdj: Record<HexKey, HexKey[]>; cityHex: Record<HexKey, string>;
}

export function gridNeighbours(c: number, r: number, cols: number, rows: number): [number, number][] {
  const d = r % 2 ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return d.map(([a, b]) => [c + a, r + b] as [number, number]).filter(([x, y]) => x >= 0 && x < cols && y >= 0 && y < rows);
}

export function buildMap(def: MapDef): GameMap {
  const cols = def.rows[0].length, rows = def.rows.length;
  const hexes: Hex[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = def.rows[r][c];
    if (ch === '~') { hexes.push({ c, r, land: null, prov: null }); continue; }
    let pid: string;
    if (def.provRows) pid = def.provinces[PROV_CHARS.indexOf(def.provRows[r][c])].id;
    else {
      let best = def.provinces[0], bd = Infinity;
      for (const p of def.provinces) { const d = dist([c, r], p.seed); if (d < bd) { bd = d; best = p; } }
      pid = def.fix?.[hk(c, r)] ?? best.id;
    }
    hexes.push({ c, r, land: ch as Land, prov: pid });
  }
  const at = (c: number, r: number) => hexes[r * cols + c];
  const a: Record<string, Set<string>> = Object.fromEntries(def.provinces.map((p) => [p.id, new Set<string>()]));
  for (const h of hexes) if (h.prov) for (const [c, r] of gridNeighbours(h.c, h.r, cols, rows)) { const n = at(c, r); if (n.prov && n.prov !== h.prov) a[h.prov].add(n.prov); }
  const hex: Record<HexKey, Hex> = Object.fromEntries(hexes.filter((h) => h.land && h.prov).map((h) => [hk(h.c, h.r), h]));
  const hexAdj: Record<HexKey, HexKey[]> = Object.fromEntries(Object.keys(hex).map((k) => {
    const [c, r] = parseHex(k);
    return [k, gridNeighbours(c, r, cols, rows).map(([x, y]) => hk(x, y)).filter((n) => !!hex[n])];
  }));
  const { w, h } = mapSize(cols, rows);
  return {
    def, cols, rows, w, h, hexes, provinces: def.provinces, prov: Object.fromEntries(def.provinces.map((p) => [p.id, p])),
    adj: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, [...v].sort()])), hex, hexAdj,
    cityHex: Object.fromEntries(def.provinces.filter((p) => p.city).map((p) => [hk(...p.seed), p.id])),
  };
}

// ---- The active map ----
// The engine and the views read the map through these module-level lookups. activateMap() swaps their contents in
// place (objects and arrays keep their identity, numbers are live bindings), so only one campaign map is active at
// a time – the one being played or simulated.

export let COLS = 0;
export let NROWS = 0;
export let MAP_W = 0;
export let MAP_H = 0;
export const HEXES: Hex[] = [];
export const PROVINCES: ProvinceDef[] = [];
export const PROV: Record<string, ProvinceDef> = {};
export const ADJ: Record<string, string[]> = {};
export const LAND_HEXES: Hex[] = [];
export const HEX: Record<HexKey, Hex> = {};
export const HEX_ADJ: Record<HexKey, HexKey[]> = {};
export const CITY_HEX: Record<HexKey, string> = {};
let active: MapDef | null = null;

const refill = <T>(o: Record<string, T>, n: Record<string, T>) => { for (const k of Object.keys(o)) delete o[k]; Object.assign(o, n); };
const refillA = <T>(a: T[], n: T[]) => { a.length = 0; a.push(...n); };

/** Make `def` the active map (cheap if it already is). */
export function activateMap(def: MapDef = CLASSIC): GameMap | null {
  if (active && active.id === def.id) return null;
  const m = buildMap(def);
  active = def;
  COLS = m.cols; NROWS = m.rows; MAP_W = m.w; MAP_H = m.h;
  refillA(HEXES, m.hexes); refillA(PROVINCES, m.provinces); refillA(LAND_HEXES, Object.values(m.hex));
  refill(PROV, m.prov); refill(ADJ, m.adj); refill(HEX, m.hex); refill(HEX_ADJ, m.hexAdj); refill(CITY_HEX, m.cityHex);
  return m;
}
export const activeMap = () => active ?? CLASSIC;
activateMap(CLASSIC);

export function neighbours(c: number, r: number): [number, number][] { return gridNeighbours(c, r, COLS, NROWS); }
const at = (c: number, r: number) => HEXES[r * COLS + c];

export const adjacent = (a: string, b: string) => ADJ[a]?.includes(b) ?? false;

/** Corner points of a hex, for SVG. */
export function hexPoints(c: number, r: number, inset = 0): [number, number][] {
  const [x, y] = center(c, r), R = HEX_R - inset;
  return [0, 1, 2, 3, 4, 5].map((i) => { const ang = (Math.PI / 180) * (60 * i - 30); return [x + R * Math.cos(ang), y + R * Math.sin(ang)]; });
}

/** The six sides of a hex with the neighbouring cell on the other side (may lie outside the grid). */
export function hexSides(c: number, r: number): { a: [number, number]; b: [number, number]; n: [number, number] }[] {
  const pts = hexPoints(c, r);
  const odd = r % 2 === 1;
  const nb: [number, number][] = [
    [c + 1, r], odd ? [c + 1, r + 1] : [c, r + 1], odd ? [c, r + 1] : [c - 1, r + 1],
    [c - 1, r], odd ? [c, r - 1] : [c - 1, r - 1], odd ? [c + 1, r - 1] : [c, r - 1],
  ];
  return nb.map((n, i) => ({ a: pts[i], b: pts[(i + 1) % 6], n }));
}

export const inGrid = (c: number, r: number) => c >= 0 && c < COLS && r >= 0 && r < NROWS;

export const hexAt = at;

/** Center of a province for labels and tokens: the seed hex. */
export const provCenter = (id: string) => center(...PROV[id].seed);

// ---- Hex fields as the unit of movement and ownership ----

export const isLand = (k: HexKey) => !!HEX[k];
export const hexCenter = (k: HexKey) => center(...parseHex(k));
export const hexProv = (k: HexKey) => HEX[k]?.prov ?? null;
export const hexLand = (k: HexKey) => HEX[k]!.land!;
export const hexDist = (a: HexKey, b: HexKey) => dist(parseHex(a), parseHex(b));
/** The hex of a province's city (its seed hex). */
export const cityHex = (prov: string) => hk(...PROV[prov].seed);
export const provHexes = (prov: string) => Object.keys(HEX).filter((k) => HEX[k].prov === prov);
/** Name of a hex for texts: its province, plus "Stadt" for a city hex. */
export const hexName = (k: HexKey) => (CITY_HEX[k] ? `Stadt ${PROV[CITY_HEX[k]].n}` : PROV[hexProv(k)!].n);

/** Movement cost of entering a hex: mountains and swamps cost double. */
export const stepCost = (k: HexKey) => (hexLand(k) === 'G' || hexLand(k) === 'S' ? 2 : 1);

/**
 * Cheapest costs from a hex within a budget (Dijkstra). `stop` hexes may be entered but not left (e.g. enemy armies),
 * `block` hexes may not be entered at all.
 */
export function reachable(from: HexKey, budget: number, stop: Set<HexKey> = new Set(), block: Set<HexKey> = new Set()) {
  const cost: Record<HexKey, number> = { [from]: 0 };
  const prev: Record<HexKey, HexKey | null> = { [from]: null };
  // step costs are small integers, so a bucket queue replaces the priority queue
  const buckets: HexKey[][] = [[from]];
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (let i = 0; i < b.length; i++) {
      const k = b[i];
      if (cost[k] !== d) continue;
      if (k !== from && stop.has(k)) continue;
      for (const n of HEX_ADJ[k]) {
        if (block.has(n)) continue;
        const nc = d + stepCost(n);
        if (nc > budget || (n in cost && cost[n] <= nc)) continue;
        cost[n] = nc; prev[n] = k; (buckets[nc] ??= []).push(n);
      }
    }
  }
  return { cost, prev };
}
/** Path from `from` to `to` (without `from`) using a `reachable` result. */
export function pathTo(prev: Record<HexKey, HexKey | null>, to: HexKey): HexKey[] {
  const out: HexKey[] = [];
  for (let k: HexKey | null = to; k && prev[k] !== undefined && prev[k] !== null; k = prev[k]!) out.unshift(k);
  return out;
}
/** Shortest walking path over land ignoring costs (for traders). */
export function walkPath(from: HexKey, to: HexKey): HexKey[] | null {
  const prev: Record<HexKey, HexKey | null> = { [from]: null };
  const q = [from];
  while (q.length) {
    const k = q.shift()!;
    if (k === to) break;
    for (const n of HEX_ADJ[k]) if (!(n in prev)) { prev[n] = k; q.push(n); }
  }
  if (!(to in prev)) return null;
  return pathTo(prev, to);
}
