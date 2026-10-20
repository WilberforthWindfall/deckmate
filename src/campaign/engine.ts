// Campaign rules for the one-device prototype: two houses give secret orders in turn, then all orders resolve at once.
// Clear superiority wins automatically; close fights become a Deckmate battle (see game/battle.ts).
// Pure and serializable: the UI stores the whole state as JSON.
import { newBattle } from '../game/battle.ts';
import { CARDS, type Army, type CardKey, type GameState, type Rng } from '../game/rules.ts';
import { ADJ, HOUSES, LAND, PROV, PROVINCES, adjacent, type House } from './map.ts';

export type Spec = Army['spec'];
export type SpecKey = keyof Spec;
export const SPEC_NAME: Record<SpecKey, string> = { CAP: 'Captain', KAP: 'Kaplan', KAN: 'Kanonade', MAR: 'Marine' };
export const SPEC_MAX: Spec = { CAP: 1, KAP: 2, KAN: 2, MAR: 2 };

export type BuildingKey = 'kapelle' | 'giesserei' | 'kaserne' | 'messe' | 'markt' | 'mauer';
export const BUILDINGS: Record<BuildingKey, { n: string; cost: number; effect: string; unlocks?: SpecKey }> = {
  kapelle: { n: 'Kapelle', cost: 4, effect: 'Kapläne können ausgebildet werden.', unlocks: 'KAP' },
  giesserei: { n: 'Gießerei', cost: 5, effect: 'Kanonaden können ausgebildet werden.', unlocks: 'KAN' },
  kaserne: { n: 'Kaserne', cost: 4, effect: 'Marines können ausgebildet werden, Rekrutieren bringt 4 statt 3 Figuren.', unlocks: 'MAR' },
  messe: { n: 'Offiziersmesse', cost: 6, effect: 'Ein Captain kann ausgebildet werden.', unlocks: 'CAP' },
  markt: { n: 'Markt', cost: 5, effect: '+2 Gold pro Runde.' },
  mauer: { n: 'Stadtmauer', cost: 5, effect: 'Verteidiger der Stadt sind 30 % stärker.' },
};
export const BUILDING_KEYS = Object.keys(BUILDINGS) as BuildingKey[];
export const buildingFor = (spec: SpecKey) => BUILDING_KEYS.find((k) => BUILDINGS[k].unlocks === spec)!;
export const hasBuilding = (c: Campaign, prov: string, b: BuildingKey) => (c.buildings?.[prov] ?? []).includes(b);

export const MAX_ARMY = 16;
export const ORDERS_PER_ROUND = 3;
export const COST = { recruit: 3, train: 4 } as const;
export const AUTO_WIN = 1.5;

export interface CArmy { id: string; house: House; prov: string; size: number; spec: Spec }

export type Order =
  | { kind: 'move'; army: string; to: string }
  | { kind: 'support'; army: string; target: string }
  | { kind: 'forage'; army: string }
  | { kind: 'recruit'; prov: string }
  | { kind: 'train'; prov: string; spec: SpecKey }
  | { kind: 'build'; prov: string; b: BuildingKey };

export interface PendingBattle {
  id: string;
  prov: string;
  /** Attacking army (moved in), leads the officers. */
  attacker: string;
  /** Defending army (held the province), leads the crew. */
  defender: string;
  from: string;
  attCards: number;
  defCards: number;
  attStrength: number;
  defStrength: number;
  /** Field battle after a close race into the same province: nobody held it, the loser turns back to defFrom. */
  field?: boolean;
  defFrom?: string;
}

/** One side of a conflict with the parts of its strength. */
export interface ConflictSide {
  house: House; army: string; from: string; size: number;
  sup: { prov: string; size: number; add: number }[];
  /** Terrain and wall factors, 1 if none (only defenders get them). */
  terrain: number; wall: number; total: number;
}
export type Conflict =
  | { kind: 'swap'; a: { house: House; army: string; from: string; to: string; size: number }; b: { house: House; army: string; from: string; to: string; size: number } }
  | { kind: 'race'; prov: string; R: ConflictSide; K: ConflictSide; winner: House | null; battle?: { attacker: House; coin: boolean } }
  | { kind: 'attack'; prov: string; att: ConflictSide; def: ConflictSide; outcome: 'overrun' | 'repelled' | 'battle'; retreat?: string | null; attLost?: number; defLost?: number };

