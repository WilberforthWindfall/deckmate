// Campaign map of "Eridanos": pointy-top hex grid (odd rows shifted right), grouped into provinces.
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

const ROWS = [
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
export const COLS = ROWS[0].length;
export const NROWS = ROWS.length;

export interface ProvinceDef { id: string; n: string; seed: [number, number]; land: Land; city?: boolean; capital?: House; start?: House }

export const PROVINCES: ProvinceDef[] = [
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
];
export const PROV = Object.fromEntries(PROVINCES.map((p) => [p.id, p])) as Record<string, ProvinceDef>;

export const HEX_R = 34;
const HEX_W = Math.sqrt(3) * HEX_R;
export const center = (c: number, r: number): [number, number] => [44 + c * HEX_W + (r % 2 ? HEX_W / 2 : 0), 52 + r * 1.5 * HEX_R];
export const MAP_W = 44 + COLS * HEX_W + HEX_W / 2 + 10;
export const MAP_H = 52 + (NROWS - 1) * 1.5 * HEX_R + HEX_R + 18;

export function neighbours(c: number, r: number): [number, number][] {
  const d = r % 2 ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return d.map(([a, b]) => [c + a, r + b] as [number, number]).filter(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < NROWS);
}
const cube = (c: number, r: number) => { const x = c - (r - (r & 1)) / 2; return [x, -x - r, r]; };
const dist = (a: [number, number], b: [number, number]) => { const p = cube(...a), q = cube(...b); return Math.max(...p.map((v, i) => Math.abs(v - q[i]))); };

export interface Hex { c: number; r: number; land: Land | null; prov: string | null }

/** Every hex of the map; land hexes belong to the nearest province seed (ties by order). */
export const HEXES: Hex[] = (() => {
  const out: Hex[] = [];
  const fix: Record<string, string> = { '6,5': 'aldfurt', '6,4': 'aldfurt', '7,4': 'mittelland', '6,3': 'mittelland', '7,3': 'mittelland', '8,4': 'mittelland' };
  for (let r = 0; r < NROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = ROWS[r][c];
    if (ch === '~') { out.push({ c, r, land: null, prov: null }); continue; }
    let best = PROVINCES[0], bd = Infinity;
    for (const p of PROVINCES) { const d = dist([c, r], p.seed); if (d < bd) { bd = d; best = p; } }
    out.push({ c, r, land: ch as Land, prov: fix[`${c},${r}`] ?? best.id });
  }
  return out;
})();
const at = (c: number, r: number) => HEXES[r * COLS + c];

/** Province adjacency over shared hex edges. */
export const ADJ: Record<string, string[]> = (() => {
  const a: Record<string, Set<string>> = Object.fromEntries(PROVINCES.map((p) => [p.id, new Set<string>()]));
  for (const h of HEXES) if (h.prov) for (const [c, r] of neighbours(h.c, h.r)) { const n = at(c, r); if (n.prov && n.prov !== h.prov) a[h.prov].add(n.prov); }
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, [...v].sort()]));
})();

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
