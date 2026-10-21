// Campaign rules for the one-device prototype: two houses give secret orders in turn, then all orders resolve at once.
// Armies walk along hex fields; every field an army enters becomes its house's. Conflicts happen where armies meet
// in the same step, swap places, or walk into a standing enemy. Clear superiority wins automatically; close fights
// become a Deckmate battle (see game/battle.ts). Pure and serializable: the UI stores the whole state as JSON.
import { MAX_STONES, newBattle } from '../game/battle.ts';
import { CARDS, type Army, type CardKey, type GameState, type Rng } from '../game/rules.ts';
import {
  CITY_HEX, HEX, HEX_ADJ, HOUSES, LAND, PROV, PROVINCES, cityHex, hexDist, hexLand, hexName, stepCost, walkPath,
  type HexKey, type House,
} from './map.ts';

export type Spec = Army['spec'];
export type SpecKey = keyof Spec;
export const SPEC_NAME: Record<SpecKey, string> = { CAP: 'Captain', KAP: 'Kaplan', KAN: 'Kanonade', MAR: 'Marine' };
export const SPEC_MAX: Spec = { CAP: 1, KAP: 2, KAN: 2, MAR: 2 };
const SPECS = Object.keys(SPEC_NAME) as SpecKey[];

export type BuildingKey = 'kapelle' | 'giesserei' | 'kaserne' | 'messe' | 'markt' | 'mauer';
/** Research areas; each level of research allows the next level of the area's buildings. */
export type Branch = 'wirtschaft' | 'militaer' | 'glaube' | 'verteidigung';
export const BUILDINGS: Record<BuildingKey, { n: string; art: string; cost: number; effect: string; unlocks?: SpecKey; branch: Branch }> = {
  kapelle: { n: 'Kapelle', art: 'eine', cost: 4, effect: 'Städte im Umkreis von 2 Feldern können Kapläne ausbilden.', unlocks: 'KAP', branch: 'glaube' },
  giesserei: { n: 'Gießerei', art: 'eine', cost: 5, effect: 'Städte im Umkreis von 2 Feldern können Kanonaden ausbilden.', unlocks: 'KAN', branch: 'militaer' },
  kaserne: { n: 'Kaserne', art: 'eine', cost: 4, effect: 'Städte im Umkreis von 2 Feldern können Marines ausbilden und rekrutieren 1 Figur mehr.', unlocks: 'MAR', branch: 'militaer' },
  messe: { n: 'Offiziersmesse', art: 'eine', cost: 6, effect: 'Städte im Umkreis von 2 Feldern können einen Captain ausbilden.', unlocks: 'CAP', branch: 'militaer' },
  markt: { n: 'Markt', art: 'einen', cost: 5, effect: '+1 Gold pro Runde und ein Händler, der zur nächsten eigenen Stadt zieht und dort Gold bringt.', branch: 'wirtschaft' },
  mauer: { n: 'Stadtmauer', art: 'eine', cost: 5, effect: 'Nur auf dem Stadtfeld: Verteidiger dort sind 30 % stärker.', branch: 'verteidigung' },
};
export const MAX_LEVEL = 3;
export const ROMAN = ['', 'I', 'II', 'III'];
export const WALL = [1, 1.3, 1.5, 1.7];
export const BRANCHES: Record<Branch, { n: string; research: [string, string]; text: string }> = {
  wirtschaft: { n: 'Wirtschaft', research: ['Zunftwesen', 'Fernhandel'], text: 'erlaubt Märkte der nächsten Stufe' },
  militaer: { n: 'Militär', research: ['Drill', 'Kriegskunst'], text: 'erlaubt Kaserne, Gießerei und Offiziersmesse der nächsten Stufe' },
  glaube: { n: 'Glaube', research: ['Liturgie', 'Orden'], text: 'erlaubt Kapellen der nächsten Stufe' },
  verteidigung: { n: 'Verteidigung', research: ['Festungsbau', 'Bastionen'], text: 'erlaubt Stadtmauern der nächsten Stufe' },
};
export const BRANCH_KEYS = Object.keys(BRANCHES) as Branch[];
/** Gold for research level 1 and 2. Research takes no order; one research per round. */
export const RESEARCH_COST = [4, 7];
/** What a building does at a given level. */
export function levelEffect(b: BuildingKey, l: number): string {
  if (l <= 1) return BUILDINGS[b].effect;
  const cheaper = BUILDINGS[b].unlocks ? `${SPEC_NAME[BUILDINGS[b].unlocks!]} im Umkreis ${l - 1} Gold billiger` : '';
  if (b === 'kaserne') return `Rekruten +${l}, ${cheaper}`;
  if (b === 'markt') return `+${l} Gold pro Runde, Händler bringen ${l - 1} Gold mehr`;
  if (b === 'mauer') return `Verteidiger auf dem Stadtfeld ${Math.round((WALL[l] - 1) * 100)} % stärker`;
  return cheaper;
}
export const upgradeCost = (b: BuildingKey, level: number) => BUILDINGS[b].cost + 2 * level;
export const BUILDING_KEYS = Object.keys(BUILDINGS) as BuildingKey[];
export const buildingFor = (spec: SpecKey) => BUILDING_KEYS.find((k) => BUILDINGS[k].unlocks === spec)!;

/** Bonuses of a specialist travelling on its own, standing on an active building of its house. */
export type AgentBonus = { text: string; gold?: number; recruit?: number; wall?: number; train?: number; trader?: number };
export const AGENT_BONUS: Record<SpecKey, Partial<Record<BuildingKey, AgentBonus>>> = {
  KAP: { markt: { text: 'Kollekte: +2 Gold pro Runde', gold: 2 }, kapelle: { text: 'Zulauf: Städte im Umkreis rekrutieren 1 Figur mehr', recruit: 1 } },
  CAP: { kaserne: { text: 'Drill: Städte im Umkreis rekrutieren 1 Figur mehr', recruit: 1 }, messe: { text: 'Lehrmeister: Ausbildung im Umkreis 1 Gold billiger', train: 1 } },
  KAN: { mauer: { text: 'Geschütze auf der Mauer: Verteidiger weitere +20 %', wall: 0.2 }, giesserei: { text: 'Gussmeister: Ausbildung im Umkreis 1 Gold billiger', train: 1 } },
  MAR: { markt: { text: 'Geleitschutz: Händler dieses Markts ziehen 3 statt 2 Felder', trader: 1 }, kaserne: { text: 'Ausbilder: Städte im Umkreis rekrutieren 1 Figur mehr', recruit: 1 } },
};

export const MAX_ARMY = 16;
export const ORDERS_PER_ROUND = 3;
export const COST = { recruit: 3, train: 4 } as const;
export const AUTO_WIN = 1.5;
export const AGENT_RANGE = 3;
export const MAX_AGENTS = 4;
export const UMLAND = 2;
export const TRADER_SPEED = 2;

/** `xp`: battles survived and conflicts won (see RANKS). */
export interface CArmy { id: string; house: House; hex: HexKey; size: number; spec: Spec; xp?: number }

// ---------- experience ----------
export const RANKS = [
  { n: 'Grün', xp: 0, bonus: 0 },
  { n: 'Erprobt', xp: 2, bonus: 0.1 },
  { n: 'Veteran', xp: 4, bonus: 0.2 },
] as const;
export const rankOf = (a: { xp?: number }) => ((a.xp ?? 0) >= RANKS[2].xp ? 2 : (a.xp ?? 0) >= RANKS[1].xp ? 1 : 0);
/** Mixing armies or adding recruits waters the experience down (weighted by size). */
const mixXp = (xa: number | undefined, na: number, xb: number | undefined, nb: number) => Math.floor(((xa ?? 0) * na + (xb ?? 0) * nb) / Math.max(1, na + nb));

// ---------- secret goals ----------
export type Goal =
  | { kind: 'hold'; provs: string[] }
  | { kind: 'markets'; n: number }
  | { kind: 'levels'; n: number }
  | { kind: 'agents'; n: number }
  | { kind: 'cities'; n: number }
  | { kind: 'veteran' };
/** Points for a secret goal met at the end of the campaign. */
export const GOAL_POINTS = 4;
export interface CampaignOptions {
  maxRounds: number; goals: boolean; experience: boolean;
  /** One device against the computer: the house it plays and how well. */
  ai?: { house: House; level: 'leicht' | 'normal' } | null;
}
export const DEFAULT_OPTIONS: CampaignOptions = { maxRounds: 10, goals: true, experience: true, ai: null };
/** A specialist travelling without an army. */
export interface Agent { id: string; house: House; spec: SpecKey; hex: HexKey }
/** A trader walking from a market to an own city, bringing gold on arrival. */
export interface Trader { id: string; house: House; hex: HexKey; market: HexKey; to: HexKey; gold: number }

