import { useState, type ReactNode } from 'react';
import {
  BUILDINGS, BUILDING_KEYS, SPEC_NAME, buildingFor, hasBuilding, incomeOf, recruitSize, strength,
  type CArmy, type Campaign, type Order, type SpecKey,
} from './engine.ts';
import { HOUSES, LAND, PROV, PROVINCES, type House } from './map.ts';

// Left-hand overview while nothing is selected: the armies and cities of a house with their bonuses and states.

const SPECS = Object.keys(SPEC_NAME) as SpecKey[];
const pct = (x: number) => `+${Math.round((x - 1) * 100)} %`;
const num = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
const ORDER_TEXT: Record<string, string> = { move: 'zieht', support: 'unterstützt', forage: 'fouragiert', recruit: 'rekrutiert', train: 'bildet aus', build: 'baut' };

function Badge({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'good' | 'bad' | 'gold'; title?: string }) {
  const bg = { plain: 'var(--hull-2)', good: 'color-mix(in srgb, var(--ok) 18%, var(--hull-2))', bad: 'color-mix(in srgb, var(--hit) 20%, var(--hull-2))', gold: 'color-mix(in srgb, var(--brass) 20%, var(--hull-2))' }[tone];
  const bd = { plain: 'var(--rope)', good: 'color-mix(in srgb, var(--ok) 55%, transparent)', bad: 'color-mix(in srgb, var(--hit) 60%, transparent)', gold: 'color-mix(in srgb, var(--brass) 60%, transparent)' }[tone];
  return <span title={title} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, background: bg, border: `1px solid ${bd}`, whiteSpace: 'nowrap' }}>{children}</span>;
}

