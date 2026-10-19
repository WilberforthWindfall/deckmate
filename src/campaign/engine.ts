// Campaign rules for the one-device prototype: two houses give secret orders in turn, then all orders resolve at once.
// Clear superiority wins automatically; close fights become a Deckmate battle (see game/battle.ts).
// Pure and serializable: the UI stores the whole state as JSON.
import { newBattle } from '../game/battle.ts';
import { CARDS, type Army, type CardKey, type GameState, type Rng } from '../game/rules.ts';
import { ADJ, HOUSES, LAND, PROV, PROVINCES, adjacent, type House } from './map.ts';

export type Spec = Army['spec'];
export type SpecKey = keyof Spec;
export const SPEC_NAME: Record<SpecKey, string> = { CAP: 'Captain', KAP: 'Kaplan', KAN: 'Kanonade', MAR: 'Marine' };
const SPEC_MAX: Spec = { CAP: 1, KAP: 2, KAN: 2, MAR: 2 };

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
}

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

function strength(c: Campaign, a: CArmy, prov: string, supports: CArmy[], defending: boolean) {
  const base = a.size + supports.reduce((s, x) => s + x.size / 2, 0);
  const wall = defending && hasBuilding(c, prov, 'mauer') ? 1.3 : 1;
  return Math.round(base * (defending ? LAND[PROV[prov].land].defense : 1) * wall * 10) / 10;
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

function retreatOrDie(c: Campaign, a: CArmy, from: string, avoid: string[], log: string[]) {
  if (a.size <= 0) { c.armies = c.armies.filter((x) => x.id !== a.id); return; }
  const t = retreatTarget(c, a, from, avoid);
  if (t) { log.push(`${hn(a.house)} zieht sich mit ${a.size} Figuren nach ${pn(t)} zurück.`); placeArmy(c, a, t, log); }
  else { c.armies = c.armies.filter((x) => x.id !== a.id); log.push(`${hn(a.house)} findet keinen Rückzugsweg, das Heer löst sich auf.`); }
}

const lose = (a: CArmy, share: number) => {
  a.size = Math.max(0, a.size - Math.ceil(a.size * share));
  for (const k of Object.keys(a.spec) as SpecKey[]) a.spec[k] = Math.min(a.spec[k], Math.max(0, a.size - 1));
};

function resolve(c: Campaign, _rng: Rng): Campaign {
  const log: string[] = [`Runde ${c.round}: Die Befehle werden aufgedeckt.`];
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
    if (back) { moves = moves.filter((x) => x !== m && x !== back); log.push(`${hn(m.h)} und ${hn(back.h)} prallen zwischen ${pn(m.from)} und ${pn(m.to)} aufeinander, beide halten ihre Stellung.`); }
  }
  // b) both houses into the same province
  for (const to of [...new Set(moves.map((m) => m.to))]) {
    const r = moves.find((m) => m.to === to && m.h === 'R'), k = moves.find((m) => m.to === to && m.h === 'K');
    if (!r || !k) continue;
    const sr = strength(c, r.a, to, supFor('R', to), false), sk = strength(c, k.a, to, supFor('K', to), false);
    if (sr >= AUTO_WIN * sk) { moves = moves.filter((m) => m !== k); log.push(`Wettlauf um ${pn(to)}: Ravensmoor ist klar stärker (${sr} zu ${sk}), Kerrow kehrt um.`); }
    else if (sk >= AUTO_WIN * sr) { moves = moves.filter((m) => m !== r); log.push(`Wettlauf um ${pn(to)}: Kerrow ist klar stärker (${sk} zu ${sr}), Ravensmoor kehrt um.`); }
    else { moves = moves.filter((m) => m !== r && m !== k); log.push(`Wettlauf um ${pn(to)}: Patt (${sr} zu ${sk}), beide kehren um.`); }
  }
  // c) remaining moves: into empty or own provinces, or attacks on holders
  const leaving = new Set(moves.map((m) => m.a.id));
  const battles: PendingBattle[] = [];
  for (const m of moves) {
    const holder = c.armies.find((x) => x.prov === m.to && x.house !== m.h && !leaving.has(x.id));
    if (!holder) { log.push(`${hn(m.h)} zieht nach ${pn(m.to)}${c.owner[m.to] && c.owner[m.to] !== m.h ? ' und nimmt die Provinz ein' : ''}.`); continue; }
    const sa = strength(c, m.a, m.to, supFor(m.h, m.to), false);
    const sd = strength(c, holder, m.to, supFor(holder.house, m.to), true);
    if (sa >= AUTO_WIN * sd) {
      log.push(`${hn(m.h)} überrennt ${pn(m.to)} (${sa} zu ${sd}).`);
      lose(holder, 0.5); lose(m.a, 0.2);
      (m as Mv & { win?: boolean }).win = true;
      (m as Mv & { loser?: CArmy }).loser = holder;
    } else if (sd >= AUTO_WIN * sa) {
      log.push(`${hn(holder.house)} wehrt den Angriff auf ${pn(m.to)} klar ab (${sd} zu ${sa}).`);
      lose(m.a, 0.3);
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
  const done = (moves as (Mv & { win?: boolean; loser?: CArmy; stay?: boolean; battle?: boolean })[]).filter((m) => !m.stay && !m.battle);
  for (const m of done) m.a.prov = '@unterwegs';
  for (const m of done) if (m.win && m.loser) retreatOrDie(c, m.loser, m.to, [m.from], log);
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
    const a = armyById(c, b.attacker)!;
    a.prov = `@${b.prov}`;
  }

  c.report = log;
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
  log.push(`Schlacht um ${pn(b.prov)} ${out.how}: ${out.attackerWon ? `${hn(att.house)} siegt` : `${hn(def.house)} hält stand`}.`);
  if (out.attackerWon) {
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
    const income = provs.length + provs.filter((p) => p.city).length * 2 + markets * 2;
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