export type Order =
  | { kind: 'move'; army: string; path: HexKey[] }
  | { kind: 'support'; army: string; target: HexKey }
  | { kind: 'forage'; army: string }
  | { kind: 'agent'; agent: string; path: HexKey[] }
  | { kind: 'recruit'; prov: string }
  | { kind: 'train'; prov: string; spec: SpecKey; alone?: boolean }
  | { kind: 'build'; hex: HexKey; b: BuildingKey }
  | { kind: 'upgrade'; hex: HexKey }
  | { kind: 'research'; branch: Branch };
/** Research is free of the order limit. */
export const countsAsOrder = (o: Order) => o.kind !== 'research';
export const orderCount = (os: Order[]) => os.filter(countsAsOrder).length;

export interface PendingBattle {
  id: string;
  hex: HexKey;
  /** Leads the officers. */
  attacker: string;
  /** Leads the crew. */
  defender: string;
  /** Where the attacker waits and returns to after a defeat. */
  from: HexKey;
  /** Field battle after a meeting: where the defender returns to after a defeat. */
  defFrom?: HexKey;
  field?: boolean;
  attCards: number;
  defCards: number;
  attStrength: number;
  defStrength: number;
  /** Online: id of the linked Deckmate game in which this battle is fought. */
  game?: string;
}

/** One side of a conflict with the parts of its strength. */
export interface ConflictSide {
  house: House; army: string; from: HexKey; size: number;
  sup: { hex: HexKey; size: number; add: number }[];
  /** Terrain and wall factors, 1 if none (only defenders get them). */
  terrain: number; wall: number; total: number;
  /** Experience factor (1 if none). */
  xp?: number;
}
export type Conflict =
  | { kind: 'meet'; hex: HexKey; step?: number; swap?: boolean; R: ConflictSide; K: ConflictSide; winner: House | null; battle?: { attacker: House; coin: boolean }; retreat?: HexKey | null }
  | { kind: 'attack'; hex: HexKey; step?: number; att: ConflictSide; def: ConflictSide; outcome: 'overrun' | 'repelled' | 'battle'; retreat?: HexKey | null; attLost?: number; defLost?: number };

export interface Campaign {
  v: 2;
  round: number;
  maxRounds: number;
  phase: 'orders' | 'battles' | 'over';
  current: House;
  /** Owner of each land hex: the house whose army entered it last. */
  hexOwner: Record<HexKey, House | null>;
  /** Owner of each province, derived from its hexes (a city province belongs to whoever holds the city hex). */
  owner: Record<string, House | null>;
  /** One building per hex. */
  buildings: Record<HexKey, BuildingKey>;
  /**
   * House a building serves. While an enemy army stands on its field it rests; once that army has left a field it
   * took, the building is captured and serves the new owner.
   */
  buildingOwner: Record<HexKey, House>;
  /** Level of each building (missing = 1). */
  levels?: Record<HexKey, number>;
  /** Research level of each house per area (missing = 0). */
  research?: Record<House, Partial<Record<Branch, number>>>;
  gold: Record<House, number>;
  armies: CArmy[];
  agents: Agent[];
  traders: Trader[];
  orders: Record<House, Order[]>;
  sealed: Record<House, boolean>;
  battles: PendingBattle[];
  report: string[];
  /** What happened in the conflicts of the last resolved round, for the explanation cards. */
  conflicts?: Conflict[];
  /** Snapshot taken when the orders were revealed, for the reveal animation. Cleared by the UI afterwards. */
  reveal?: {
    round: number; armies: CArmy[]; agents: Agent[]; traders: Trader[];
    hexOwner: Record<HexKey, House | null>; owner: Record<string, House | null>; gold: Record<House, number>;
    orders: Record<House, Order[]>;
    /** Hex of every army, agent and trader at each step of the movement (index 0 = start). */
    walk: Record<string, HexKey[]>;
  } | null;
  winner: House | null;
  winReason: string | null;
  nextId: number;
  /** Chosen in the start dialog; missing in older saves (then experience and goals are off). */
  opts?: CampaignOptions;
  /** Secret goal of each house, only shown to its owner until the end. */
  goals?: Record<House, Goal>;
}

export const OTHER: Record<House, House> = { R: 'K', K: 'R' };
const noSpec = (): Spec => ({ CAP: 0, KAP: 0, KAN: 0, MAR: 0 });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const hn = (h: House) => HOUSES[h].n;
export const specSum = (s: Spec) => s.CAP + s.KAP + s.KAN + s.MAR;

// ---------- queries ----------

export const armyAt = (c: Campaign, hex: HexKey) => c.armies.find((a) => a.hex === hex) ?? null;
export const armyById = (c: Campaign, id: string) => c.armies.find((a) => a.id === id) ?? null;
export const agentById = (c: Campaign, id: string) => c.agents.find((a) => a.id === id) ?? null;
export const agentsAt = (c: Campaign, hex: HexKey) => c.agents.filter((a) => a.hex === hex);
export const tradersAt = (c: Campaign, hex: HexKey) => c.traders.filter((t) => t.hex === hex);
export const cityOwner = (c: Campaign, prov: string) => c.hexOwner[cityHex(prov)] ?? null;
/** Fields within reach of a city ("Umland"). */
export const umland = (prov: string) => Object.keys(HEX).filter((k) => hexDist(k, cityHex(prov)) <= UMLAND);
export const engagedIds = (c: Campaign) => new Set(c.battles.flatMap((b) => [b.attacker, b.defender]));

/** A building works for its owner while its field is theirs and no enemy army stands on it. */
export function buildingActive(c: Campaign, hex: HexKey): boolean {
  const o = c.buildingOwner?.[hex] ?? c.hexOwner[hex];
  if (!c.buildings[hex] || !o || c.hexOwner[hex] !== o) return false;
  return !c.armies.some((a) => a.hex === hex && a.house !== o);
}
export const buildingOwnerOf = (c: Campaign, hex: HexKey): House | null => c.buildingOwner?.[hex] ?? c.hexOwner[hex] ?? null;
/** Buildings change hands once the army that took their field has moved on. */
function settleBuildings(c: Campaign, log: string[]) {
  c.buildingOwner ??= {};
  for (const k of Object.keys(c.buildings)) {
    const o = c.hexOwner[k], was = c.buildingOwner[k];
    if (!o || o === was) continue;
    if (c.armies.some((a) => a.hex === k && a.house === o)) continue;
    c.buildingOwner[k] = o;
    if (was) log.push(`${hn(o)} erobert bei ${hexName(k)}: ${BUILDINGS[c.buildings[k]].n}.`);
  }
}
export const levelOf = (c: Campaign, hex: HexKey) => (c.buildings[hex] ? c.levels?.[hex] ?? 1 : 0);
export const researchOf = (c: Campaign, h: House, br: Branch) => c.research?.[h]?.[br] ?? 0;
/** Buildings in a city's Umland. */
export function buildingsNear(c: Campaign, prov: string) {
  return umland(prov).filter((k) => c.buildings[k]).map((k) => ({ hex: k, b: c.buildings[k], level: levelOf(c, k), owner: buildingOwnerOf(c, k), active: buildingActive(c, k) }));
}
/** Highest level of an active building of this kind the house has in the city's Umland (0 if none). */
export const bestNear = (c: Campaign, prov: string, b: BuildingKey, house: House) =>
  Math.max(0, ...buildingsNear(c, prov).filter((x) => x.b === b && x.active && x.owner === house).map((x) => x.level));
/** Does the house have an active building of this kind in the city's Umland? */
export const hasNear = (c: Campaign, prov: string, b: BuildingKey, house: House) =>
  buildingsNear(c, prov).some((x) => x.b === b && x.active && x.owner === house);
/** Bonus of an agent where it stands, if any. */
export function agentBonus(c: Campaign, ag: Agent): AgentBonus | null {
  const b = c.buildings[ag.hex];
  if (!b || !buildingActive(c, ag.hex) || buildingOwnerOf(c, ag.hex) !== ag.house) return null;
  return AGENT_BONUS[ag.spec][b] ?? null;
}
const bonusesNear = (c: Campaign, prov: string, house: House) =>
  c.agents.filter((a) => a.house === house && hexDist(a.hex, cityHex(prov)) <= UMLAND).map((a) => agentBonus(c, a)).filter(Boolean) as AgentBonus[];

