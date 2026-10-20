import {
  BRANCHES, BRANCH_KEYS, BUILDINGS, BUILDING_KEYS, MAX_LEVEL, ORDERS_PER_ROUND, RESEARCH_COST, ROMAN, buildingOwnerOf, levelEffect, levelOf,
  orderCount, orderProblem, researchOf, upgradeCost,
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

export default function BuildBar({ c, house, draft, add, remove, site, tab, setTab, onPick, onClearSite }: {
  c: Campaign; house: House; draft: Order[]; add: (o: Order) => void; remove: (i: number) => void;
  site: HexKey | null; tab: Branch | null; setTab: (t: Branch | null) => void; onPick: (p: BuildPick) => void; onClearSite: () => void;
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
      out.push({ ...base, state: w || `${sites.length} ${sites.length === 1 ? 'Platz' : 'Plätze'} frei`, tone: toneOf(w), onClick: w ? undefined : () => onPick({ kind: 'build', b }) });
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
  const researchPlanned = draft.find((o) => o.kind === 'research');
  const cards = tab ? cardsFor(tab) : [];

  return (
    <div role="region" aria-label="Bauen und Forschen" style={{
      position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 4, maxWidth: 900, margin: '0 auto',
      background: 'color-mix(in srgb, var(--hull) 94%, transparent)', border: '1px solid var(--brass)', borderRadius: 12,
      boxShadow: '0 10px 30px rgba(0,0,0,.4)', padding: '8px 10px',
    }}>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="lbl" style={{ marginRight: 6 }}>Bauen</span>
        {BRANCH_KEYS.map((br) => {
          const n = avail(br), l = researchOf(c, house, br);
          return (
            <button key={br} type="button" role="tab" aria-selected={tab === br} className={tab === br ? 'on' : ''} onClick={() => setTab(tab === br ? null : br)}
              style={{ padding: '5px 10px', display: 'flex', gap: 6, alignItems: 'center' }}>
              {BRANCHES[br].n}
              {l > 0 && <span className="rule" style={{ fontSize: 11 }}>{ROMAN[l]}</span>}
              {n > 0 && <span style={{ fontSize: 11, minWidth: 16, padding: '0 5px', borderRadius: 999, background: 'var(--brass)', color: '#1E1A15', fontWeight: 700 }}>{n}</span>}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        {site && (
          <span className="row" style={{ gap: 4, fontSize: 12 }}>
            <span className="rule">{CITY_HEX[site] ? 'Stadtfeld' : 'Feld'} {hexName(site)}</span>
            <button type="button" className="ghost" style={{ padding: '2px 6px' }} onClick={onClearSite} aria-label="Feldauswahl aufheben">×</button>
          </span>
        )}
        <span className="rule" style={{ fontSize: 12 }}>Befehle {orderCount(draft)}/{ORDERS_PER_ROUND} · Forschung {researchPlanned ? 'geplant' : 'frei'}</span>
        {tab && <button type="button" className="ghost" style={{ padding: '2px 8px' }} onClick={() => setTab(null)} aria-label="Leiste einklappen">▾</button>}
      </div>
      {tab && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8, marginTop: 8 }}>
          {cards.map((x) => (
            <button key={x.key} type="button" onClick={x.onClick} disabled={!x.onClick} title={x.effect}
              className={x.onClick ? '' : 'muted'}
              style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px', minWidth: 0, cursor: x.onClick ? 'pointer' : 'default', opacity: 1,
                border: x.key === 'r' ? '1px dashed var(--brass)' : undefined }}>
              <b style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</b>
              <span className="rule" style={{ fontSize: 11.5 }}>{x.sub}</span>
              <span style={{ fontSize: 12, lineHeight: 1.3, color: 'var(--parchment)', opacity: 0.85 }}>{x.effect}</span>
              <span style={{ alignSelf: 'flex-start', fontSize: 11, padding: '1px 7px', borderRadius: 999, background: TONE[x.tone].bg, color: TONE[x.tone].fg }}>{x.state}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
