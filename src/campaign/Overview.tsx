import { useState } from 'react';
import {
  BUILDINGS, GOAL_POINTS, RANKS, ROMAN, SPEC_NAME, agentBonus, goalProgress, goalText, rankOf, xpOn, buildingsNear, engagedIds, income, rangeOf, recruitSize, specSum, strength,
  type CArmy, type Campaign, type Order, type SpecKey,
} from './engine.ts';
import { CITY_HEX, HOUSES, LAND, PROV, PROVINCES, cityHex, hexLand, hexName, type House } from './map.ts';
import { Badge } from './Panels.tsx';
import { BUILDING_ICON } from './CampaignMap.tsx';

// Left-hand overview while nothing is selected: armies, agents, traders and cities of a house with their bonuses and states.

const SPECS = Object.keys(SPEC_NAME) as SpecKey[];
const pct = (x: number) => `+${Math.round((x - 1) * 100)} %`;
const num = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
const ORDER_TEXT: Record<string, string> = { move: 'zieht', support: 'unterstützt', forage: 'fouragiert', agent: 'zieht', recruit: 'rekrutiert', train: 'bildet aus', build: 'baut' };

export default function Overview({ c, house, giving, viewer, draft, onArmy, onAgent, onCity }: {
  c: Campaign; house: House; giving: boolean; draft: Order[];
  /** Whose secrets (goal) may be shown on this screen. */
  viewer: House | null;
  onArmy: (id: string) => void; onAgent: (id: string) => void; onCity: (prov: string) => void;
}) {
  const [tab, setTab] = useState<House | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const t = tab ?? house;
  const own = giving && t === house;
  const engaged = engagedIds(c);
  const armies = c.armies.filter((a) => a.house === t);
  const agents = c.agents.filter((a) => a.house === t);
  const traders = c.traders.filter((x) => x.house === t);
  const cities = PROVINCES.filter((p) => p.city && c.hexOwner[cityHex(p.id)] === t);
  const free = PROVINCES.filter((p) => p.city && !c.hexOwner[cityHex(p.id)]);
  const orderFor = (id: string) => (own ? draft.find((o) => ('army' in o && o.army === id) || (o.kind === 'agent' && o.agent === id)) : undefined);
  const inc = income(c, t);
  const fields = Object.values(c.hexOwner).filter((x) => x === t).length;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 0 }}>
        <span className="lbl">Lage</span>
        <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontWeight: 600 }}>Übersicht</h2>
      </div>
      <div role="tablist" className="row" style={{ gap: 0 }}>
        {(['R', 'K'] as House[]).map((x, i) => (
          <button key={x} role="tab" aria-selected={t === x} type="button" className={t === x ? 'on' : ''} onClick={() => setTab(x)}
            style={{ flex: 1, borderRadius: i ? '0 6px 6px 0' : '6px 0 0 6px', marginLeft: i ? -1 : 0, display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: HOUSES[x].color }} />{HOUSES[x].n}{x === viewer ? ' (du)' : ''}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <Badge tone="gold" title={`Am Rundenende: ${inc.provinces} Provinzen, Städte +${inc.cities}, Märkte +${inc.markets}, Kollekte +${inc.agents}; Händler bringen extra`}>Einkommen +{inc.total} Gold</Badge>
        <Badge>{fields} Felder</Badge>
        <Badge>{cities.length} Städte</Badge>
      </div>
      {c.goals && (
        t === viewer || c.phase === 'over' ? (() => {
          const g = c.goals[t], [have, need] = goalProgress(c, t, g);
          return (
            <div className="card stack" style={{ gap: 4, padding: '8px 10px', borderColor: 'var(--brass)', borderStyle: 'dashed' }}>
              <span className="row" style={{ justifyContent: 'space-between' }}><span className="lbl">Geheimes Ziel</span><Badge tone={have >= need ? 'good' : 'gold'}>{have}/{need}</Badge></span>
              <span style={{ fontSize: 13 }}>{goalText(g)}</span>
              <span className="rule" style={{ fontSize: 11.5 }}>Zählt am Ende +{GOAL_POINTS} Punkte. {HOUSES[t === 'R' ? 'K' : 'R'].n} sieht es nicht.</span>
            </div>
          );
        })() : <span className="rule" style={{ fontSize: 12 }}>Geheimes Ziel: verdeckt</span>
      )}

      <section className="stack" style={{ gap: 6 }}>
        <span className="lbl">Heere</span>
        {armies.length === 0 && <span className="rule">Keine Heere.</span>}
        {armies.map((a) => <ArmyRow key={a.id} c={c} a={a} own={own} hidden={t !== house && c.phase !== 'over'} engaged={engaged.has(a.id)} order={orderFor(a.id)}
          open={hover === a.id} setOpen={(v) => setHover(v ? a.id : null)} onClick={() => onArmy(a.id)} />)}
      </section>

      {agents.length > 0 && (
        <section className="stack" style={{ gap: 6 }}>
          <span className="lbl">Einzelgänger</span>
          {agents.map((g) => {
            const b = agentBonus(c, g);
            const o = orderFor(g.id);
            return (
              <button key={g.id} type="button" onClick={() => onAgent(g.id)} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px' }}>
                <span className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><b>{SPEC_NAME[g.spec]}</b><span className="rule" style={{ fontSize: 12 }}>bei {hexName(g.hex)}</span></span>
                <span className="row" style={{ gap: 4 }}>
                  {b ? <Badge tone="good">{b.text}</Badge> : <Badge title="Auf einem passenden eigenen Gebäude gibt er einen Bonus">ohne Bonus</Badge>}
                  {o && <Badge tone="gold">{ORDER_TEXT[o.kind]}</Badge>}
                </span>
              </button>
            );
          })}
        </section>
      )}

      {traders.length > 0 && (
        <section className="stack" style={{ gap: 6 }}>
          <span className="lbl">Händler unterwegs</span>
          {traders.map((x) => <span key={x.id} className="rule" style={{ fontSize: 12 }}>bei {hexName(x.hex)} → {PROV[CITY_HEX[x.to]].n} · bringt {x.gold} Gold</span>)}
        </section>
      )}

      <section className="stack" style={{ gap: 6 }}>
        <span className="lbl">Städte</span>
        {cities.length === 0 && <span className="rule">Keine Städte.</span>}
        {cities.map((p) => <CityRow key={p.id} c={c} prov={p.id} onClick={() => onCity(p.id)} />)}
      </section>
      {free.length > 0 && (
        <section className="stack" style={{ gap: 6 }}>
          <span className="lbl">Freie Städte</span>
          {free.map((p) => <CityRow key={p.id} c={c} prov={p.id} onClick={() => onCity(p.id)} />)}
        </section>
      )}
    </div>
  );
}

function ArmyRow({ c, a, own, hidden, engaged, order, open, setOpen, onClick }: {
  c: Campaign; a: CArmy; own: boolean; hidden: boolean; engaged: boolean; order?: Order; open: boolean; setOpen: (v: boolean) => void; onClick: () => void;
}) {
  const def = strength(c, a, a.hex, [], true);
  const n = specSum(a.spec);
  const fever = hexLand(a.hex) === 'S';
  return (
    <div onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={onClick} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px' }}>
        <span style={{ minWidth: 38, textAlign: 'center', padding: '3px 0', borderRadius: 6, background: HOUSES[a.house].color, color: '#FFF8F2', fontWeight: 700 }}>⚑ {a.size}</span>
        <span className="stack" style={{ gap: 3, flex: 1, minWidth: 0 }}>
          <span>{hexName(a.hex)}</span>
          <span className="row" style={{ gap: 4 }}>
            <Badge title="Bewegungspunkte pro Runde; Gebirge und Sumpf kosten 2">Reichweite {rangeOf(a)}</Badge>
            {xpOn(c) && rankOf(a) > 0 && <Badge tone="gold" title={`Erfahrung ${a.xp ?? 0}: +${Math.round(RANKS[rankOf(a)].bonus * 100)} % Stärke${rankOf(a) >= 2 ? ', eine Extrakarte auf dem Brett' : ''}`}>{'★'.repeat(rankOf(a))} {RANKS[rankOf(a)].n}</Badge>}
            {n > 0 ? <Badge tone="gold">{n} Spezialist{n === 1 ? '' : 'en'}</Badge> : <Badge tone="bad" title="Ohne Spezialisten fehlt Disziplin: 1 Bewegungspunkt weniger">ohne Disziplin</Badge>}
            {engaged && <Badge tone="bad">wartet auf Schlacht</Badge>}
            {fever && <Badge tone="bad" title="Im Sumpf verliert das Heer am Rundenende 1 Figur">Fieber −1</Badge>}
            {def > a.size && <Badge tone="good" title="Verteidigung durch Gelände oder Stadtmauer">Verteidigung {pct(def / a.size)}</Badge>}
            {order && <Badge tone="gold">{ORDER_TEXT[order.kind]}</Badge>}
            {own && !order && !engaged && <Badge>ohne Befehl</Badge>}
          </span>
        </span>
      </button>
      {open && (
        <div role="tooltip" className="card stack" style={{ marginTop: 4, gap: 3, padding: '8px 10px', background: 'var(--hull)', borderColor: 'var(--brass)', fontSize: 13 }}>
          <b>Heer bei {hexName(a.hex)}</b>
          <span>{a.size} Figuren{xpOn(c) ? ` · ${RANKS[rankOf(a)].n} (Erfahrung ${a.xp ?? 0}${rankOf(a) < 2 ? `, nächster Rang ab ${RANKS[rankOf(a) + 1].xp}` : ''})` : ''}</span>
          {hidden
            ? <span className="rule">{n ? `${n} Spezialisten, Art unbekannt` : 'Keine Spezialisten erkennbar'}</span>
            : SPECS.filter((k) => a.spec[k]).length
              ? SPECS.filter((k) => a.spec[k]).map((k) => <span key={k} className="rule">{a.spec[k]} × {SPEC_NAME[k]}</span>)
              : <span className="rule">Keine Spezialisten</span>}
          {!hidden && n > 0 && <span className="rule">{a.size - n} einfache Soldaten</span>}
          <span className="rule" style={{ borderTop: '1px solid var(--rope)', paddingTop: 4, marginTop: 2 }}>
            Angriff {num(a.size)} · Verteidigung hier {num(def)} ({LAND[hexLand(a.hex)].n}{c.buildings[a.hex] === 'mauer' ? ', Mauer' : ''})
          </span>
          <span className="rule">Reichweite {rangeOf(a)} · Fourage hier +{LAND[hexLand(a.hex)].forage}</span>
        </div>
      )}
    </div>
  );
}

function CityRow({ c, prov, onClick }: { c: Campaign; prov: string; onClick: () => void }) {
  const p = PROV[prov];
  const ch = cityHex(prov);
  const owner = c.hexOwner[ch] ?? null;
  const near = buildingsNear(c, prov);
  const army = c.armies.find((a) => a.hex === ch);
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 10px' }}>
      <span className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <b style={{ fontFamily: 'var(--display)' }}>{p.capital ? '♛ ' : ''}{p.n}</b>
        <span className="rule" style={{ fontSize: 12 }}>{LAND[p.land].n}{owner ? ` · Rekruten ${recruitSize(c, prov, owner)}` : ''}</span>
      </span>
      <span className="row" style={{ gap: 4 }}>
        {p.capital && <Badge tone="gold" title="Wer das Stadtfeld betritt, gewinnt die Kampagne">Hauptstadt</Badge>}
        {near.length ? near.map((x) => (
          <Badge key={x.hex} tone={x.active ? 'plain' : 'bad'} title={`${BUILDINGS[x.b].n}${x.active ? '' : ' (ruht, feindliches Heer auf dem Feld)'}`}>{BUILDING_ICON[x.b]} {BUILDINGS[x.b].n}{x.level > 1 ? ` ${ROMAN[x.level]}` : ''}{x.active ? '' : ' (ruht)'}</Badge>
        )) : <span className="rule" style={{ fontSize: 12 }}>Keine Gebäude im Umland</span>}
      </span>
      <span className="row" style={{ gap: 4 }}>
        {army ? <Badge tone={army.house === owner ? 'good' : 'bad'}>{army.house === owner ? `Garnison ${army.size}` : `fremdes Heer (${army.size})`}</Badge> : owner && <Badge tone="bad" title="Wer das Stadtfeld betritt, nimmt die Stadt ein">ungeschützt</Badge>}
      </span>
    </button>
  );
}