export const recruitSize = (c: Campaign, prov: string, house: House = cityOwner(c, prov) ?? 'R') =>
  3 + bestNear(c, prov, 'kaserne', house) + bonusesNear(c, prov, house).reduce((n, b) => n + (b.recruit ?? 0), 0);
export const trainCost = (c: Campaign, prov: string, house: House, spec?: SpecKey) =>
  Math.max(1, COST.train - bonusesNear(c, prov, house).reduce((n, b) => n + (b.train ?? 0), 0) - (spec ? Math.max(0, bestNear(c, prov, buildingFor(spec), house) - 1) : 0));
export const orderCost = (c: Campaign, house: House, o: Order) =>
  o.kind === 'recruit' ? COST.recruit : o.kind === 'train' ? trainCost(c, o.prov, house, o.spec) : o.kind === 'build' ? BUILDINGS[o.b].cost
    : o.kind === 'upgrade' ? (c.buildings[o.hex] ? upgradeCost(c.buildings[o.hex], levelOf(c, o.hex)) : 0)
    : o.kind === 'research' ? RESEARCH_COST[researchOf(c, house, o.branch)] ?? 0 : 0;

/** Movement points of an army: small armies are quicker, without specialists there is no discipline (−1). */
export function rangeOf(a: CArmy): number {
  const base = a.size <= 6 ? 5 : a.size <= 11 ? 4 : 3;
  return Math.max(1, base - (specSum(a.spec) === 0 ? 1 : 0));
}
export const pathCost = (path: HexKey[]) => path.reduce((n, k) => n + stepCost(k), 0);

/** Defence factor of a wall on this hex for its owner (with a cannon on the wall). */
function wallFactor(c: Campaign, hex: HexKey, house: House) {
  if (c.buildings[hex] !== 'mauer' || buildingOwnerOf(c, hex) !== house || !buildingActive(c, hex)) return 1;
  return WALL[levelOf(c, hex)] + c.agents.filter((a) => a.hex === hex && a.house === house).reduce((n, a) => n + (agentBonus(c, a)?.wall ?? 0), 0);
}
export const xpOn = (c: Campaign) => !!c.opts?.experience;
/** Strength factor from experience (1 if experience is off). */
export const xpFactor = (c: Campaign, a: CArmy) => (xpOn(c) ? 1 + RANKS[rankOf(a)].bonus : 1);
export function strength(c: Campaign, a: CArmy, hex: HexKey, supports: CArmy[], defending: boolean) {
  const base = a.size + supports.reduce((s, x) => s + x.size / 2, 0);
  const f = (defending ? LAND[hexLand(hex)].defense * wallFactor(c, hex, a.house) : 1) * xpFactor(c, a);
  return Math.round(base * f * 10) / 10;
}
/** One more point of experience; returns a log line when the army reaches a new rank. */
function gainXp(c: Campaign, a: CArmy, n: number, log: string[]) {
  if (!xpOn(c) || a.size <= 0) return;
  const before = rankOf(a);
  a.xp = (a.xp ?? 0) + n;
  if (rankOf(a) > before) log.push(`Ein Heer von ${hn(a.house)} (${a.size} Figuren) ist jetzt ${RANKS[rankOf(a)].n}: +${Math.round(RANKS[rankOf(a)].bonus * 100)} % Stärke.`);
}
function sideOf(c: Campaign, a: CArmy, from: HexKey, hex: HexKey, supports: CArmy[], defending: boolean): ConflictSide {
  return {
    house: a.house, army: a.id, from, size: a.size,
    sup: supports.map((x) => ({ hex: x.hex, size: x.size, add: x.size / 2 })),
    terrain: defending ? LAND[hexLand(hex)].defense : 1,
    wall: defending ? wallFactor(c, hex, a.house) : 1,
    xp: xpFactor(c, a),
    total: strength(c, a, hex, supports, defending),
  };
}

export function income(c: Campaign, h: House) {
  const provs = PROVINCES.filter((p) => c.owner[p.id] === h);
  const markets = Object.keys(c.buildings).filter((k) => c.buildings[k] === 'markt' && buildingOwnerOf(c, k) === h && buildingActive(c, k)).reduce((n, k) => n + levelOf(c, k), 0);
  const collected = c.agents.filter((a) => a.house === h).reduce((n, a) => n + (agentBonus(c, a)?.gold ?? 0), 0);
  const cities = provs.filter((p) => p.city).length * 2;
  return { provinces: provs.length, cities, markets, agents: collected, total: provs.length + cities + markets + collected };
}
export const incomeOf = (c: Campaign, h: House) => income(c, h).total;
export function score(c: Campaign, h: House) {
  const provs = PROVINCES.filter((p) => c.owner[p.id] === h);
  return provs.length + provs.filter((p) => p.city).length * 2;
}

export function goalText(g: Goal): string {
  switch (g.kind) {
    case 'hold': return `Halte am Ende ${g.provs.map((p) => PROV[p].n).join(' und ')}.`;
    case 'markets': return `Besitze am Ende ${g.n} aktive Märkte.`;
    case 'levels': return `Besitze am Ende ${g.n} Gebäude auf Stufe II oder höher.`;
    case 'agents': return `Habe am Ende ${g.n} Einzelgänger unterwegs.`;
    case 'cities': return `Halte am Ende ${g.n} Städte.`;
    case 'veteran': return 'Führe am Ende ein Veteranen-Heer.';
  }
}
/** Progress towards a goal: [have, need]. */
export function goalProgress(c: Campaign, h: House, g: Goal): [number, number] {
  const mine = (k: HexKey) => buildingOwnerOf(c, k) === h && buildingActive(c, k);
  switch (g.kind) {
    case 'hold': return [g.provs.filter((p) => c.owner[p] === h).length, g.provs.length];
    case 'markets': return [Object.keys(c.buildings).filter((k) => c.buildings[k] === 'markt' && mine(k)).length, g.n];
    case 'levels': return [Object.keys(c.buildings).filter((k) => mine(k) && levelOf(c, k) >= 2).length, g.n];
    case 'agents': return [c.agents.filter((a) => a.house === h).length, g.n];
    case 'cities': return [PROVINCES.filter((p) => p.city && c.owner[p.id] === h).length, g.n];
    case 'veteran': return [c.armies.some((a) => a.house === h && rankOf(a) >= 2) ? 1 : 0, 1];
  }
}
export const goalMet = (c: Campaign, h: House) => { const g = c.goals?.[h]; if (!g) return false; const [a, b] = goalProgress(c, h, g); return a >= b; };
/** Final points: provinces, cities and a met secret goal. */
export const finalScore = (c: Campaign, h: House) => score(c, h) + (goalMet(c, h) ? GOAL_POINTS : 0);

function drawGoals(rng: Rng, experience: boolean): Record<House, Goal> {
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const holdFor = (h: House): Goal => {
    const pool = PROVINCES.filter((p) => p.start !== h && p.capital !== OTHER[h]).map((p) => p.id);
    const a = pick(pool), b = pick(pool.filter((x) => x !== a));
    return { kind: 'hold', provs: [a, b] };
  };
  const make = (h: House, kind: Goal['kind']): Goal =>
    kind === 'hold' ? holdFor(h) : kind === 'markets' ? { kind, n: 2 } : kind === 'levels' ? { kind, n: 2 } : kind === 'agents' ? { kind, n: 3 } : kind === 'cities' ? { kind, n: 4 } : { kind: 'veteran' };
  const kinds: Goal['kind'][] = ['hold', 'hold', 'markets', 'levels', 'agents', 'cities', ...(experience ? ['veteran' as const] : [])];
  const kr = pick(kinds), kk = pick(kinds.filter((k) => k !== kr || k === 'hold'));
  return { R: make('R', kr), K: make('K', kk) };
}

/** Province owners from the hexes: city provinces by their city hex, the others by the majority of fields. */
export function deriveOwners(c: Campaign) {
  for (const p of PROVINCES) {
    if (p.city) { c.owner[p.id] = c.hexOwner[cityHex(p.id)] ?? null; continue; }
    const n: Record<House, number> = { R: 0, K: 0 };
    for (const k of Object.keys(HEX)) if (HEX[k].prov === p.id && c.hexOwner[k]) n[c.hexOwner[k]!]++;
    if (!n.R && !n.K) c.owner[p.id] = null;
    else if (n.R !== n.K) c.owner[p.id] = n.R > n.K ? 'R' : 'K';
    else c.owner[p.id] ??= null; // a tie keeps the previous owner
  }
}

