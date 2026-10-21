// Computer opponent for the campaign. It looks at what each army could reach this round and scores the options
// (take cities and land, attack weak enemies, defend threatened cities, follow its secret goal), adds city orders,
// buildings and research, and keeps the best ones that are allowed. Pure: same input, same orders for a fixed rng.
import { enterMap } from './engine.ts';
import {
  AUTO_WIN, BRANCH_KEYS, BUILDINGS, MAX_LEVEL, ORDERS_PER_ROUND, OTHER, RESEARCH_COST, SPEC_MAX, armyAt, bestNear,
  buildingFor, buildingOwnerOf, engagedIds, levelOf, orderCost, orderProblem, rangeOf, recruitSize, researchOf, specSum,
  strength, type BuildingKey, type Campaign, type Order, type SpecKey,
} from './engine.ts';
import { CITY_HEX, HEX, HEX_ADJ, LAND, PROV, PROVINCES, cityHex, hexDist, hexLand, pathTo, reachable, type HexKey, type House } from './map.ts';
import type { Rng } from '../game/rules.ts';

export type AiLevel = 'leicht' | 'normal';
export const AI_LEVEL: Record<AiLevel, string> = { leicht: 'Computer (leicht)', normal: 'Computer (normal)' };

interface Cand { o: Order; score: number; unit?: string; why: string }

/** Enemy strength that could reach this hex next round (rough: whole army, no terrain). Cached per campaign state. */
const threatCache = new WeakMap<Campaign, Partial<Record<House, { size: number; cost: Record<HexKey, number> }[]>>>();
function threatOn(c: Campaign, house: House, hex: HexKey): number {
  let per = threatCache.get(c);
  if (!per) { per = {}; threatCache.set(c, per); }
  let list = per[house];
  if (!list) {
    const own = new Set(c.armies.filter((a) => a.house === house).map((a) => a.hex));
    list = per[house] = c.armies.filter((e) => e.house !== house).map((e) => ({ size: e.size, cost: reachable(e.hex, rangeOf(e), own).cost }));
  }
  let t = 0;
  for (const e of list) if (hex in e.cost || HEX_ADJ[hex].some((n) => n in e.cost)) t = Math.max(t, e.size);
  return t;
}

