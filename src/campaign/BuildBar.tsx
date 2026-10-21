import {
  BRANCHES, BRANCH_KEYS, BUILDINGS, BUILDING_KEYS, MAX_LEVEL, ORDERS_PER_ROUND, RESEARCH_COST, ROMAN, buildingOwnerOf, levelEffect, levelOf,
  orderCost, orderCount, orderProblem, researchOf, upgradeCost,
  type Branch, type BuildingKey, type Campaign, type Order,
} from './engine.ts';
import { CITY_HEX, hexName, type HexKey, type House } from './map.ts';
import { BUILDING_ICON } from './CampaignMap.tsx';

// Build bar at the bottom of the map: one tab per research area with its research, new buildings and upgrades.
// Two ways in: pick a card and then a glowing field, or pick a field first (site) and the cards show what fits there.

export type BuildPick = { kind: 'build' | 'upgrade'; b: BuildingKey };

type Tone = 'good' | 'warn' | 'bad' | 'plain';
const TONE: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: 'color-mix(in srgb, var(--ok) 22%, transparent)', fg: '#CFE9C4' },
  warn: { bg: 'color-mix(in srgb, var(--brass) 25%, transparent)', fg: '#F3DFA8' },
  bad: { bg: 'color-mix(in srgb, var(--hit) 25%, transparent)', fg: '#F2C4BE' },
  plain: { bg: 'var(--hull-2)', fg: 'var(--parchment)' },
};
const toneOf = (why: string): Tone => (!why ? 'good' : /Gold/.test(why) ? 'warn' : 'bad');

interface Card { key: string; title: string; sub: string; effect: string; state: string; tone: Tone; onClick?: () => void; planned?: number }