export interface Campaign {
  v: 1;
  round: number;
  maxRounds: number;
  phase: 'orders' | 'battles' | 'over';
  current: House;
  owner: Record<string, House | null>;
  /** Buildings per city; they stay when the city changes hands. */
  buildings: Record<string, BuildingKey[]>;
  gold: Record<House, number>;
  armies: CArmy[];
  orders: Record<House, Order[]>;
  sealed: Record<House, boolean>;
  battles: PendingBattle[];
  report: string[];
  winner: House | null;
  winReason: string | null;
  nextId: number;
  /** Snapshot taken when the orders were revealed, for the reveal animation. Cleared by the UI afterwards. */
  /** What happened in the conflicts of the last resolved round, step by step for the explanation cards. */
  conflicts?: Conflict[];
  reveal?: { round: number; armies: CArmy[]; owner: Record<string, House | null>; gold: Record<House, number>; orders: Record<House, Order[]> } | null;
}

export const OTHER: Record<House, House> = { R: 'K', K: 'R' };
const noSpec = (): Spec => ({ CAP: 0, KAP: 0, KAN: 0, MAR: 0 });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const pn = (id: string) => PROV[id].n;
const hn = (h: House) => HOUSES[h].n;

export function newCampaign(): Campaign {
  const owner: Record<string, House | null> = Object.fromEntries(PROVINCES.map((p) => [p.id, p.start ?? null]));
  const armies: CArmy[] = [
    { id: 'a1', house: 'R', prov: 'aldfurt', size: 10, spec: { CAP: 1, KAP: 1, KAN: 0, MAR: 0 } },
    { id: 'a2', house: 'R', prov: 'suedhafen', size: 6, spec: noSpec() },
    { id: 'a3', house: 'K', prov: 'kapostra', size: 10, spec: { CAP: 1, KAP: 1, KAN: 0, MAR: 0 } },
    { id: 'a4', house: 'K', prov: 'ostkueste', size: 6, spec: noSpec() },
  ];
  return {
    v: 1, round: 1, maxRounds: 10, phase: 'orders', current: 'R', owner,
    buildings: { aldfurt: ['kapelle'], kapostra: ['kapelle'] }, gold: { R: 4, K: 4 }, armies,
    orders: { R: [], K: [] }, sealed: { R: false, K: false }, battles: [],
    report: ['Runde 1 beginnt. Ravensmoor gibt zuerst seine Befehle, Kerrow schaut weg.'], winner: null, winReason: null, nextId: 5,
  };
}

export const armyAt = (c: Campaign, prov: string) => c.armies.find((a) => a.prov === prov) ?? null;
export const armyById = (c: Campaign, id: string) => c.armies.find((a) => a.id === id) ?? null;
const specSum = (s: Spec) => s.CAP + s.KAP + s.KAN + s.MAR;