export function aiOrders(c: Campaign, house: House, level: AiLevel, rng: Rng): Order[] {
  enterMap(c);
  const enemy = OTHER[house];
  const normal = level === 'normal';
  const noise = () => (normal ? rng() * 2 : rng() * 8);
  const engaged = engagedIds(c);
  const mine = c.armies.filter((a) => a.house === house && !engaged.has(a.id));
  const enemyHexes = new Set(c.armies.filter((a) => a.house === enemy).map((a) => a.hex));
  const myCities = PROVINCES.filter((p) => p.city && c.hexOwner[cityHex(p.id)] === house);
  const goal = c.goals?.[house];
  const goalProvs = new Set(goal?.kind === 'hold' ? goal.provs : []);
  const cands: Cand[] = [];

  // cities in danger: an enemy could reach them, and the garrison would not hold
  const danger = new Map<HexKey, number>();
  for (const p of myCities) {
    const ch = cityHex(p.id);
    const t = threatOn(c, house, ch);
    const garrison = armyAt(c, ch);
    const hold = garrison && garrison.house === house ? strength(c, garrison, ch, [], true) : 0;
    if (normal && t > 0 && hold < t * 1.1) danger.set(ch, t - hold + (PROV[p.id].capital ? 12 : 4));
  }

  // capital guard: with enemies within two marches, someone stays close to the capital
  const capProv = PROVINCES.find((p) => p.capital === house);
  const capHex = capProv ? cityHex(capProv.id) : null;
  const enemyNear = capHex ? Math.min(99, ...c.armies.filter((e) => e.house === enemy).map((e) => hexDist(e.hex, capHex))) : 99;
  const guardNeeded = normal && capHex && c.hexOwner[capHex] === house && enemyNear <= 7;
  const guards = (except: string) => (capHex ? mine.filter((a) => a.id !== except && hexDist(a.hex, capHex) <= 2).length : 0);

  // ---- armies ----
  for (const a of mine) {
    const r = reachable(a.hex, rangeOf(a), enemyHexes);
    const stayDanger = danger.get(a.hex);
    if (stayDanger) cands.push({ o: { kind: 'forage', army: a.id }, score: 20 + stayDanger + noise(), unit: a.id, why: 'hält die bedrohte Stadt' });
    for (const to of Object.keys(r.cost)) {
      if (to === a.hex) continue;
      const path = pathTo(r.prev, to);
      if (!path.length) continue;
      let s = 0;
      // land along the way
      for (const k of path) if (c.hexOwner[k] !== house) s += 2 + (goalProvs.has(HEX[k].prov!) ? 3 : 0);
      const holder = armyAt(c, to);
      const city = CITY_HEX[to];
      if (holder && holder.house === enemy) {
        const sa = strength(c, a, to, [], false), sd = strength(c, holder, to, [], true);
        const ratio = sa / Math.max(0.1, sd);
        if (ratio >= AUTO_WIN) s += 30 + holder.size * 2 + (city ? 25 : 0);
        else if (ratio >= (normal ? 1.15 : 0.9)) s += 10 + (city ? 15 : 0);
        else s -= 40;
        if (city && PROV[city].capital === enemy && ratio >= AUTO_WIN) s += 100;
      } else if (holder && holder.house === house) {
        s -= 4; // merging is rarely worth an order
        if (danger.has(to)) s += 18 + danger.get(to)!;
      } else if (city && c.hexOwner[to] !== house) {
        s += 35 + (PROV[city].capital === enemy ? 60 : 0) + (goalProvs.has(city) ? 10 : 0);
      }
      if (danger.has(to) && !holder) s += 15 + danger.get(to)!;
      if (hexLand(to) === 'S') s -= 4;
      const takesCapital = !!city && PROV[city].capital === enemy;
      if (guardNeeded && !takesCapital && hexDist(to, capHex!) > 3 && hexDist(a.hex, capHex!) <= 3 && !guards(a.id)) s -= 30;
      // leaving a city in danger without a garrison
      if (stayDanger) s -= stayDanger + 10;
      if (normal) {
        // standing next to a much stronger enemy afterwards is risky
        const near = c.armies.filter((e) => e.house === enemy && hexDist(e.hex, to) <= 2 && e.hex !== to);
        if (near.some((e) => e.size > a.size * 1.4)) s -= 12;
      }
      s += noise();
      if (s > 0) cands.push({ o: { kind: 'move', army: a.id, path }, score: s, unit: a.id, why: `zieht nach ${to}` });
    }
    // forage when small and on good land
    const f = LAND[hexLand(a.hex)].forage;
    if (f > 0 && a.size < 12) cands.push({ o: { kind: 'forage', army: a.id }, score: f * 3 + (a.size < 7 ? 4 : 0) + noise(), unit: a.id, why: 'fouragiert' });
  }

  // ---- cities ----
  for (const p of myCities) {
    const ch = cityHex(p.id);
    const here = armyAt(c, ch);
    if (here && here.house !== house) continue;
    const d = danger.get(ch) ?? 0;
    const guardBonus = guardNeeded && ch === capHex && !here ? 15 : 0;
    cands.push({ o: { kind: 'recruit', prov: p.id }, score: 9 + recruitSize(c, p.id, house) + d + guardBonus + (here ? 0 : 4) + noise(), unit: `city:${p.id}`, why: 'rekrutiert' });
    if (here && here.house === house) {
      for (const k of (['CAP', 'KAN', 'KAP', 'MAR'] as SpecKey[])) {
        if (here.spec[k] >= SPEC_MAX[k] || 1 + specSum(here.spec) >= here.size) continue;
        if (!bestNear(c, p.id, buildingFor(k), house)) continue;
        const disc = specSum(here.spec) === 0 ? 10 : 0;
        cands.push({ o: { kind: 'train', prov: p.id, spec: k }, score: 6 + disc + (k === 'KAN' ? 3 : 0) + noise(), unit: `city:${p.id}`, why: 'bildet aus' });
      }
    }
  }

  // ---- buildings ----
  const owned = (b: BuildingKey) => Object.keys(c.buildings).filter((k) => c.buildings[k] === b && buildingOwnerOf(c, k) === house);
  const wantB: Partial<Record<BuildingKey, number>> = {
    markt: owned('markt').length < (normal ? 2 : 1) ? 11 : 2,
    kaserne: owned('kaserne').length ? 1 : 8,
    giesserei: owned('giesserei').length ? 0 : normal ? 5 : 2,
    messe: owned('messe').length ? 0 : 3,
    kapelle: 0,
  };
  if (goal?.kind === 'markets') wantB.markt = (wantB.markt ?? 0) + 6;
  const sites = Object.keys(c.hexOwner).filter((k) => c.hexOwner[k] === house && !c.buildings[k] && !CITY_HEX[k] && !enemyHexes.has(k));
  for (const [b, w] of Object.entries(wantB) as [BuildingKey, number][]) {
    if (!w) continue;
    // prefer fields close to a city and away from the enemy
    const site = sites.filter((k) => myCities.some((p) => hexDist(k, cityHex(p.id)) <= 2))
      .sort((x, y) => threatOn(c, house, x) - threatOn(c, house, y) || x.localeCompare(y))[0];
    if (site) cands.push({ o: { kind: 'build', hex: site, b }, score: w + noise(), unit: `build:${site}`, why: `baut ${BUILDINGS[b].n}` });
  }
  for (const p of myCities) {
    const ch = cityHex(p.id);
    if (!c.buildings[ch] && (danger.has(ch) || PROV[p.id].capital === house)) cands.push({ o: { kind: 'build', hex: ch, b: 'mauer' }, score: (danger.has(ch) ? 12 : 4) + noise(), unit: `build:${ch}`, why: 'baut eine Mauer' });
  }
  for (const k of Object.keys(c.buildings)) {
    if (buildingOwnerOf(c, k) !== house || levelOf(c, k) >= MAX_LEVEL) continue;
    const b = c.buildings[k];
    const v = b === 'markt' ? 8 : b === 'kaserne' ? 6 : b === 'mauer' && danger.has(k) ? 9 : 3;
    cands.push({ o: { kind: 'upgrade', hex: k }, score: v + (goal?.kind === 'levels' ? 6 : 0) + noise(), unit: `build:${k}`, why: `baut ${BUILDINGS[b].n} aus` });
  }

  // ---- pick the best allowed orders ----
  cands.sort((x, y) => y.score - x.score);
  const out: Order[] = [];
  const used = new Set<string>();
  for (const x of cands) {
    if (out.length >= (normal ? ORDERS_PER_ROUND : ORDERS_PER_ROUND - 1)) break;
    if (x.unit && used.has(x.unit)) continue;
    if (x.unit?.startsWith('city:') && out.some((o) => (o.kind === 'recruit' || o.kind === 'train') && `city:${o.prov}` === x.unit)) continue;
    if (orderProblem(c, house, x.o, out)) continue;
    out.push(x.o);
    if (x.unit) used.add(x.unit);
  }

  // ---- research (free, one per round) if gold is left over ----
  const left = c.gold[house] - out.reduce((g, o) => g + orderCost(c, house, o), 0);
  const branches = [...BRANCH_KEYS].sort((a, b) => {
    const has = (br: string) => Object.keys(c.buildings).some((k) => buildingOwnerOf(c, k) === house && BUILDINGS[c.buildings[k]].branch === br);
    return Number(has(b)) - Number(has(a)) || researchOf(c, house, a) - researchOf(c, house, b);
  });
  for (const br of branches) {
    const l = researchOf(c, house, br);
    if (!normal || l >= MAX_LEVEL - 1 || left < RESEARCH_COST[l] + 2) continue;
    const o: Order = { kind: 'research', branch: br };
    if (!orderProblem(c, house, o, out)) { out.push(o); break; }
  }
  return out;
}