export default function Overview({ c, house, giving, draft, onArmy, onCity }: {
  c: Campaign; house: House; giving: boolean; draft: Order[]; onArmy: (id: string) => void; onCity: (prov: string) => void;
}) {
  const [tab, setTab] = useState<House | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const t = tab ?? house;
  const own = giving && t === house;
  const armies = c.armies.filter((a) => a.house === t && !a.prov.startsWith('@'));
  const waiting = c.armies.filter((a) => a.house === t && a.prov.startsWith('@'));
  const cities = PROVINCES.filter((p) => p.city && c.owner[p.id] === t);
  const free = PROVINCES.filter((p) => p.city && !c.owner[p.id]);
  const orderFor = (a: CArmy) => (own ? draft.find((o) => 'army' in o && o.army === a.id) : undefined);
  const cityOrder = (prov: string) => (own ? draft.find((o) => (o.kind === 'recruit' || o.kind === 'train' || o.kind === 'build') && o.prov === prov) : undefined);
  const provs = PROVINCES.filter((p) => c.owner[p.id] === t);

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
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: HOUSES[x].color }} />{HOUSES[x].n}{x === house && giving ? ' (du)' : ''}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <Badge tone="gold" title="Gold am Ende der Runde: 1 je Provinz, +2 je Stadt, +2 je Markt">Einkommen +{incomeOf(c, t)} Gold</Badge>
        <Badge>{provs.length} Provinzen</Badge>
        <Badge>{cities.length} Städte</Badge>
      </div>

      <section className="stack" style={{ gap: 6 }}>
        <span className="lbl">Heere</span>
        {armies.length === 0 && waiting.length === 0 && <span className="rule">Keine Heere.</span>}
        {[...armies, ...waiting].map((a) => {
          const at = a.prov.startsWith('@') ? a.prov.slice(1) : a.prov;
          const p = PROV[at];
          const def = strength(c, a, at, [], true);
          const specN = SPECS.reduce((n, k) => n + a.spec[k], 0);
          const o = orderFor(a);
          const fever = p.land === 'S' && !a.prov.startsWith('@');
          const hidden = t !== house && c.phase !== 'over';
          return (
            <div key={a.id} style={{ position: 'relative' }} onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)}>
              <button type="button" onClick={() => onArmy(a.id)} onFocus={() => setHover(a.id)} onBlur={() => setHover(null)}
                style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px' }}>
                <span style={{ minWidth: 38, textAlign: 'center', padding: '3px 0', borderRadius: 6, background: HOUSES[a.house].color, color: '#FFF8F2', fontWeight: 700 }}>⚑ {a.size}</span>
                <span className="stack" style={{ gap: 3, flex: 1, minWidth: 0 }}>
                  <span>{a.prov.startsWith('@') ? `vor ${p.n}` : p.n}</span>
                  <span className="row" style={{ gap: 4 }}>
                    {specN > 0 && <Badge tone="gold">{specN} Spezialist{specN === 1 ? '' : 'en'}</Badge>}
                    {a.prov.startsWith('@') && <Badge tone="bad">wartet auf Schlacht</Badge>}
                    {fever && <Badge tone="bad" title="Im Sumpf verliert das Heer am Rundenende 1 Figur">Fieber −1</Badge>}
                    {!a.prov.startsWith('@') && def > a.size && <Badge tone="good" title="Verteidigung durch Gelände oder Stadtmauer">Verteidigung {pct(def / a.size)}</Badge>}
                    {o && <Badge tone="gold">{ORDER_TEXT[o.kind]}</Badge>}
                    {own && !o && !a.prov.startsWith('@') && <Badge>ohne Befehl</Badge>}
                  </span>
                </span>
              </button>
              {hover === a.id && (
                <div role="tooltip" className="card stack" style={{ marginTop: 4, gap: 3, padding: '8px 10px', background: 'var(--hull)', borderColor: 'var(--brass)', fontSize: 13 }}>
                  <b>Heer {a.prov.startsWith('@') ? `vor ${p.n}` : `in ${p.n}`}</b>
                  <span>{a.size} Figuren</span>
                  {hidden
                    ? <span className="rule">{specN ? `${specN} Spezialisten, Art unbekannt` : 'Keine Spezialisten erkennbar'}</span>
                    : SPECS.filter((k) => a.spec[k]).length
                      ? SPECS.filter((k) => a.spec[k]).map((k) => <span key={k} className="rule">{a.spec[k]} × {SPEC_NAME[k]}</span>)
                      : <span className="rule">Keine Spezialisten</span>}
                  {!hidden && specN > 0 && <span className="rule">{a.size - specN} einfache Soldaten</span>}
                  <span className="rule" style={{ borderTop: '1px solid var(--rope)', paddingTop: 4, marginTop: 2 }}>
                    Angriff {num(a.size)} · Verteidigung hier {num(def)} ({LAND[p.land].n}{hasBuilding(c, at, 'mauer') ? ', Mauer' : ''})
                  </span>
                  <span className="rule">Fourage hier: +{LAND[p.land].forage}</span>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="stack" style={{ gap: 6 }}>
        <span className="lbl">Städte</span>
        {cities.length === 0 && <span className="rule">Keine Städte.</span>}
        {cities.map((p) => <CityRow key={p.id} c={c} prov={p.id} order={cityOrder(p.id)} onClick={() => onCity(p.id)} />)}
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

function CityRow({ c, prov, order, onClick }: { c: Campaign; prov: string; order?: Order; onClick: () => void }) {
  const p = PROV[prov];
  const built = BUILDING_KEYS.filter((b) => hasBuilding(c, prov, b));
  const trainable = SPECS.filter((k) => hasBuilding(c, prov, buildingFor(k)));
  const army = c.armies.find((a) => a.prov === prov);
  const owner = c.owner[prov];
  const income = 3 + (hasBuilding(c, prov, 'markt') ? 2 : 0);
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 10px' }}>
      <span className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <b style={{ fontFamily: 'var(--display)' }}>{p.capital ? '♛ ' : ''}{p.n}</b>
        <span className="rule" style={{ fontSize: 12 }}>{LAND[p.land].n}{owner ? ` · +${income} Gold` : ''}</span>
      </span>
      <span className="row" style={{ gap: 4 }}>
        {p.capital && <Badge tone="gold" title="Wer sie erobert, gewinnt die Kampagne">Hauptstadt</Badge>}
        {built.length ? built.map((b) => <Badge key={b} title={BUILDINGS[b].effect}>{BUILDINGS[b].n}</Badge>) : <span className="rule" style={{ fontSize: 12 }}>Keine Gebäude</span>}
      </span>
      {(hasBuilding(c, prov, 'mauer') || hasBuilding(c, prov, 'kaserne') || hasBuilding(c, prov, 'markt') || trainable.length > 0) && (
        <span className="rule" style={{ fontSize: 12 }}>
          {[
            hasBuilding(c, prov, 'mauer') && 'Verteidiger +30 %',
            hasBuilding(c, prov, 'markt') && '+2 Gold durch Markt',
            `Rekruten ${recruitSize(c, prov)}`,
            trainable.length && `bildet aus: ${trainable.map((k) => SPEC_NAME[k]).join(', ')}`,
          ].filter(Boolean).join(' · ')}
        </span>
      )}
      <span className="row" style={{ gap: 4 }}>
        {army ? <Badge tone={army.house === owner ? 'good' : 'bad'}>{army.house === owner ? `Garnison ${army.size}` : `fremdes Heer (${army.size})`}</Badge> : owner && <Badge tone="bad" title="Ohne Heer kann jeder die Stadt kampflos besetzen">ungeschützt</Badge>}
        {order && <Badge tone="gold">Befehl: {ORDER_TEXT[order.kind]}</Badge>}
      </span>
    </button>
  );
}