/** Why an order is not allowed (empty string if it is), given the house's other orders this round. */
export function orderProblem(c: Campaign, house: House, o: Order, others: Order[]): string {
  if (others.length >= ORDERS_PER_ROUND) return `Pro Runde sind ${ORDERS_PER_ROUND} Befehle erlaubt.`;
  if (o.kind === 'recruit' || o.kind === 'train' || o.kind === 'build') {
    const p = PROV[o.prov];
    if (!p?.city) return 'Nur in Städten.';
    if (c.owner[o.prov] !== house) return 'Die Stadt gehört nicht deinem Haus.';
    const spent = others.reduce((g, x) => g + orderCost(x), 0);
    const cost = orderCost(o);
    if (others.some((x) => (x.kind === 'recruit' || x.kind === 'train' || x.kind === 'build') && x.prov === o.prov)) return 'Pro Stadt und Runde ein Befehl (Bauen, Rekrutieren oder Ausbilden).';
    if (o.kind === 'build') {
      if (hasBuilding(c, o.prov, o.b)) return `${BUILDINGS[o.b].n} steht hier schon.`;
      if (c.gold[house] - spent < cost) return `Dafür fehlt Gold (${cost} nötig).`;
      return '';
    }
    if (c.gold[house] - spent < cost) return `Dafür fehlt Gold (${cost} nötig).`;
    const here = armyAt(c, o.prov);
    if (here && here.house !== house) return 'In der Stadt steht ein fremdes Heer.';
    if (o.kind === 'train') {
      if (!hasBuilding(c, o.prov, buildingFor(o.spec))) return `Dafür braucht die Stadt eine ${BUILDINGS[buildingFor(o.spec)].n}.`;
      if (!here) return 'Zum Ausbilden muss ein eigenes Heer in der Stadt stehen.';
      if (here.spec[o.spec] >= SPEC_MAX[o.spec]) return `Das Heer hat schon die Höchstzahl an ${SPEC_NAME[o.spec]}.`;
      if (1 + specSum(here.spec) >= here.size) return 'Das Heer ist zu klein für weitere Spezialisten.';
    }
    return '';
  }
  const a = armyById(c, o.army);
  if (!a || a.house !== house) return 'Das ist kein Heer deines Hauses.';
  if (others.some((x) => 'army' in x && x.army === o.army)) return 'Dieses Heer hat schon einen Befehl.';
  if (o.kind === 'move') {
    if (!adjacent(a.prov, o.to)) return 'Heere ziehen nur in eine Nachbarprovinz.';
    if (others.some((x) => x.kind === 'move' && x.to === o.to)) return 'Ein anderes Heer zieht schon dorthin.';
    return '';
  }
  if (o.kind === 'support') {
    if (!adjacent(a.prov, o.target)) return 'Unterstützen geht nur in eine Nachbarprovinz.';
    return '';
  }
  if (o.kind === 'forage') {
    if (LAND[PROV[a.prov].land].forage === 0) return 'Im Gebirge gibt es nichts zu fouragieren.';
    if (a.size >= MAX_ARMY) return 'Das Heer ist schon voll.';
    return '';
  }
  return 'Unbekannter Befehl.';
}

export type Tone = 'ok' | 'risk' | 'bad' | 'plain';
/**
 * What a move would probably lead to, from what the house can see: the visible defender and the house's own planned supports.
 * Hidden enemy supports and moves are not known and not counted.
 */
export function movePreview(c: Campaign, house: House, armyId: string, to: string, draft: Order[]): { text: string; tone: Tone } {
  const a = armyById(c, armyId);
  if (!a) return { text: '', tone: 'plain' };
  const holder = armyAt(c, to);
  if (holder && holder.house === house) return { text: 'vereinen', tone: 'plain' };
  if (!holder) {
    if (c.owner[to] === house) return { text: 'verlegen', tone: 'plain' };
    return { text: c.owner[to] ? 'einnehmen' : 'besetzen', tone: 'ok' };
  }
  const moving = new Set(draft.flatMap((o) => (o.kind === 'move' ? [o.army] : [])));
  const sup = draft.flatMap((o) => (o.kind === 'support' && o.target === to && !moving.has(o.army) ? [armyById(c, o.army)!] : [])).filter(Boolean);
  const sa = strength(c, a, to, sup, false), sd = strength(c, holder, to, [], true);
  const fmt = (x: number) => String(x).replace('.', ',');
  if (sa >= AUTO_WIN * sd) return { text: `${fmt(sa)} : ${fmt(sd)} · überrennt`, tone: 'ok' };
  if (sd >= AUTO_WIN * sa) return { text: `${fmt(sa)} : ${fmt(sd)} · chancenlos`, tone: 'bad' };
  return { text: `${fmt(sa)} : ${fmt(sd)} · Schlacht`, tone: 'risk' };
}