// ---------- setup ----------

export function newCampaign(options: Partial<CampaignOptions> = {}, rng: Rng = Math.random): Campaign {
  const opts: CampaignOptions = { ...DEFAULT_OPTIONS, ...options };
  const hexOwner: Record<HexKey, House | null> = Object.fromEntries(Object.keys(HEX).map((k) => [k, PROV[HEX[k].prov!].start ?? null]));
  const at = (prov: string) => cityHex(prov);
  const armies: CArmy[] = [
    { id: 'a1', house: 'R', hex: at('aldfurt'), size: 10, spec: { CAP: 1, KAP: 1, KAN: 0, MAR: 0 } },
    { id: 'a2', house: 'R', hex: at('suedhafen'), size: 6, spec: noSpec() },
    { id: 'a3', house: 'K', hex: at('kapostra'), size: 10, spec: { CAP: 1, KAP: 1, KAN: 0, MAR: 0 } },
    { id: 'a4', house: 'K', hex: at('ostkueste'), size: 6, spec: noSpec() },
  ];
  // each capital starts with a chapel next to it
  const buildings: Record<HexKey, BuildingKey> = {};
  const buildingOwner: Record<HexKey, House> = {};
  for (const cap of ['aldfurt', 'kapostra']) {
    const k = HEX_ADJ[cityHex(cap)].find((n) => HEX[n].prov === cap && !CITY_HEX[n]);
    if (k) { buildings[k] = 'kapelle'; buildingOwner[k] = PROV[cap].capital!; }
  }
  const c: Campaign = {
    v: 2, round: 1, maxRounds: opts.maxRounds, phase: 'orders', current: 'R', hexOwner, owner: {}, buildings, buildingOwner, levels: {}, research: { R: {}, K: {} },
    gold: { R: 4, K: 4 }, armies, agents: [], traders: [],
    orders: { R: [], K: [] }, sealed: { R: false, K: false }, battles: [],
    report: [opts.ai ? `Runde 1 beginnt. Du führst ${HOUSES[OTHER[opts.ai.house]].n}, der Computer ${HOUSES[opts.ai.house].n}.` : 'Runde 1 beginnt. Ravensmoor gibt zuerst seine Befehle, Kerrow schaut weg.'], winner: null, winReason: null, nextId: 5,
    opts, goals: opts.goals ? drawGoals(rng, opts.experience) : undefined,
  };
  deriveOwners(c);
  return c;
}

// ---------- orders ----------

const isCityOrder = (o: Order): o is Extract<Order, { kind: 'recruit' | 'train' }> => o.kind === 'recruit' || o.kind === 'train';
const enemyArmyHexes = (c: Campaign, house: House) => new Set(c.armies.filter((a) => a.house !== house).map((a) => a.hex));

/** Why a path is not walkable for a unit standing on `from` (empty string if it is). */
function pathProblem(c: Campaign, house: House, from: HexKey, path: HexKey[], budget: number, agent: boolean): string {
  if (!path.length) return 'Der Weg ist leer.';
  const enemy = enemyArmyHexes(c, house);
  let at = from;
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    if (!HEX[k]) return 'Heere ziehen nur über Land.';
    if (!HEX_ADJ[at].includes(k)) return 'Der Weg muss Feld für Feld zusammenhängen.';
    if (enemy.has(k) && (agent || i < path.length - 1)) return agent ? 'Einzelgänger können nicht auf Felder mit feindlichen Heeren.' : 'Auf einem feindlichen Heer endet der Weg.';
    at = k;
  }
  if (pathCost(path) > budget) return `Der Weg kostet ${pathCost(path)} Bewegungspunkte, möglich sind ${budget}.`;
  return '';
}

/** Why an order is not allowed (empty string if it is), given the house's other orders this round. */
export function orderProblem(c: Campaign, house: House, o: Order, others: Order[]): string {
  if (countsAsOrder(o) && orderCount(others) >= ORDERS_PER_ROUND) return `Pro Runde sind ${ORDERS_PER_ROUND} Befehle erlaubt.`;
  const spent = others.reduce((g, x) => g + orderCost(c, house, x), 0);
  if (o.kind === 'research') {
    const l = researchOf(c, house, o.branch);
    if (others.some((x) => x.kind === 'research')) return 'Pro Runde eine Forschung.';
    if (l >= MAX_LEVEL - 1) return `${BRANCHES[o.branch].n} ist fertig erforscht.`;
    if (c.gold[house] - spent < RESEARCH_COST[l]) return `Dafür fehlt Gold (${RESEARCH_COST[l]} nötig).`;
    return '';
  }
  if (o.kind === 'upgrade') {
    const b = c.buildings[o.hex];
    if (!b) return 'Hier steht kein Gebäude.';
    if (buildingOwnerOf(c, o.hex) !== house) return 'Das Gebäude gehört nicht deinem Haus.';
    if (!buildingActive(c, o.hex)) return 'Das Gebäude ruht gerade.';
    const l = levelOf(c, o.hex);
    if (l >= MAX_LEVEL) return `${BUILDINGS[b].n} hat schon die höchste Stufe.`;
    if (researchOf(c, house, BUILDINGS[b].branch) < l && others.some((x) => x.kind === 'research' && x.branch === BUILDINGS[b].branch)) return `Die Forschung „${BRANCHES[BUILDINGS[b].branch].research[l - 1]}“ wirkt erst ab der nächsten Runde.`;
    if (researchOf(c, house, BUILDINGS[b].branch) < l) return `Für Stufe ${ROMAN[l + 1]} fehlt die Forschung „${BRANCHES[BUILDINGS[b].branch].research[l - 1]}“ (${BRANCHES[BUILDINGS[b].branch].n}).`;
    if (others.some((x) => x.kind === 'upgrade' && x.hex === o.hex)) return 'Hier wird schon ausgebaut.';
    const cost = upgradeCost(b, l);
    if (c.gold[house] - spent < cost) return `Dafür fehlt Gold (${cost} nötig).`;
    return '';
  }
  if (o.kind === 'build') {
    if (!HEX[o.hex]) return 'Bauen geht nur an Land.';
    if (c.hexOwner[o.hex] !== house) return 'Bauen geht nur auf eigenen Feldern.';
    if (c.buildings[o.hex]) return `Hier steht schon ${BUILDINGS[c.buildings[o.hex]].art} ${BUILDINGS[c.buildings[o.hex]].n}.`;
    if (others.some((x) => (x.kind === 'build' || x.kind === 'upgrade') && x.hex === o.hex)) return 'Hier wird schon gebaut.';
    if (c.armies.some((a) => a.hex === o.hex && a.house !== house)) return 'Auf dem Feld steht ein feindliches Heer.';
    const city = CITY_HEX[o.hex];
    if (o.b === 'mauer' && !city) return 'Eine Stadtmauer gehört auf das Stadtfeld.';
    if (o.b !== 'mauer' && city) return 'Auf dem Stadtfeld ist nur eine Stadtmauer möglich, die anderen Gebäude gehören ins Umland.';
    const near = PROVINCES.some((p) => p.city && cityOwner(c, p.id) === house && hexDist(o.hex, cityHex(p.id)) <= UMLAND);
    if (!near) return `Gebaut wird im Umland einer eigenen Stadt (bis ${UMLAND} Felder entfernt).`;
    if (c.gold[house] - spent < BUILDINGS[o.b].cost) return `Dafür fehlt Gold (${BUILDINGS[o.b].cost} nötig).`;
    return '';
  }
  if (isCityOrder(o)) {
    const p = PROV[o.prov];
    if (!p?.city) return 'Nur in Städten.';
    const ch = cityHex(p.id);
    if (c.hexOwner[ch] !== house) return 'Die Stadt gehört nicht deinem Haus.';
    if (others.some((x) => isCityOrder(x) && x.prov === p.id)) return 'Pro Stadt und Runde ein Befehl (Rekrutieren oder Ausbilden).';
    const cost = orderCost(c, house, o);
    if (c.gold[house] - spent < cost) return `Dafür fehlt Gold (${cost} nötig).`;
    const here = armyAt(c, ch);
    if (here && here.house !== house) return 'In der Stadt steht ein fremdes Heer.';
    if (o.kind === 'train') {
      const b = buildingFor(o.spec);
      if (!hasNear(c, p.id, b, house)) return `Dafür braucht die Stadt ${BUILDINGS[b].art} aktive ${BUILDINGS[b].n} im Umland.`;
      if (o.alone) {
        const n = c.agents.filter((a) => a.house === house).length + others.filter((x) => x.kind === 'train' && x.alone).length;
        if (n >= MAX_AGENTS) return `Höchstens ${MAX_AGENTS} Einzelgänger je Haus.`;
        return '';
      }
      if (!here) return 'Zum Ausbilden ins Heer muss ein eigenes Heer in der Stadt stehen – oder als Einzelgänger ausbilden.';
      if (here.spec[o.spec] >= SPEC_MAX[o.spec]) return `Das Heer hat schon die Höchstzahl an ${SPEC_NAME[o.spec]}.`;
      if (1 + specSum(here.spec) >= here.size) return 'Das Heer ist zu klein für weitere Spezialisten.';
    }
    return '';
  }
  if (o.kind === 'agent') {
    const ag = agentById(c, o.agent);
    if (!ag || ag.house !== house) return 'Das ist kein Einzelgänger deines Hauses.';
    if (others.some((x) => x.kind === 'agent' && x.agent === o.agent)) return 'Dieser Einzelgänger hat schon einen Befehl.';
    return pathProblem(c, house, ag.hex, o.path, AGENT_RANGE, true);
  }
  const a = armyById(c, o.army);
  if (!a || a.house !== house) return 'Das ist kein Heer deines Hauses.';
  if (engagedIds(c).has(a.id)) return 'Dieses Heer wartet auf eine Schlacht.';
  if (others.some((x) => 'army' in x && x.army === o.army)) return 'Dieses Heer hat schon einen Befehl.';
  if (o.kind === 'move') return pathProblem(c, house, a.hex, o.path, rangeOf(a), false);
  if (o.kind === 'support') {
    if (!HEX_ADJ[a.hex].includes(o.target)) return 'Unterstützen geht nur auf ein Nachbarfeld.';
    return '';
  }
  if (o.kind === 'forage') {
    if (LAND[hexLand(a.hex)].forage === 0) return 'Im Gebirge gibt es nichts zu fouragieren.';
    if (a.size >= MAX_ARMY) return 'Das Heer ist schon voll.';
    return '';
  }
  return 'Unbekannter Befehl.';
}

