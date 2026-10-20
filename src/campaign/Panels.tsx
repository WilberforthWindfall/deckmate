import type { ReactNode } from 'react';
import {
  AGENT_BONUS, BRANCHES, BUILDINGS, COST, MAX_LEVEL, RESEARCH_COST, ROMAN, SPEC_NAME, UMLAND, agentBonus, buildingActive, buildingFor, buildingOwnerOf, buildingsNear,
  hasNear, levelEffect, levelOf, orderProblem, recruitSize, researchOf, specSum, trainCost, upgradeCost,
  type Campaign, type CArmy, type Order, type SpecKey,
} from './engine.ts';
import { CITY_HEX, HOUSES, LAND, PROV, PROVINCES, cityHex, hexDist, hexLand, hexName, hexProv, stepCost, type HexKey, type House } from './map.ts';
import { BUILDING_ICON } from './CampaignMap.tsx';

const SPECS = Object.keys(SPEC_NAME) as SpecKey[];
export const specText = (a: CArmy) => {
  const parts = SPECS.filter((k) => a.spec[k]).map((k) => `${a.spec[k]} ${SPEC_NAME[k]}`);
  return parts.length ? parts.join(', ') : 'keine Spezialisten';
};

export function Badge({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'good' | 'bad' | 'gold'; title?: string }) {
  const bg = { plain: 'var(--hull-2)', good: 'color-mix(in srgb, var(--ok) 18%, var(--hull-2))', bad: 'color-mix(in srgb, var(--hit) 20%, var(--hull-2))', gold: 'color-mix(in srgb, var(--brass) 20%, var(--hull-2))' }[tone];
  const bd = { plain: 'var(--rope)', good: 'color-mix(in srgb, var(--ok) 55%, transparent)', bad: 'color-mix(in srgb, var(--hit) 60%, transparent)', gold: 'color-mix(in srgb, var(--brass) 60%, transparent)' }[tone];
  return <span title={title} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: bg, border: `1px solid ${bd}`, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Act({ why, onClick, label, sub }: { why: string; onClick: () => void; label: string; sub?: string }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <button type="button" className={why ? 'muted' : ''} title={why || undefined} onClick={onClick} style={{ textAlign: 'left' }}>{label}</button>
      {(why || sub) && <span className="rule" style={{ fontSize: 12 }}>{why || sub}</span>}
    </div>
  );
}

interface Common {
  c: Campaign; house: House; giving: boolean; draft: Order[];
  add: (o: Order) => void; remove: (i: number) => void; onBack: () => void;
}

/** Can this house build here at all (own field in a city's Umland)? */
export const canBuildAt = (c: Campaign, house: House, hex: HexKey) =>
  c.hexOwner[hex] === house && !c.buildings[hex] && PROVINCES.some((p) => p.city && c.hexOwner[cityHex(p.id)] === house && hexDist(hex, cityHex(p.id)) <= UMLAND);