export const orderCost = (o: Order) => (o.kind === 'recruit' ? COST.recruit : o.kind === 'train' ? COST.train : o.kind === 'build' ? BUILDINGS[o.b].cost : 0);
export const recruitSize = (c: Campaign, prov: string) => (hasBuilding(c, prov, 'kaserne') ? 4 : 3);

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

export function strength(c: Campaign, a: CArmy, prov: string, supports: CArmy[], defending: boolean) {
  const base = a.size + supports.reduce((s, x) => s + x.size / 2, 0);
  const wall = defending && hasBuilding(c, prov, 'mauer') ? 1.3 : 1;
  return Math.round(base * (defending ? LAND[PROV[prov].land].defense : 1) * wall * 10) / 10;
}

function sideOf(c: Campaign, a: CArmy, from: string, prov: string, supports: CArmy[], defending: boolean): ConflictSide {
  return {
    house: a.house, army: a.id, from, size: a.size,
    sup: supports.map((x) => ({ prov: x.prov, size: x.size, add: x.size / 2 })),
    terrain: defending ? LAND[PROV[prov].land].defense : 1,
    wall: defending && hasBuilding(c, prov, 'mauer') ? 1.3 : 1,
    total: strength(c, a, prov, supports, defending),
  };
}

function retreatTarget(c: Campaign, a: CArmy, from: string, avoid: string[]): string | null {
  const opts = ADJ[from].filter((p) => !avoid.includes(p) && (c.owner[p] === a.house || c.owner[p] === null)
    && !c.armies.some((x) => x.prov === p && x.house !== a.house));
  opts.sort((x, y) => Number(c.owner[y] === a.house) - Number(c.owner[x] === a.house));
  return opts[0] ?? null;
}

function placeArmy(c: Campaign, a: CArmy, prov: string, log: string[]) {
  const own = c.armies.find((x) => x.id !== a.id && x.prov === prov && x.house === a.house);
  if (own) {
    own.size = Math.min(MAX_ARMY, own.size + a.size);
    for (const k of Object.keys(own.spec) as SpecKey[]) own.spec[k] = Math.min(SPEC_MAX[k], own.spec[k] + a.spec[k]);
    c.armies = c.armies.filter((x) => x.id !== a.id);
    log.push(`${hn(a.house)}: Zwei Heere vereinen sich in ${pn(prov)}.`);
  } else a.prov = prov;
  c.owner[prov] = a.house;
}

/** Moves a beaten army away; returns where it went, or null if it was destroyed. */
function retreatOrDie(c: Campaign, a: CArmy, from: string, avoid: string[], log: string[]): string | null {
  if (a.size <= 0) { c.armies = c.armies.filter((x) => x.id !== a.id); return null; }
  const t = retreatTarget(c, a, from, avoid);
  if (t) { log.push(`${hn(a.house)} zieht sich mit ${a.size} Figuren nach ${pn(t)} zurück.`); placeArmy(c, a, t, log); return t; }
  c.armies = c.armies.filter((x) => x.id !== a.id); log.push(`${hn(a.house)} findet keinen Rückzugsweg, das Heer löst sich auf.`);
  return null;
}

const lose = (a: CArmy, share: number) => {
  a.size = Math.max(0, a.size - Math.ceil(a.size * share));
  for (const k of Object.keys(a.spec) as SpecKey[]) a.spec[k] = Math.min(a.spec[k], Math.max(0, a.size - 1));
};