export type Tone = 'ok' | 'risk' | 'bad' | 'plain';
/**
 * What a move would probably lead to at its last field, from what the house can see: the visible defender and the
 * house's own planned supports. Hidden enemy supports and moves are not known and not counted.
 */
export function movePreview(c: Campaign, house: House, armyId: string, to: HexKey, draft: Order[]): { text: string; tone: Tone } {
  const a = armyById(c, armyId);
  if (!a) return { text: '', tone: 'plain' };
  const holder = armyAt(c, to);
  if (holder && holder.house === house) return { text: 'vereinen', tone: 'plain' };
  if (!holder) {
    if (CITY_HEX[to] && c.hexOwner[to] !== house) return { text: 'Stadt einnehmen', tone: 'ok' };
    if (c.hexOwner[to] === house) return { text: 'verlegen', tone: 'plain' };
    return { text: c.hexOwner[to] ? 'einnehmen' : 'besetzen', tone: 'ok' };
  }
  const moving = new Set(draft.flatMap((o) => (o.kind === 'move' ? [o.army] : [])));
  const sup = draft.flatMap((o) => (o.kind === 'support' && o.target === to && !moving.has(o.army) ? [armyById(c, o.army)!] : [])).filter(Boolean);
  const sa = strength(c, a, to, sup, false), sd = strength(c, holder, to, [], true);
  const fmt = (x: number) => String(x).replace('.', ',');
  if (sa >= AUTO_WIN * sd) return { text: `${fmt(sa)} : ${fmt(sd)} · überrennt`, tone: 'ok' };
  if (sd >= AUTO_WIN * sa) return { text: `${fmt(sa)} : ${fmt(sd)} · chancenlos`, tone: 'bad' };
  return { text: `${fmt(sa)} : ${fmt(sd)} · Schlacht`, tone: 'risk' };
}

/** Seal one house's orders. When both are sealed, everything resolves. */
export function sealOrders(prev: Campaign, house: House, orders: Order[], rng: Rng): Campaign {
  if (prev.phase !== 'orders') throw new Error('Gerade werden keine Befehle gegeben.');
  if (prev.sealed[house]) throw new Error('Die Befehle dieses Hauses sind schon versiegelt.');
  const ok: Order[] = [];
  for (const o of orders) { const why = orderProblem(prev, house, o, ok); if (why) throw new Error(why); ok.push(o); }
  const c = clone(prev);
  c.orders[house] = ok;
  c.sealed[house] = true;
  if (!c.sealed[OTHER[house]]) { c.current = OTHER[house]; return c; }
  return resolve(c, rng);
}

// ---------- resolution helpers ----------

function retreatTarget(c: Campaign, a: CArmy, from: HexKey, avoid: HexKey[]): HexKey | null {
  const opts = HEX_ADJ[from].filter((k) => !avoid.includes(k) && !c.armies.some((x) => x.hex === k && x.house !== a.house));
  const rank = (k: HexKey) => (c.hexOwner[k] === a.house ? 0 : c.hexOwner[k] ? 2 : 1);
  opts.sort((x, y) => rank(x) - rank(y));
  return opts[0] ?? null;
}
/** Captures enemy agents and robs enemy traders on a hex an army has just entered. */
function sweep(c: Campaign, a: CArmy, log: string[]) {
  for (const ag of c.agents.filter((x) => x.hex === a.hex && x.house !== a.house)) {
    c.agents = c.agents.filter((x) => x !== ag);
    log.push(`${hn(a.house)} nimmt bei ${hexName(a.hex)} einen ${SPEC_NAME[ag.spec]} von ${hn(ag.house)} gefangen.`);
  }
  for (const t of c.traders.filter((x) => x.hex === a.hex && x.house !== a.house)) {
    c.traders = c.traders.filter((x) => x !== t);
    const loot = Math.floor(t.gold / 2);
    c.gold[a.house] += loot;
    log.push(`${hn(a.house)} überfällt bei ${hexName(a.hex)} einen Händler von ${hn(t.house)} und erbeutet ${loot} Gold.`);
  }
}
/** Puts an army onto a hex: takes the field, merges with an own army there, sweeps enemy agents and traders. */
function placeArmy(c: Campaign, a: CArmy, hex: HexKey, log: string[]) {
  const own = c.armies.find((x) => x.id !== a.id && x.hex === hex && x.house === a.house);
  a.hex = hex;
  c.hexOwner[hex] = a.house;
  sweep(c, a, log);
  if (own) {
    own.xp = mixXp(own.xp, own.size, a.xp, a.size);
    own.size = Math.min(MAX_ARMY, own.size + a.size);
    for (const k of SPECS) own.spec[k] = Math.min(SPEC_MAX[k], own.spec[k] + a.spec[k]);
    c.armies = c.armies.filter((x) => x.id !== a.id);
    log.push(`${hn(a.house)}: Zwei Heere vereinen sich bei ${hexName(hex)}.`);
  }
}
/** Moves a beaten army away; returns where it went, or null if it was destroyed. */
function retreatOrDie(c: Campaign, a: CArmy, from: HexKey, avoid: HexKey[], log: string[]): HexKey | null {
  if (a.size <= 0) { c.armies = c.armies.filter((x) => x.id !== a.id); return null; }
  const t = retreatTarget(c, a, from, avoid);
  if (t) { log.push(`${hn(a.house)} zieht sich mit ${a.size} Figuren nach ${hexName(t)} zurück.`); placeArmy(c, a, t, log); return t; }
  c.armies = c.armies.filter((x) => x.id !== a.id); log.push(`${hn(a.house)} findet keinen Rückzugsweg, das Heer löst sich auf.`);
  return null;
}
const lose = (a: CArmy, share: number) => {
  const before = a.size;
  a.size = Math.max(0, a.size - Math.ceil(a.size * share));
  for (const k of SPECS) a.spec[k] = Math.min(a.spec[k], Math.max(0, a.size - 1));
  return before - a.size;
};