export function CityPanel({ c, prov, house, giving, draft, add, remove, onBack, onBuild }: Common & { prov: string; onBuild: (site: HexKey | null) => void }) {
  const p = PROV[prov];
  const ch = cityHex(prov);
  const owner = c.hexOwner[ch] ?? null;
  const mine = giving && owner === house;
  const army = c.armies.find((a) => a.hex === ch);
  const why = (o: Order) => orderProblem(c, house, o, draft);
  const orderIndex = draft.findIndex((o) => (o.kind === 'recruit' || o.kind === 'train') && o.prov === prov);
  const near = buildingsNear(c, prov);
  const agents = c.agents.filter((a) => hexDist(a.hex, ch) <= UMLAND);
  return (
    <div role="region" aria-label={`Stadt ${p.n}`} className="stack" style={{ gap: 12 }}>
      <button type="button" className="ghost" onClick={onBack} style={{ alignSelf: 'flex-start', padding: '4px 8px' }}>‹ Übersicht</button>
      <div className="stack" style={{ gap: 0 }}>
        <span className="lbl">Stadt</span>
        <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontWeight: 600 }}>{p.capital ? '♛ ' : ''}{p.n}</h2>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="chip"><i style={{ background: owner ? HOUSES[owner].color : '#6E6A60' }} />{owner ? HOUSES[owner].n : 'unbeansprucht'}</span>
        <span className="rule">· {LAND[p.land].n}</span>
        {p.capital && <span className="rule">· Hauptstadt</span>}
      </div>
      <span className="rule">{army ? `Auf dem Stadtfeld: Heer von ${HOUSES[army.house].n} (${army.size} Figuren, ${specText(army)})` : 'Kein Heer auf dem Stadtfeld – wer es betritt, nimmt die Stadt ein.'}</span>

      {mine && orderIndex >= 0 && (
        <div className="card promo stack" style={{ gap: 6 }}>
          <span className="lbl">Stadtbefehl dieser Runde</span>
          <span>{describe(c, house, draft[orderIndex])}</span>
          <button type="button" onClick={() => remove(orderIndex)}>Befehl zurücknehmen</button>
        </div>
      )}

      {mine && orderIndex < 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="lbl">Truppen</span>
          <Act why={why({ kind: 'recruit', prov })} onClick={() => add({ kind: 'recruit', prov })}
            label={`${recruitSize(c, prov, house)} Figuren rekrutieren (${COST.recruit} Gold)`} sub="Die Rekruten stoßen nach dem Marsch zum Heer auf dem Stadtfeld oder bilden ein neues." />
          {SPECS.map((k) => {
            const cost = trainCost(c, prov, house, k);
            const b = buildingFor(k);
            const have = hasNear(c, prov, b, house);
            return (
              <div key={k} className="stack" style={{ gap: 4, padding: '8px 10px', border: '1px solid var(--rope)', borderRadius: 8 }}>
                <span className="row" style={{ justifyContent: 'space-between' }}><b>{SPEC_NAME[k]}</b><span className="rule" style={{ fontSize: 12 }}>{cost} Gold · braucht {BUILDINGS[b].n}</span></span>
                {have ? (
                  <span className="row" style={{ gap: 6 }}>
                    <button type="button" className={why({ kind: 'train', prov, spec: k }) ? 'muted' : ''} title={why({ kind: 'train', prov, spec: k }) || undefined} onClick={() => add({ kind: 'train', prov, spec: k })}>ins Heer</button>
                    <button type="button" className={why({ kind: 'train', prov, spec: k, alone: true }) ? 'muted' : ''} title={why({ kind: 'train', prov, spec: k, alone: true }) || undefined} onClick={() => add({ kind: 'train', prov, spec: k, alone: true })}>als Einzelgänger</button>
                  </span>
                ) : <span className="rule" style={{ fontSize: 12 }}>Keine aktive {BUILDINGS[b].n} im Umland.</span>}
                {have && why({ kind: 'train', prov, spec: k }) && <span className="rule" style={{ fontSize: 11 }}>ins Heer: {why({ kind: 'train', prov, spec: k })}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="stack" style={{ gap: 6 }}>
        <span className="lbl">Umland (bis {UMLAND} Felder)</span>
        {!near.length && <span className="rule">Noch keine Gebäude im Umland.</span>}
        {near.map((x) => (
          <div key={x.hex} className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <span style={{ width: 22, textAlign: 'center', fontSize: 15 }}>{BUILDING_ICON[x.b]}</span>
            <span className="stack" style={{ gap: 1, flex: 1 }}>
              <span>{BUILDINGS[x.b].n}{x.level > 1 ? ` ${ROMAN[x.level]}` : ''} <span className="rule" style={{ fontSize: 12 }}>· {LAND[hexLand(x.hex)].n}{CITY_HEX[x.hex] ? ', Stadtfeld' : ''}</span></span>
              <span className="row" style={{ gap: 4 }}>
                {x.owner && <Badge>{HOUSES[x.owner].n}</Badge>}
                {x.active ? <Badge tone="good">aktiv</Badge> : <Badge tone="bad" title="Ein feindliches Heer steht auf dem Feld">ruht</Badge>}
              </span>
            </span>
          </div>
        ))}
        {agents.length > 0 && <span className="lbl" style={{ marginTop: 4 }}>Einzelgänger im Umland</span>}
        {agents.map((g) => {
          const b = agentBonus(c, g);
          return <span key={g.id} className="rule" style={{ fontSize: 12 }}>{SPEC_NAME[g.spec]} ({HOUSES[g.house].n}) · {b ? b.text : 'ohne Bonus – stell ihn auf ein passendes Gebäude'}</span>;
        })}
      </div>

      {mine && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="lbl">Bauen</span>
          <span className="rule" style={{ fontSize: 12 }}>Gebäude stehen auf eigenen Feldern im Umland, die Stadtmauer auf dem Stadtfeld. Gebaut und geforscht wird in der Leiste unten.</span>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" onClick={() => onBuild(null)}>Bauleiste öffnen</button>
            <button type="button" onClick={() => onBuild(ch)}>Stadtfeld: Mauer …</button>
          </span>
        </div>
      )}
    </div>
  );
}

export function HexPanel({ c, hex, house, giving, onBack, onCity, onBuild }: Common & { hex: HexKey; onCity: (prov: string) => void; onBuild: (site: HexKey) => void }) {
  const prov = hexProv(hex)!;
  const land = LAND[hexLand(hex)];
  const owner = c.hexOwner[hex] ?? null;
  const b = c.buildings[hex];
  const army = c.armies.find((a) => a.hex === hex);
  const agents = c.agents.filter((a) => a.hex === hex);
  const traders = c.traders.filter((t) => t.hex === hex);
  const cityNear = PROVINCES.filter((p) => p.city && hexDist(hex, cityHex(p.id)) <= UMLAND);
  return (
    <div role="region" aria-label={`Feld ${hexName(hex)}`} className="stack" style={{ gap: 12 }}>
      <button type="button" className="ghost" onClick={onBack} style={{ alignSelf: 'flex-start', padding: '4px 8px' }}>‹ Übersicht</button>
      <div className="stack" style={{ gap: 0 }}>
        <span className="lbl">Feld</span>
        <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontWeight: 600 }}>{PROV[prov].n}</h2>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="chip"><i style={{ background: owner ? HOUSES[owner].color : '#6E6A60' }} />{owner ? HOUSES[owner].n : 'frei'}</span>
        <span className="rule">· {land.n}</span>
      </div>
      <span className="rule" style={{ fontSize: 12 }}>
        Bewegung {stepCost(hex)} {stepCost(hex) === 1 ? 'Punkt' : 'Punkte'} · Verteidigung {land.defense > 1 ? `+${Math.round((land.defense - 1) * 100)} %` : 'normal'} · Fourage +{land.forage}{hexLand(hex) === 'S' ? ' · Fieber: −1 Figur pro Runde' : ''}
      </span>
      {cityNear.length > 0 && (
        <span className="rule" style={{ fontSize: 12 }}>Umland von {cityNear.map((p, i) => <span key={p.id}>{i ? ', ' : ''}<button type="button" className="ghost" style={{ padding: '0 4px' }} onClick={() => onCity(p.id)}>{p.n}</button></span>)}</span>
      )}

      {b && (
        <div className="card stack" style={{ gap: 4, padding: 10 }}>
          <span className="row" style={{ justifyContent: 'space-between' }}>
            <b>{BUILDING_ICON[b]} {BUILDINGS[b].n} {ROMAN[levelOf(c, hex)]}</b>
            {buildingActive(c, hex) ? <Badge tone="good">aktiv</Badge> : <Badge tone="bad">ruht</Badge>}
          </span>
          <span className="rule" style={{ fontSize: 12 }}>{levelEffect(b, levelOf(c, hex))}</span>
          {levelOf(c, hex) < MAX_LEVEL && (
            <span className="rule" style={{ fontSize: 12 }}>
              Stufe {ROMAN[levelOf(c, hex) + 1]} ({upgradeCost(b, levelOf(c, hex))} Gold): {levelEffect(b, levelOf(c, hex) + 1)}
              {buildingOwnerOf(c, hex) && researchOf(c, buildingOwnerOf(c, hex)!, BUILDINGS[b].branch) < levelOf(c, hex) ? ` · braucht Forschung „${BRANCHES[BUILDINGS[b].branch].research[levelOf(c, hex) - 1]}“` : ''}
            </span>
          )}
          <span className="rule" style={{ fontSize: 12 }}>Gehört {buildingOwnerOf(c, hex) ? HOUSES[buildingOwnerOf(c, hex)!].n : 'niemandem'}.{!buildingActive(c, hex) ? ' Es ruht: Ein feindliches Heer steht auf dem Feld oder hält es. Zieht es weiter, ist das Gebäude erobert.' : ''}</span>
          {SPECS.filter((k) => AGENT_BONUS[k][b]).map((k) => <span key={k} className="rule" style={{ fontSize: 12 }}>Mit {SPEC_NAME[k]}: {AGENT_BONUS[k][b]!.text}</span>)}
        </div>
      )}

      <div className="stack" style={{ gap: 4 }}>
        <span className="lbl">Hier unterwegs</span>
        {!army && !agents.length && !traders.length && <span className="rule">Niemand.</span>}
        {army && <span>{HOUSES[army.house].n}: Heer mit {army.size} Figuren{army.house === house ? ` (${specText(army)})` : specSum(army.spec) ? `, ${specSum(army.spec)} Spezialisten` : ''}</span>}
        {agents.map((g) => <span key={g.id}>{SPEC_NAME[g.spec]} von {HOUSES[g.house].n}{agentBonus(c, g) ? ` · ${agentBonus(c, g)!.text}` : ''}</span>)}
        {traders.map((t) => <span key={t.id}>Händler von {HOUSES[t.house].n} nach {PROV[CITY_HEX[t.to]].n}, bringt {t.gold} Gold</span>)}
      </div>

      {giving && (canBuildAt(c, house, hex) || (b && buildingOwnerOf(c, hex) === house)) && (
        <button type="button" style={{ alignSelf: 'flex-start' }} onClick={() => onBuild(hex)}>{b ? 'Ausbauen …' : 'Hier bauen …'}</button>
      )}
    </div>
  );
}

/** One line per order for the order list. */
export function describe(c: Campaign, house: House, o: Order): string {
  if (o.kind === 'move') { const a = c.armies.find((x) => x.id === o.army)!; return `Heer ${hexName(a.hex)} (${a.size}) zieht ${o.path.length} ${o.path.length === 1 ? 'Feld' : 'Felder'} nach ${hexName(o.path[o.path.length - 1])}`; }
  if (o.kind === 'support') { const a = c.armies.find((x) => x.id === o.army)!; return `Heer ${hexName(a.hex)} unterstützt ${hexName(o.target)}`; }
  if (o.kind === 'forage') { const a = c.armies.find((x) => x.id === o.army)!; return `Heer ${hexName(a.hex)} fouragiert (+${LAND[hexLand(a.hex)].forage})`; }
  if (o.kind === 'agent') { const g = c.agents.find((x) => x.id === o.agent)!; return `${SPEC_NAME[g.spec]} zieht nach ${hexName(o.path[o.path.length - 1])}`; }
  if (o.kind === 'recruit') return `${PROV[o.prov].n}: Figuren rekrutieren (${COST.recruit} Gold)`;
  if (o.kind === 'build') return `${BUILDINGS[o.b].n} bei ${hexName(o.hex)} (${BUILDINGS[o.b].cost} Gold)`;
  if (o.kind === 'upgrade') { const b = c.buildings[o.hex]; const l = levelOf(c, o.hex); return `${BUILDINGS[b].n} bei ${hexName(o.hex)} auf Stufe ${ROMAN[l + 1]} (${upgradeCost(b, l)} Gold)`; }
  if (o.kind === 'research') { const l = researchOf(c, house, o.branch); return `Forschung: ${BRANCHES[o.branch].research[l]} (${RESEARCH_COST[l]} Gold, ohne Befehl)`; }
  return `${PROV[o.prov].n}: ${SPEC_NAME[o.spec]} ${o.alone ? 'als Einzelgänger ' : ''}ausbilden (${trainCost(c, o.prov, house, o.spec)} Gold)`;
}