function resolve(c: Campaign, rng: Rng): Campaign {
  c.reveal = { round: c.round, armies: clone(c.armies), owner: clone(c.owner), gold: { ...c.gold }, orders: clone(c.orders) };
  const log: string[] = [`Runde ${c.round}: Die Befehle werden aufgedeckt.`];
  const conflicts: Conflict[] = [];
  const all = (['R', 'K'] as House[]).flatMap((h) => c.orders[h].map((o) => ({ h, o })));

  // 1. Training and supplies
  for (const { h, o } of all) {
    if (o.kind === 'build') {
      c.gold[h] -= BUILDINGS[o.b].cost;
      (c.buildings[o.prov] ??= []).push(o.b);
      log.push(`${hn(h)} baut in ${pn(o.prov)}: ${BUILDINGS[o.b].n}.`);
    }
    if (o.kind === 'train') {
      c.gold[h] -= COST.train;
      const here = armyAt(c, o.prov)!;
      here.spec[o.spec]++;
      log.push(`${hn(h)} bildet in ${pn(o.prov)} einen ${SPEC_NAME[o.spec]} aus.`);
    }
    if (o.kind === 'forage') {
      const a = armyById(c, o.army)!;
      const plus = LAND[PROV[a.prov].land].forage;
      a.size = Math.min(MAX_ARMY, a.size + plus);
      log.push(`${hn(h)} fouragiert in ${pn(a.prov)} (+${plus}).`);
    }
  }

  // 2. Movement
  type Mv = { h: House; a: CArmy; from: string; to: string };
  let moves: Mv[] = all.flatMap(({ h, o }) => (o.kind === 'move' ? [{ h, a: armyById(c, o.army)!, from: armyById(c, o.army)!.prov, to: o.to }] : []));
  const supports = all.flatMap(({ h, o }) => (o.kind === 'support' ? [{ h, a: armyById(c, o.army)!, target: o.target }] : []));
  const supFor = (h: House, prov: string) => supports.filter((s) => s.h === h && s.target === prov && !moves.some((m) => m.a.id === s.a.id)).map((s) => s.a);

  // a) armies swapping places bounce off each other
  for (const m of [...moves]) {
    const back = moves.find((x) => x.h !== m.h && x.from === m.to && x.to === m.from);
    if (back) {
      conflicts.push({ kind: 'swap', a: { house: m.h, army: m.a.id, from: m.from, to: m.to, size: m.a.size }, b: { house: back.h, army: back.a.id, from: back.from, to: back.to, size: back.a.size } });
      moves = moves.filter((x) => x !== m && x !== back); log.push(`${hn(m.h)} und ${hn(back.h)} prallen zwischen ${pn(m.from)} und ${pn(m.to)} aufeinander, beide halten ihre Stellung.`);
    }
  }
  const battles: PendingBattle[] = [];
  // b) both houses into the same province
  for (const to of [...new Set(moves.map((m) => m.to))]) {
    const r = moves.find((m) => m.to === to && m.h === 'R'), k = moves.find((m) => m.to === to && m.h === 'K');
    if (!r || !k) continue;
    const sr = strength(c, r.a, to, supFor('R', to), false), sk = strength(c, k.a, to, supFor('K', to), false);
    const race: Conflict = { kind: 'race', prov: to, R: sideOf(c, r.a, r.from, to, supFor('R', to), false), K: sideOf(c, k.a, k.from, to, supFor('K', to), false), winner: sr >= AUTO_WIN * sk ? 'R' : sk >= AUTO_WIN * sr ? 'K' : null };
    conflicts.push(race);
    if (sr >= AUTO_WIN * sk) { moves = moves.filter((m) => m !== k); log.push(`Wettlauf um ${pn(to)}: Ravensmoor ist klar stärker (${sr} zu ${sk}), Kerrow kehrt um.`); }
    else if (sk >= AUTO_WIN * sr) { moves = moves.filter((m) => m !== r); log.push(`Wettlauf um ${pn(to)}: Kerrow ist klar stärker (${sk} zu ${sr}), Ravensmoor kehrt um.`); }
    else {
      // Close race: the armies meet in the field. The stronger one leads the officers; on a tie the dice decide.
      moves = moves.filter((m) => m !== r && m !== k);
      const coin = sr === sk;
      const A = sr > sk || (coin && rng() < 0.5) ? r : k, D = A === r ? k : r;
      const sa = A === r ? sr : sk, sd = A === r ? sk : sr;
      (race as Conflict & { kind: 'race' }).battle = { attacker: A.h, coin };
      battles.push({
        id: `b${c.nextId++}`, prov: to, attacker: A.a.id, defender: D.a.id, from: A.from, defFrom: D.from, field: true,
        attCards: supFor(A.h, to).length, defCards: supFor(D.h, to).length, attStrength: sa, defStrength: sd,
      });
      A.a.prov = `@${to}`; D.a.prov = `@${to}`;
      log.push(`Wettlauf um ${pn(to)}: knapp (${sr} zu ${sk}), es kommt zur Feldschlacht. ${hn(A.h)} führt die Offiziere${coin ? ' (per Würfel)' : ''}.`);
    }
  }
  // c) remaining moves: into empty or own provinces, or attacks on holders
  const leaving = new Set(moves.map((m) => m.a.id));
  for (const m of moves) {
    const holder = c.armies.find((x) => x.prov === m.to && x.house !== m.h && !leaving.has(x.id));
    if (!holder) { log.push(`${hn(m.h)} zieht nach ${pn(m.to)}${c.owner[m.to] && c.owner[m.to] !== m.h ? ' und nimmt die Provinz ein' : ''}.`); continue; }
    const sa = strength(c, m.a, m.to, supFor(m.h, m.to), false);
    const sd = strength(c, holder, m.to, supFor(holder.house, m.to), true);
    const attack: Conflict & { kind: 'attack' } = {
      kind: 'attack', prov: m.to, att: sideOf(c, m.a, m.from, m.to, supFor(m.h, m.to), false), def: sideOf(c, holder, m.to, m.to, supFor(holder.house, m.to), true),
      outcome: sa >= AUTO_WIN * sd ? 'overrun' : sd >= AUTO_WIN * sa ? 'repelled' : 'battle',
    };
    conflicts.push(attack);
    (m as Mv & { conflict?: typeof attack }).conflict = attack;
    if (sa >= AUTO_WIN * sd) {
      log.push(`${hn(m.h)} überrennt ${pn(m.to)} (${sa} zu ${sd}).`);
      const hs = holder.size, as = m.a.size;
      lose(holder, 0.5); lose(m.a, 0.2);
      attack.defLost = hs - holder.size; attack.attLost = as - m.a.size;
      (m as Mv & { win?: boolean }).win = true;
      (m as Mv & { loser?: CArmy }).loser = holder;
    } else if (sd >= AUTO_WIN * sa) {
      log.push(`${hn(holder.house)} wehrt den Angriff auf ${pn(m.to)} klar ab (${sd} zu ${sa}).`);
      const as = m.a.size;
      lose(m.a, 0.3);
      attack.attLost = as - m.a.size;
      (m as Mv & { stay?: boolean }).stay = true;
    } else {
      battles.push({
        id: `b${c.nextId++}`, prov: m.to, attacker: m.a.id, defender: holder.id, from: m.from,
        attCards: supFor(m.h, m.to).length, defCards: supFor(holder.house, m.to).length, attStrength: sa, defStrength: sd,
      });
      log.push(`Knapp! Schlacht um ${pn(m.to)}: ${hn(m.h)} (${sa}) gegen ${hn(holder.house)} (${sd}).`);
      (m as Mv & { battle?: boolean }).battle = true;
    }
  }
  // apply movement results
  const done = (moves as (Mv & { win?: boolean; loser?: CArmy; stay?: boolean; battle?: boolean; conflict?: Conflict & { kind: 'attack' } })[]).filter((m) => !m.stay && !m.battle);
  for (const m of done) m.a.prov = '@unterwegs';
  for (const m of done) if (m.win && m.loser) { const t = retreatOrDie(c, m.loser, m.to, [m.from], log); if (m.conflict) m.conflict.retreat = t; }
  for (const m of done) {
    if (m.a.size > 0) placeArmy(c, m.a, m.to, log); else c.armies = c.armies.filter((x) => x.id !== m.a.id);
  }
  c.armies = c.armies.filter((a) => a.size > 0);
  // 3. Recruits gather in their city after the armies have marched.
  for (const { h, o } of all) {
    if (o.kind !== 'recruit') continue;
    c.gold[h] -= COST.recruit;
    const here = armyAt(c, o.prov);
    if (here && here.house !== h) { log.push(`${hn(h)} kann in ${pn(o.prov)} nicht rekrutieren, dort steht ein fremdes Heer.`); c.gold[h] += COST.recruit; continue; }
    const n = recruitSize(c, o.prov);
    if (here) { here.size = Math.min(MAX_ARMY, here.size + n); log.push(`${hn(h)} rekrutiert ${n} Figuren in ${pn(o.prov)}.`); }
    else { c.armies.push({ id: `a${c.nextId++}`, house: h, prov: o.prov, size: n, spec: noSpec() }); log.push(`${hn(h)} stellt in ${pn(o.prov)} ein neues Heer mit ${n} Figuren auf.`); }
  }
  // Armies waiting for their battle stand "between" provinces: they have left their origin.
  for (const b of battles) {
    armyById(c, b.attacker)!.prov = `@${b.prov}`;
    if (b.field) armyById(c, b.defender)!.prov = `@${b.prov}`;
  }

  c.report = log;
  c.conflicts = conflicts;
  c.battles = battles;
  c.orders = { R: [], K: [] };
  c.sealed = { R: false, K: false };
  if (battles.length) { c.phase = 'battles'; return c; }
  return endRound(c);
}