function nearestCity(c: Campaign, from: HexKey, house: House): HexKey | null {
  let best: HexKey | null = null, bl = Infinity;
  for (const p of PROVINCES) {
    if (!p.city || cityOwner(c, p.id) !== house) continue;
    const ch = cityHex(p.id);
    if (ch === from) continue;
    const path = walkPath(from, ch);
    if (path && path.length < bl) { bl = path.length; best = ch; }
  }
  return best;
}

function resolve(c: Campaign, rng: Rng): Campaign {
  const reveal: NonNullable<Campaign['reveal']> = {
    round: c.round, armies: clone(c.armies), agents: clone(c.agents), traders: clone(c.traders),
    hexOwner: clone(c.hexOwner), owner: clone(c.owner), gold: { ...c.gold }, orders: clone(c.orders), walk: {},
  };
  c.reveal = reveal;
  const log: string[] = [`Runde ${c.round}: Die Befehle werden aufgedeckt.`];
  const conflicts: Conflict[] = [];
  const battles: PendingBattle[] = [];
  const all = (['R', 'K'] as House[]).flatMap((h) => c.orders[h].map((o) => ({ h, o })));

  // 1. Research, building, training, supplies
  for (const { h, o } of all) {
    if (o.kind === 'research') {
      const l = researchOf(c, h, o.branch);
      c.gold[h] -= RESEARCH_COST[l];
      ((c.research ??= { R: {}, K: {} })[h] ??= {})[o.branch] = l + 1;
      log.push(`${hn(h)} erforscht ${BRANCHES[o.branch].research[l]} (${BRANCHES[o.branch].n} ${ROMAN[l + 1]}).`);
    }
    if (o.kind === 'upgrade') {
      const l = levelOf(c, o.hex);
      c.gold[h] -= upgradeCost(c.buildings[o.hex], l);
      (c.levels ??= {})[o.hex] = l + 1;
      log.push(`${hn(h)} baut bei ${hexName(o.hex)} aus: ${BUILDINGS[c.buildings[o.hex]].n} ${ROMAN[l + 1]}.`);
    }
    if (o.kind === 'build') {
      c.gold[h] -= BUILDINGS[o.b].cost;
      c.buildings[o.hex] = o.b;
      (c.buildingOwner ??= {})[o.hex] = h;
      (c.levels ??= {})[o.hex] = 1;
      log.push(`${hn(h)} baut bei ${hexName(o.hex)}: ${BUILDINGS[o.b].n}.`);
    }
    if (o.kind === 'train') {
      c.gold[h] -= trainCost(c, o.prov, h, o.spec);
      if (o.alone) {
        c.agents.push({ id: `g${c.nextId++}`, house: h, spec: o.spec, hex: cityHex(o.prov) });
        log.push(`${hn(h)} bildet in ${PROV[o.prov].n} einen ${SPEC_NAME[o.spec]} als Einzelgänger aus.`);
      } else {
        armyAt(c, cityHex(o.prov))!.spec[o.spec]++;
        log.push(`${hn(h)} bildet in ${PROV[o.prov].n} einen ${SPEC_NAME[o.spec]} aus.`);
      }
    }
    if (o.kind === 'forage') {
      const a = armyById(c, o.army)!;
      const plus = LAND[hexLand(a.hex)].forage;
      a.size = Math.min(MAX_ARMY, a.size + plus);
      log.push(`${hn(h)} fouragiert bei ${hexName(a.hex)} (+${plus}).`);
    }
  }

  // 2. Armies walk step by step, all at the same time
  type M = { h: House; a: CArmy; path: HexKey[]; i: number; done: boolean };
  const movers: M[] = all.flatMap(({ h, o }) => (o.kind === 'move' ? [{ h, a: armyById(c, o.army)!, path: o.path, i: 0, done: false }] : []));
  const moverOf = new Map(movers.map((m) => [m.a.id, m]));
  const supports = all.flatMap(({ h, o }) => (o.kind === 'support' ? [{ h, a: armyById(c, o.army)!, target: o.target }] : []));
  const engaged = new Set<string>();
  const supFor = (h: House, hex: HexKey) => supports.filter((s) => s.h === h && s.target === hex && !moverOf.has(s.a.id) && !engaged.has(s.a.id) && c.armies.includes(s.a)).map((s) => s.a);
  const walk: Record<string, HexKey[]> = Object.fromEntries(c.armies.map((a) => [a.id, [a.hex]]));
  // stepping only takes the field; armies merge once everyone has stopped
  const stepTo = (m: M, hex: HexKey) => { m.a.hex = hex; c.hexOwner[hex] = m.h; sweep(c, m.a, log); };
  const inConflict = new Set<string>();
  let curStep = 0;

  const meet = (r: M, k: M, swap: boolean, X: HexKey) => {
    const tR = swap ? k.a.hex : X, tK = swap ? r.a.hex : X;
    const sR = sideOf(c, r.a, r.a.hex, tR, supFor('R', tR), false), sK = sideOf(c, k.a, k.a.hex, tK, supFor('K', tK), false);
    const W = sR.total >= AUTO_WIN * sK.total ? r : sK.total >= AUTO_WIN * sR.total ? k : null;
    const conf: Conflict & { kind: 'meet' } = { kind: 'meet', hex: X, step: curStep, swap, R: sR, K: sK, winner: W?.h ?? null };
    conflicts.push(conf);
    inConflict.add(r.a.id); inConflict.add(k.a.id);
    r.done = k.done = true;
    if (W) {
      const L = W === r ? k : r;
      gainXp(c, W.a, 1, log);
      if (swap) {
        const lHex = L.a.hex, wHex = W.a.hex;
        conf.hex = lHex;
        conf.retreat = retreatOrDie(c, L.a, lHex, [wHex, lHex], log);
        stepTo(W, lHex);
        log.push(`Begegnung bei ${hexName(lHex)}: ${hn(W.h)} ist klar stärker (${sR.total} zu ${sK.total}) und drängt ${hn(L.h)} zurück.`);
      } else {
        stepTo(W, X);
        log.push(`Wettlauf um ${hexName(X)}: ${hn(W.h)} ist klar stärker (${sR.total} zu ${sK.total}), ${hn(L.h)} kehrt um.`);
      }
      return;
    }
    // close: the armies meet in the field; the stronger one leads the officers, on a tie the dice decide
    const coin = sR.total === sK.total;
    const A = sR.total > sK.total || (coin && rng() < 0.5) ? r : k, D = A === r ? k : r;
    const bhex = swap ? D.a.hex : X;
    conf.battle = { attacker: A.h, coin };
    conf.hex = bhex;
    const sa = A === r ? sR.total : sK.total, sd = A === r ? sK.total : sR.total;
    battles.push({
      id: `b${c.nextId++}`, hex: bhex, attacker: A.a.id, defender: D.a.id, from: A.a.hex, defFrom: D.a.hex, field: true,
      attCards: supFor(A.h, bhex).length, defCards: supFor(D.h, bhex).length, attStrength: sa, defStrength: sd,
    });
    engaged.add(A.a.id); engaged.add(D.a.id);
    log.push(`${swap ? 'Begegnung' : 'Wettlauf'} bei ${hexName(bhex)}: knapp (${sR.total} zu ${sK.total}), es kommt zur Feldschlacht. ${hn(A.h)} führt die Offiziere${coin ? ' (per Würfel)' : ''}.`);
  };

  const attack = (m: M, holder: CArmy, X: HexKey) => {
    const sAtt = sideOf(c, m.a, m.a.hex, X, supFor(m.h, X), false), sDef = sideOf(c, holder, X, X, supFor(holder.house, X), true);
    const conf: Conflict & { kind: 'attack' } = {
      kind: 'attack', hex: X, step: curStep, att: sAtt, def: sDef,
      outcome: sAtt.total >= AUTO_WIN * sDef.total ? 'overrun' : sDef.total >= AUTO_WIN * sAtt.total ? 'repelled' : 'battle',
    };
    conflicts.push(conf);
    inConflict.add(m.a.id);
    m.done = true;
    if (conf.outcome === 'overrun') {
      log.push(`${hn(m.h)} überrennt ${hexName(X)} (${sAtt.total} zu ${sDef.total}).`);
      conf.defLost = lose(holder, 0.5); conf.attLost = lose(m.a, 0.2);
      conf.retreat = retreatOrDie(c, holder, X, [m.a.hex], log);
      gainXp(c, m.a, 1, log);
      if (m.a.size > 0) stepTo(m, X); else c.armies = c.armies.filter((x) => x !== m.a);
    } else if (conf.outcome === 'repelled') {
      log.push(`${hn(holder.house)} wehrt den Angriff bei ${hexName(X)} klar ab (${sDef.total} zu ${sAtt.total}).`);
      conf.attLost = lose(m.a, 0.3);
      gainXp(c, holder, 1, log);
      if (m.a.size <= 0) c.armies = c.armies.filter((x) => x !== m.a);
    } else {
      battles.push({
        id: `b${c.nextId++}`, hex: X, attacker: m.a.id, defender: holder.id, from: m.a.hex,
        attCards: supFor(m.h, X).length, defCards: supFor(holder.house, X).length, attStrength: sAtt.total, defStrength: sDef.total,
      });
      engaged.add(m.a.id); engaged.add(holder.id);
      log.push(`Knapp! Schlacht bei ${hexName(X)}: ${hn(m.h)} (${sAtt.total}) gegen ${hn(holder.house)} (${sDef.total}).`);
    }
  };

  const steps = Math.max(0, ...movers.map((m) => m.path.length));
  const halted = new Set<string>();
  for (let t = 0; t < steps; t++) {
    curStep = t + 1;
    const act = movers.filter((m) => !m.done && m.i < m.path.length && c.armies.includes(m.a));
    const nxt = new Map(act.map((m) => [m, m.path[m.i]]));
    const live = (m: M) => !m.done;
    // a) swapping places: they meet on the way
    for (const m1 of act) for (const m2 of act) {
      if (m1.h !== 'R' || m2.h !== 'K' || !live(m1) || !live(m2)) continue;
      if (nxt.get(m1) === m2.a.hex && nxt.get(m2) === m1.a.hex) meet(m1, m2, true, m1.a.hex);
    }
    // b) entering the same field in the same step
    for (const X of new Set(act.filter(live).map((m) => nxt.get(m)!))) {
      const group = act.filter((m) => live(m) && nxt.get(m) === X);
      const rs = group.filter((m) => m.h === 'R').sort((a, b) => b.a.size - a.a.size), ks = group.filter((m) => m.h === 'K').sort((a, b) => b.a.size - a.a.size);
      if (!rs.length || !ks.length) continue;
      for (const extra of [...rs.slice(1), ...ks.slice(1)]) extra.done = true;
      meet(rs[0], ks[0], false, X);
    }
    // c) walking into a standing enemy, or into a field with a pending battle
    for (const m of act) {
      if (!live(m)) continue;
      const X = nxt.get(m)!;
      const leaving = (x: CArmy) => { const mm = moverOf.get(x.id); return !!mm && act.includes(mm) && live(mm); };
      const holder = c.armies.find((x) => x.hex === X && x.house !== m.h && !leaving(x));
      if (!holder) continue;
      if (engaged.has(holder.id)) {
        m.done = true;
        if (!halted.has(m.a.id)) { halted.add(m.a.id); log.push(`${hn(m.h)} hält vor ${hexName(X)} an, dort kommt es zur Schlacht.`); }
        continue;
      }
      attack(m, holder, X);
    }
    // d) everyone else takes the step
    for (const m of act) if (live(m) && c.armies.includes(m.a)) { stepTo(m, nxt.get(m)!); m.i++; }
    for (const a of reveal.armies) { const w = walk[a.id]; const now = c.armies.find((x) => x.id === a.id); w.push(now ? now.hex : w[w.length - 1]); }
  }
  for (const m of movers) {
    if (!c.armies.includes(m.a) || m.i === 0 || inConflict.has(m.a.id)) continue;
    log.push(`${hn(m.h)} zieht nach ${hexName(m.a.hex)}.`);
  }
  // own armies that ended on the same field join up
  for (const a of [...c.armies]) {
    if (!c.armies.includes(a) || engaged.has(a.id)) continue;
    const other = c.armies.find((x) => x !== a && x.hex === a.hex && x.house === a.house && !engaged.has(x.id));
    if (other) placeArmy(c, a, a.hex, log);
  }
  c.armies = c.armies.filter((a) => a.size > 0);

  // 3. Agents walk; on an own army's field they join it if they fit
  for (const { h, o } of all) {
    if (o.kind !== 'agent') continue;
    const ag = agentById(c, o.agent);
    if (!ag) continue;
    const trail = [ag.hex];
    for (const k of o.path) {
      if (c.armies.some((a) => a.hex === k && a.house !== h)) { log.push(`Ein ${SPEC_NAME[ag.spec]} von ${hn(h)} meidet ${hexName(k)}: Dort steht ein feindliches Heer.`); break; }
      ag.hex = k; trail.push(k);
    }
    walk[ag.id] = trail;
    const army = c.armies.find((a) => a.hex === ag.hex && a.house === h && !engaged.has(a.id));
    if (army && army.spec[ag.spec] < SPEC_MAX[ag.spec] && specSum(army.spec) + 1 < army.size) {
      army.spec[ag.spec]++;
      c.agents = c.agents.filter((x) => x !== ag);
      log.push(`Ein ${SPEC_NAME[ag.spec]} schließt sich bei ${hexName(army.hex)} dem Heer von ${hn(h)} an.`);
    } else log.push(`Ein ${SPEC_NAME[ag.spec]} von ${hn(h)} erreicht ${hexName(ag.hex)}.`);
  }
  for (const a of c.armies) sweep(c, a, log);

  // 4. Traders walk towards their city
  for (const t of [...c.traders]) {
    if (!c.traders.includes(t)) continue;
    const marine = c.agents.some((a) => a.hex === t.market && a.house === t.house && agentBonus(c, a)?.trader);
    const trail = [t.hex];
    if (c.hexOwner[t.to] !== t.house) {
      const next = nearestCity(c, t.hex, t.house);
      if (!next) { c.traders = c.traders.filter((x) => x !== t); log.push(`Ein Händler von ${hn(t.house)} findet keine eigene Stadt mehr und gibt auf.`); walk[t.id] = trail; continue; }
      t.to = next;
    }
    const path = walkPath(t.hex, t.to) ?? [];
    for (const k of path.slice(0, TRADER_SPEED + (marine ? 1 : 0))) {
      t.hex = k; trail.push(k);
      const enemy = c.armies.find((a) => a.hex === k && a.house !== t.house);
      if (enemy) { sweep(c, enemy, log); break; }
      if (k === t.to) {
        c.gold[t.house] += t.gold;
        c.traders = c.traders.filter((x) => x !== t);
        log.push(`Ein Händler von ${hn(t.house)} erreicht ${PROV[CITY_HEX[k]].n} und bringt ${t.gold} Gold.`);
        break;
      }
    }
    walk[t.id] = trail;
  }

  // 5. Recruits gather in their city after the march
  for (const { h, o } of all) {
    if (o.kind !== 'recruit') continue;
    const ch = cityHex(o.prov);
    const here = armyAt(c, ch);
    if (here && here.house !== h) { log.push(`${hn(h)} kann in ${PROV[o.prov].n} nicht rekrutieren, dort steht ein fremdes Heer.`); continue; }
    c.gold[h] -= COST.recruit;
    const n = recruitSize(c, o.prov, h);
    if (here) { here.xp = mixXp(here.xp, here.size, 0, n); here.size = Math.min(MAX_ARMY, here.size + n); log.push(`${hn(h)} rekrutiert ${n} Figuren in ${PROV[o.prov].n}.`); }
    else { c.armies.push({ id: `a${c.nextId++}`, house: h, hex: ch, size: n, spec: noSpec() }); log.push(`${hn(h)} stellt in ${PROV[o.prov].n} ein neues Heer mit ${n} Figuren auf.`); }
  }

  // pad the walks so every unit has a position at every step
  const len = Math.max(1, ...Object.values(walk).map((w) => w.length));
  for (const u of [...reveal.armies, ...reveal.agents, ...reveal.traders]) {
    const w = (walk[u.id] ??= [u.hex]);
    while (w.length < len) w.push(w[w.length - 1]);
  }
  reveal.walk = walk;

  deriveOwners(c);
  settleBuildings(c, log);
  c.report = log;
  c.conflicts = conflicts;
  c.battles = battles;
  c.orders = { R: [], K: [] };
  c.sealed = { R: false, K: false };
  if (battles.length) { c.phase = 'battles'; return c; }
  return endRound(c);
}