export default function BuildBar({ c, house, draft, add, remove, site, tab, setTab, onPick, onClearSite, shift = 0 }: {
  c: Campaign; house: House; draft: Order[]; add: (o: Order) => void; remove: (i: number) => void;
  site: HexKey | null; tab: Branch | null; setTab: (t: Branch | null) => void; onPick: (p: BuildPick) => void; onClearSite: () => void;
  /** Px to move right (an open drawer covers the left side). */
  shift?: number;
}) {
  const why = (o: Order) => orderProblem(c, house, o, draft);
  const lands = Object.keys(c.hexOwner);
  const full = orderCount(draft) >= ORDERS_PER_ROUND;

  const cardsFor = (br: Branch): Card[] => {
    const out: Card[] = [];
    // research
    const l = researchOf(c, house, br);
    const ri = draft.findIndex((o) => o.kind === 'research' && o.branch === br);
    if (ri >= 0) out.push({ key: 'r', title: `Forschung: ${BRANCHES[br].research[l]}`, sub: `${RESEARCH_COST[l]} Gold · ohne Befehl`, effect: `Ab nächster Runde: ${BRANCHES[br].text} (${ROMAN[l + 2]}).`, state: 'geplant · zurücknehmen', tone: 'plain', onClick: () => remove(ri), planned: ri });
    else if (l >= MAX_LEVEL - 1) out.push({ key: 'r', title: `Forschung ${BRANCHES[br].n}`, sub: 'fertig erforscht', effect: `Alle Stufen bis ${ROMAN[MAX_LEVEL]} sind erlaubt.`, state: `Stufe ${ROMAN[l]}`, tone: 'plain' });
    else {
      const o: Order = { kind: 'research', branch: br };
      const w = why(o);
      out.push({ key: 'r', title: `Forschung: ${BRANCHES[br].research[l]}`, sub: `${RESEARCH_COST[l]} Gold · ohne Befehl`, effect: `${BRANCHES[br].text[0].toUpperCase()}${BRANCHES[br].text.slice(1)} (${ROMAN[l + 2]}).`, state: w || 'erforschen', tone: toneOf(w), onClick: w ? undefined : () => add(o) });
    }
    // new buildings
    for (const b of BUILDING_KEYS.filter((k) => BUILDINGS[k].branch === br && !(site && c.buildings[site]))) {
      const base = { key: `b${b}`, title: `${BUILDING_ICON[b]} ${BUILDINGS[b].n}`, sub: `${BUILDINGS[b].cost} Gold · 1 Befehl`, effect: BUILDINGS[b].effect };
      if (site) {
        const o: Order = { kind: 'build', hex: site, b };
        const w = why(o);
        out.push({ ...base, state: w || `hier bauen`, tone: toneOf(w), onClick: w ? undefined : () => add(o) });
        continue;
      }
      const sites = lands.filter((k) => !why({ kind: 'build', hex: k, b }));
      const w = sites.length ? '' : full ? `Alle ${ORDERS_PER_ROUND} Befehle vergeben.` : c.gold[house] < BUILDINGS[b].cost ? `${BUILDINGS[b].cost - c.gold[house]} Gold fehlen` : b === 'mauer' ? 'Keine eigene Stadt ohne Mauer.' : 'Kein freies eigenes Feld im Umland.';
      out.push({ ...base, state: w || 'Feld wählen', tone: toneOf(w), onClick: w ? undefined : () => onPick({ kind: 'build', b }) });
    }
    // upgrades of buildings the house owns
    for (const b of BUILDING_KEYS.filter((k) => BUILDINGS[k].branch === br)) {
      const own = Object.keys(c.buildings).filter((k) => c.buildings[k] === b && buildingOwnerOf(c, k) === house && levelOf(c, k) < MAX_LEVEL);
      if (site && !own.includes(site)) continue;
      if (!own.length) continue;
      const cand = site ? [site] : own;
      const next = Math.min(...cand.map((k) => levelOf(c, k))) + 1;
      const ok = cand.filter((k) => !why({ kind: 'upgrade', hex: k }));
      const w = ok.length ? '' : why({ kind: 'upgrade', hex: cand[0] });
      const cost = upgradeCost(b, next - 1);
      const pi = draft.findIndex((o) => o.kind === 'upgrade' && cand.includes(o.hex));
      if (!ok.length && pi >= 0) {
        out.push({ key: `u${b}`, title: `${BUILDING_ICON[b]} ${BUILDINGS[b].n} ${ROMAN[next]}`, sub: `Ausbau · ${cost} Gold · 1 Befehl`, effect: levelEffect(b, next), state: 'geplant · zurücknehmen', tone: 'plain', onClick: () => remove(pi), planned: pi });
        continue;
      }
      out.push({
        key: `u${b}`, title: `${BUILDING_ICON[b]} ${BUILDINGS[b].n} ${ROMAN[next]}`, sub: `Ausbau · ${cost} Gold · 1 Befehl`, effect: levelEffect(b, next),
        state: w || (site ? `hier ausbauen` : `${ok.length} ausbaubar`), tone: toneOf(w),
        onClick: w ? undefined : site ? () => add({ kind: 'upgrade', hex: site }) : ok.length === 1 ? () => add({ kind: 'upgrade', hex: ok[0] }) : () => onPick({ kind: 'upgrade', b }),
      });
    }
    return out;
  };

  const avail = (br: Branch) => cardsFor(br).filter((x) => x.onClick && x.planned === undefined).length;
  const cards = tab ? cardsFor(tab) : [];
  const gold = c.gold[house] - draft.reduce((g, o) => g + orderCost(c, house, o), 0);
  const free = ORDERS_PER_ROUND - orderCount(draft);
  const GLYPH: Record<Branch, string> = { wirtschaft: '⚖', militaer: '⚔', glaube: '✝', verteidigung: '▲' };
  const shell = {
    position: 'absolute' as const, left: `calc(50% + ${shift / 2}px)`, bottom: 16, transform: 'translateX(-50%)', zIndex: 4,
    background: 'color-mix(in srgb, var(--hull) 96%, transparent)', borderRadius: 14,
    boxShadow: 'inset 0 0 0 1px var(--rope), 0 12px 32px rgba(0,0,0,.4)',
  };

  if (!tab) {
    // collapsed: a small dock with the four areas
    return (
      <nav aria-label="Bauen und Forschen" className="row" style={{ ...shell, gap: 4, padding: 6, flexWrap: 'nowrap' }}>
        {BRANCH_KEYS.map((br) => {
          const n = avail(br);
          return (
            <button key={br} type="button" onClick={() => setTab(br)} style={{ height: 48, padding: '0 12px', border: 0, background: 'transparent', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--hull-2)', color: 'var(--brass)', display: 'grid', placeItems: 'center' }}>{GLYPH[br]}</span>
              {BRANCHES[br].n}
              {n > 0 && <span aria-label={`${n} möglich`} style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--brass)', color: '#1E1A15', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{n}</span>}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <section aria-label="Bauen und Forschen" style={{ ...shell, width: 'min(780px, calc(100% - 32px))', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
        <div className="stack" style={{ gap: 0, flex: 1, minWidth: 0 }}>
          <b style={{ fontFamily: 'var(--display)', fontSize: 17 }}>{site ? `Bauen bei ${hexName(site)}` : 'Bauen und Forschen'}</b>
          <span className="cmp-meta">{site ? <>{CITY_HEX[site] ? 'Stadtfeld' : 'Eigenes Feld'} · nur, was hier geht <button type="button" className="ghost" style={{ padding: '0 6px', fontSize: 12 }} onClick={onClearSite}>alle Felder</button></> : 'Karte wählen, dann ein leuchtendes Feld antippen.'}</span>
        </div>
        <span className="cmp-meta" style={{ whiteSpace: 'nowrap' }}>{gold} Gold · {free === 1 ? '1 Befehl' : `${free} Befehle`} frei</span>
        <button type="button" className="icon-btn" aria-label="Bauen schließen" onClick={() => setTab(null)}>×</button>
      </div>
      <div className="seg" role="tablist" aria-label="Bereich" style={{ alignSelf: 'flex-start' }}>
        {BRANCH_KEYS.map((br) => (
          <button key={br} type="button" role="tab" aria-selected={tab === br} onClick={() => setTab(br)}>
            {BRANCHES[br].n}{researchOf(c, house, br) > 0 ? ` ${ROMAN[researchOf(c, house, br)]}` : ''}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
        {cards.map((x) => (
          <button key={x.key} type="button" onClick={x.onClick} aria-disabled={!x.onClick} title={x.effect}
            style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 5, padding: 12, minWidth: 0, borderRadius: 10, border: 0,
              background: 'var(--hull-2)', boxShadow: `inset 0 0 0 1px ${x.key === 'r' ? 'var(--brass)' : 'var(--rope)'}`, cursor: x.onClick ? 'pointer' : 'default', opacity: x.onClick || x.planned !== undefined ? 1 : 0.78 }}>
            <b style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</b>
            <span className="cmp-meta" style={{ fontSize: 12.5 }}>{x.sub}</span>
            <span style={{ fontSize: 13, lineHeight: 1.35 }}>{x.effect}</span>
            <span style={{ alignSelf: 'flex-start', height: 22, padding: '0 9px', borderRadius: 11, display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: TONE[x.tone].bg, color: TONE[x.tone].fg }}>{x.state}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