/** Result of one battle, from the Deckmate game or from the dice. Sizes are the survivors. */
export interface BattleOutcome { attackerWon: boolean; attacker: { size: number; spec: Spec }; defender: { size: number }; retreat: boolean; how: string }

export function applyBattle(prev: Campaign, id: string, out: BattleOutcome): Campaign {
  const c = clone(prev);
  const b = c.battles.find((x) => x.id === id);
  if (!b) throw new Error('Diese Schlacht gibt es nicht.');
  const att = armyById(c, b.attacker)!, def = armyById(c, b.defender)!;
  const log: string[] = [];
  const attReserve = Math.max(0, att.size - MAX_ARMY), defReserve = Math.max(0, def.size - 12);
  att.size = out.attacker.size + attReserve; att.spec = out.attacker.spec;
  def.size = out.defender.size + defReserve;
  log.push(`${b.field ? 'Feldschlacht' : 'Schlacht'} um ${pn(b.prov)} ${out.how}: ${out.attackerWon ? `${hn(att.house)} siegt` : b.field ? `${hn(def.house)} siegt` : `${hn(def.house)} hält stand`}.`);
  if (b.field) {
    // Winner takes the province, the loser turns back to where it came from.
    const [win, lose, back] = out.attackerWon ? [att, def, b.defFrom!] : [def, att, b.from];
    win.prov = out.attackerWon ? b.from : b.defFrom!;
    if (win.size > 0) placeArmy(c, win, b.prov, log); else c.armies = c.armies.filter((x) => x.id !== win.id);
    lose.prov = back;
    const blocked = c.armies.some((x) => x.prov === back && x.house !== lose.house);
    if (lose.size <= 0) c.armies = c.armies.filter((x) => x.id !== lose.id);
    else if (blocked) retreatOrDie(c, lose, back, [b.prov], log);
    else { log.push(`${hn(lose.house)} kehrt mit ${lose.size} Figuren nach ${pn(back)} zurück.`); placeArmy(c, lose, back, log); }
  } else if (out.attackerWon) {
    retreatOrDie(c, def, b.prov, [b.from], log);
    att.prov = b.from;
    if (att.size > 0) placeArmy(c, att, b.prov, log); else c.armies = c.armies.filter((x) => x.id !== att.id);
  } else {
    att.prov = b.from;
    const blocked = c.armies.some((x) => x.prov === b.from && x.house !== att.house);
    if (att.size <= 0) c.armies = c.armies.filter((x) => x.id !== att.id);
    else if (blocked) retreatOrDie(c, att, b.from, [b.prov], log);
    else { log.push(`${hn(att.house)} kehrt mit ${att.size} Figuren nach ${pn(b.from)} zurück.`); placeArmy(c, att, b.from, log); }
  }
  c.armies = c.armies.filter((a) => a.size > 0);
  c.battles = c.battles.filter((x) => x.id !== id);
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
  for (const k of Object.keys(a.spec) as SpecKey[]) a.spec[k] = Math.min(a.spec[k], Math.max(0, a.size - 1));
  const d = { size: Math.max(0, def.size - Math.ceil(def.size * (won ? 0.5 : 0.3))) };
  return applyBattle(c, id, { attackerWon: won, attacker: a, defender: d, retreat: false, how: 'ausgewürfelt' });
}