// ---------- battles ----------

/** Result of one battle, from the Deckmate game or from the dice. Sizes are the survivors. */
export interface BattleOutcome { attackerWon: boolean; attacker: { size: number; spec: Spec }; defender: { size: number }; retreat: boolean; how: string }

export function applyBattle(prev: Campaign, id: string, out: BattleOutcome): Campaign {
  const c = clone(prev);
  const b = c.battles.find((x) => x.id === id);
  if (!b) throw new Error('Diese Schlacht gibt es nicht.');
  const att = armyById(c, b.attacker)!, def = armyById(c, b.defender)!;
  const log: string[] = [];
  const attReserve = Math.max(0, att.size - MAX_ARMY), defReserve = Math.max(0, def.size - MAX_STONES);
  att.size = out.attacker.size + attReserve; att.spec = out.attacker.spec;
  def.size = out.defender.size + defReserve;
  c.battles = c.battles.filter((x) => x.id !== id);
  log.push(`${b.field ? 'Feldschlacht' : 'Schlacht'} bei ${hexName(b.hex)} ${out.how}: ${out.attackerWon ? `${hn(att.house)} siegt` : b.field ? `${hn(def.house)} siegt` : `${hn(def.house)} hält stand`}.`);
  const gone = (a: CArmy) => { c.armies = c.armies.filter((x) => x.id !== a.id); };
  const winnerArmy = out.attackerWon ? att : def;
  gainXp(c, att, 1 + (winnerArmy === att ? 1 : 0), log);
  gainXp(c, def, 1 + (winnerArmy === def ? 1 : 0), log);
  const back = (loser: CArmy, to: HexKey) => {
    if (loser.size <= 0) { gone(loser); return; }
    if (to === b.hex || c.armies.some((x) => x.hex === to && x.house !== loser.house)) { retreatOrDie(c, loser, b.hex, [b.from], log); return; }
    log.push(`${hn(loser.house)} kehrt mit ${loser.size} Figuren nach ${hexName(to)} zurück.`);
    placeArmy(c, loser, to, log);
  };
  if (b.field) {
    const [win, loser, to] = out.attackerWon ? [att, def, b.defFrom!] : [def, att, b.from];
    back(loser, to);
    if (win.size > 0) placeArmy(c, win, b.hex, log); else gone(win);
  } else if (out.attackerWon) {
    if (def.size > 0) retreatOrDie(c, def, b.hex, [b.from], log); else gone(def);
    if (att.size > 0) placeArmy(c, att, b.hex, log); else gone(att);
  } else if (att.size <= 0) gone(att);
  c.armies = c.armies.filter((a) => a.size > 0);
  deriveOwners(c);
  settleBuildings(c, log);
  c.report = [...c.report, ...log];
  if (!c.battles.length) return endRound(c);
  return c;
}

/** Quick resolution without the board: chance follows the strength ratio. */
export function autoBattle(c: Campaign, id: string, rng: Rng): Campaign {
  const b = c.battles.find((x) => x.id === id)!;
  const att = armyById(c, b.attacker)!, def = armyById(c, b.defender)!;
  const won = rng() < b.attStrength / (b.attStrength + b.defStrength);
  const a = { size: Math.max(won ? 1 : 0, att.size - Math.ceil(att.size * (won ? 0.3 : 0.5))), spec: { ...att.spec } };
  for (const k of SPECS) a.spec[k] = Math.min(a.spec[k], Math.max(0, a.size - 1));
  const d = { size: Math.max(0, def.size - Math.ceil(def.size * (won ? 0.5 : 0.3))) };
  return applyBattle(c, id, { attackerWon: won, attacker: a, defender: d, retreat: false, how: 'ausgewürfelt' });
}

/** Deckmate game for a pending battle; each supporting army gives its side one extra card. */
export function battleGame(c: Campaign, id: string, rng: Rng): GameState {
  const b = c.battles.find((x) => x.id === id)!;
  const att = armyById(c, b.attacker)!, def = armyById(c, b.defender)!;
  const st = newBattle({
    province: hexName(b.hex), terrain: LAND[hexLand(b.hex)].battle, land: hexLand(b.hex),
    attacker: { house: hn(att.house), size: Math.min(MAX_ARMY, att.size), spec: att.spec },
    defender: { house: hn(def.house), size: Math.min(MAX_STONES, def.size), spec: noSpec() },
  }, rng);
  const keys = Object.keys(CARDS) as CardKey[];
  const vet = (a: CArmy) => (xpOn(c) && rankOf(a) >= 2 ? 1 : 0);
  for (let i = 0; i < vet(att); i++) st.hands.O.push(keys[Math.floor(rng() * keys.length)]);
  for (let i = 0; i < vet(def); i++) st.hands.M.push(keys[Math.floor(rng() * keys.length)]);
  for (let i = 0; i < b.attCards; i++) st.hands.O.push(keys[Math.floor(rng() * keys.length)]);
  for (let i = 0; i < b.defCards; i++) st.hands.M.push(keys[Math.floor(rng() * keys.length)]);
  return st;
}

// ---------- end of round ----------

function endRound(c: Campaign): Campaign {
  const log: string[] = [];
  for (const a of c.armies) {
    if (hexLand(a.hex) === 'S') { a.size--; log.push(`Fieber bei ${hexName(a.hex)}: ${hn(a.house)} verliert 1 Figur.`); }
  }
  c.armies = c.armies.filter((a) => a.size > 0);
  for (const a of c.armies) c.hexOwner[a.hex] = a.house;
  deriveOwners(c);
  settleBuildings(c, log);
  for (const h of ['R', 'K'] as House[]) {
    const inc = income(c, h);
    c.gold[h] += inc.total;
    log.push(`${hn(h)} erhält ${inc.total} Gold (${inc.provinces} Provinzen${inc.cities ? `, Städte +${inc.cities}` : ''}${inc.markets ? `, Märkte +${inc.markets}` : ''}${inc.agents ? `, Kollekte +${inc.agents}` : ''}).`);
  }
  // every active market sends out a trader if it has none on the road
  for (const k of Object.keys(c.buildings)) {
    const h = buildingOwnerOf(c, k);
    if (c.buildings[k] !== 'markt' || !h || !buildingActive(c, k) || c.traders.some((t) => t.market === k)) continue;
    const to = nearestCity(c, k, h);
    if (!to) continue;
    const steps = walkPath(k, to)?.length ?? 0;
    const gold = 2 + steps + levelOf(c, k) - 1;
    c.traders.push({ id: `t${c.nextId++}`, house: h, hex: k, market: k, to, gold });
    log.push(`Vom Markt bei ${hexName(k)} bricht ein Händler von ${hn(h)} nach ${PROV[CITY_HEX[to]].n} auf (${gold} Gold).`);
  }
  for (const h of ['R', 'K'] as House[]) {
    const cap = PROVINCES.find((p) => p.capital === OTHER[h])!;
    if (c.hexOwner[cityHex(cap.id)] === h) { c.phase = 'over'; c.winner = h; c.winReason = `${hn(h)} hat die Hauptstadt ${cap.n} erobert.`; }
    if (!c.armies.some((a) => a.house === OTHER[h]) && !PROVINCES.some((p) => p.city && c.owner[p.id] === OTHER[h])) {
      c.phase = 'over'; c.winner = h; c.winReason = `${hn(OTHER[h])} hat weder Heere noch Städte.`;
    }
  }
  if (c.phase !== 'over' && c.round >= c.maxRounds) {
    const r = finalScore(c, 'R'), k = finalScore(c, 'K');
    if (c.goals) for (const h of ['R', 'K'] as House[]) log.push(`Geheimes Ziel von ${hn(h)}: ${goalText(c.goals[h])} ${goalMet(c, h) ? `Erfüllt, +${GOAL_POINTS} Punkte.` : 'Nicht erfüllt.'}`);
    c.phase = 'over';
    c.winner = r === k ? null : r > k ? 'R' : 'K';
    c.winReason = r === k ? `Nach ${c.maxRounds} Runden steht es unentschieden (${r} zu ${k}).` : `Nach ${c.maxRounds} Runden: ${hn(c.winner!)} führt mit ${Math.max(r, k)} zu ${Math.min(r, k)} Punkten.`;
  }
  if (c.phase === 'over') { log.push(c.winReason!); c.report = [...c.report, ...log]; return c; }
  c.round++;
  c.phase = 'orders';
  c.current = 'R';
  log.push(`Runde ${c.round} beginnt.`);
  c.report = [...c.report, ...log];
  return c;
}