/** Deckmate game for a pending battle; each supporting army gives its side one extra card. */
export function battleGame(c: Campaign, id: string, rng: Rng): GameState {
  const b = c.battles.find((x) => x.id === id)!;
  const att = armyById(c, b.attacker)!, def = armyById(c, b.defender)!;
  const st = newBattle({
    province: pn(b.prov), terrain: LAND[PROV[b.prov].land].battle,
    attacker: { house: hn(att.house), size: Math.min(MAX_ARMY, att.size), spec: att.spec },
    defender: { house: hn(def.house), size: Math.min(12, def.size), spec: noSpec() },
  }, rng);
  const keys = Object.keys(CARDS) as CardKey[];
  for (let i = 0; i < b.attCards; i++) st.hands.O.push(keys[Math.floor(rng() * keys.length)]);
  for (let i = 0; i < b.defCards; i++) st.hands.M.push(keys[Math.floor(rng() * keys.length)]);
  return st;
}

/** Gold a house receives at the end of the round: 1 per province, +2 per city, +2 per market. */
export function incomeOf(c: Campaign, h: House) {
  const provs = PROVINCES.filter((p) => c.owner[p.id] === h);
  return provs.length + provs.filter((p) => p.city).length * 2 + provs.filter((p) => hasBuilding(c, p.id, 'markt')).length * 2;
}

export function score(c: Campaign, h: House) {
  const provs = PROVINCES.filter((p) => c.owner[p.id] === h);
  return provs.length + provs.filter((p) => p.city).length * 2;
}

function endRound(c: Campaign): Campaign {
  const log: string[] = [];
  for (const a of c.armies) {
    if (PROV[a.prov]?.land === 'S') { a.size--; log.push(`Fieber in ${pn(a.prov)}: ${hn(a.house)} verliert 1 Figur.`); }
  }
  c.armies = c.armies.filter((a) => a.size > 0);
  for (const a of c.armies) c.owner[a.prov] = a.house;
  for (const h of ['R', 'K'] as House[]) {
    const provs = PROVINCES.filter((p) => c.owner[p.id] === h);
    const markets = provs.filter((p) => hasBuilding(c, p.id, 'markt')).length;
    const income = incomeOf(c, h);
    c.gold[h] += income;
    log.push(`${hn(h)} erhält ${income} Gold (${provs.length} Provinzen, ${provs.filter((p) => p.city).length} Städte${markets ? `, ${markets} Märkte` : ''}).`);
  }
  for (const h of ['R', 'K'] as House[]) {
    const cap = PROVINCES.find((p) => p.capital === OTHER[h])!;
    if (c.owner[cap.id] === h) { c.phase = 'over'; c.winner = h; c.winReason = `${hn(h)} hat die Hauptstadt ${cap.n} erobert.`; }
    if (!c.armies.some((a) => a.house === OTHER[h]) && !PROVINCES.some((p) => p.city && c.owner[p.id] === OTHER[h])) {
      c.phase = 'over'; c.winner = h; c.winReason = `${hn(OTHER[h])} hat weder Heere noch Städte.`;
    }
  }
  if (c.phase !== 'over' && c.round >= c.maxRounds) {
    const r = score(c, 'R'), k = score(c, 'K');
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
