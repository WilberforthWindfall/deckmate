import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import GameView from '../components/GameView.tsx';
import { act, type Action } from '../game/actions.ts';
import { battleResult } from '../game/battle.ts';
import type { GameState } from '../game/rules.ts';
import { HelpButton } from '../campaign/Help.tsx';
import CampaignMap from '../campaign/CampaignMap.tsx';
import {
  BUILDINGS, BUILDING_KEYS, COST, ORDERS_PER_ROUND, SPEC_NAME, OTHER, applyBattle, buildingFor, hasBuilding, orderCost, recruitSize, armyAt, armyById, autoBattle, battleGame, newCampaign, orderProblem, score, sealOrders,
  type CArmy, type Campaign as CampaignState, type Order, type SpecKey,
} from '../campaign/engine.ts';
import { ADJ, HOUSES, LAND, PROV, PROVINCES, type House } from '../campaign/map.ts';

// Campaign prototype on one device: houses give their orders in turn (the other player looks away), then all resolve at once.

const KEY = 'deckmate.kampagne.v1';
const load = (): CampaignState => {
  try { const s = localStorage.getItem(KEY); if (s) { const c = JSON.parse(s) as CampaignState; c.buildings ??= {}; return c; } } catch { /* ignore */ }
  return newCampaign();
};
const save = (c: CampaignState) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ } };

function describe(c: CampaignState, o: Order): string {
  if (o.kind === 'move') { const a = armyById(c, o.army)!; return `Heer ${PROV[a.prov].n} (${a.size}) zieht nach ${PROV[o.to].n}`; }
  if (o.kind === 'support') { const a = armyById(c, o.army)!; return `Heer ${PROV[a.prov].n} unterstützt ${PROV[o.target].n}`; }
  if (o.kind === 'forage') { const a = armyById(c, o.army)!; return `Heer ${PROV[a.prov].n} fouragiert (+${LAND[PROV[a.prov].land].forage})`; }
  if (o.kind === 'recruit') return `${PROV[o.prov].n}: Figuren rekrutieren (${COST.recruit} Gold)`;
  if (o.kind === 'build') return `${PROV[o.prov].n}: ${BUILDINGS[o.b].n} bauen (${BUILDINGS[o.b].cost} Gold)`;
  return `${PROV[o.prov].n}: ${SPEC_NAME[o.spec]} ausbilden (${COST.train} Gold)`;
}

const specText = (a: CArmy) => {
  const parts = (Object.keys(SPEC_NAME) as SpecKey[]).filter((k) => a.spec[k]).map((k) => `${a.spec[k]} ${SPEC_NAME[k]}`);
  return parts.length ? parts.join(', ') : 'keine Spezialisten';
};

type Menu = { prov: string; x: number; y: number; kind: 'choose' | 'army' };

export default function Campaign() {
  const [c, setC] = useState<CampaignState>(load);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Order[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [mode, setMode] = useState<null | { kind: 'move' | 'support'; army: string }>(null);
  const [city, setCity] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [battle, setBattle] = useState<{ id: string; st: GameState } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => save(c), [c]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(null); setMode(null); setCity(null); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const h = c.current;
  const giving = c.phase === 'orders' && ready;
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const targets = useMemo(() => {
    if (!mode) return [];
    const a = armyById(c, mode.army);
    return a ? ADJ[a.prov] : [];
  }, [mode, c]);

  const why = (o: Order) => orderProblem(c, h, o, draft);
  function add(o: Order) {
    const w = why(o);
    if (w) { flash(w); return; }
    setDraft([...draft, o]); setMode(null); setMenu(null);
  }
  function openCity(id: string) { setMenu(null); setCity(id); }

  function onProvince(id: string, at: { x: number; y: number }) {
    setSel(id);
    if (!giving) { setMenu(null); setCity(PROV[id].city ? id : null); return; }
    if (mode) {
      if (!targets.includes(id)) { flash('Das ist keine Nachbarprovinz.'); return; }
      add(mode.kind === 'move' ? { kind: 'move', army: mode.army, to: id } : { kind: 'support', army: mode.army, target: id });
      return;
    }
    const r = stage.current?.getBoundingClientRect();
    const pos = { x: at.x - (r?.left ?? 0), y: at.y - (r?.top ?? 0) };
    const a = armyAt(c, id);
    const ownArmy = !!a && a.house === h;
    const ownCity = !!PROV[id].city && c.owner[id] === h;
    if (ownArmy && ownCity) { setCity(null); setMenu({ prov: id, ...pos, kind: 'choose' }); }
    else if (ownArmy) { setCity(null); setMenu({ prov: id, ...pos, kind: 'army' }); }
    else if (PROV[id].city) openCity(id);
    else { setMenu(null); setCity(null); }
  }

  function seal() {
    try {
      const next = sealOrders(c, h, draft, Math.random);
      setC(next); setDraft([]); setSel(null); setMode(null); setMenu(null); setCity(null); setReady(false);
    } catch (e) { flash((e as Error).message); }
  }
  function restart() {
    if (!confirm('Kampagne neu beginnen? Der aktuelle Stand geht verloren.')) return;
    setC(newCampaign()); setDraft([]); setReady(false); setSel(null); setMode(null); setMenu(null); setBattle(null);
  }
  function takeBattle() {
    if (!battle) return;
    const r = battleResult(battle.st);
    if (!r) return;
    setC(applyBattle(c, battle.id, {
      attackerWon: r.winner === 'O', attacker: { size: r.attacker.size, spec: r.attacker.spec }, defender: { size: r.defender.size },
      retreat: false, how: 'auf dem Brett',
    }));
    setBattle(null);
  }

  if (battle) {
    return (
      <GameView
        state={battle.st}
        mySide={null}
        onAction={(a: Action) => setBattle({ ...battle, st: act(battle.st, a, Math.random) })}
        header={<div className="row" style={{ justifyContent: 'space-between' }}><button type="button" className="ghost" onClick={() => setBattle(null)}>← Zur Karte</button><span className="rule">Kampagne · Runde {c.round}</span></div>}
        overActions={<button type="button" className="primary" onClick={takeBattle}>Ergebnis auf die Karte übernehmen</button>}
        footer={battle.st.phase === 'play' ? (
          <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setBattle({ ...battle, st: act(battle.st, { type: 'resign', side: battle.st.turn }, Math.random) })}>
            {battle.st.turn === 'M' ? 'Rückzug (Mannschaft)' : 'Angriff abbrechen (Offiziere)'}
          </button>
        ) : undefined}
      />
    );
  }

  const orderOf = (armyId: string) => draft.findIndex((o) => 'army' in o && o.army === armyId);
  const cityOrder = (prov: string) => draft.findIndex((o) => (o.kind === 'recruit' || o.kind === 'train' || o.kind === 'build') && o.prov === prov);
  const goldLeft = c.gold[h] - draft.reduce((g, o) => g + orderCost(o), 0);
  const phaseText = c.phase === 'orders' ? (ready ? `${HOUSES[h].n} gibt Befehle` : 'Übergabe') : c.phase === 'battles' ? 'Schlachten' : 'Kampagne beendet';

  const menuArmy = menu ? armyAt(c, menu.prov) : null;
  const menuStyle = menu ? {
    position: 'absolute' as const, zIndex: 5, width: 280,
    left: Math.min(Math.max(8, menu.x + 14), (stage.current?.clientWidth ?? 900) - 290),
    top: Math.min(Math.max(64, menu.y - 20), (stage.current?.clientHeight ?? 700) - 260),
  } : undefined;

  const ActionBtn = ({ o, label }: { o: Order; label: string }) => {
    const w = why(o);
    return (
      <div className="stack" style={{ gap: 2 }}>
        <button type="button" className={w ? 'muted' : ''} title={w || undefined} onClick={() => add(o)}>{label}</button>
        {w && <span className="rule" style={{ fontSize: 12 }}>{w}</span>}
      </div>
    );
  };

  return (
    <div className="app">
      <div className="stage" ref={stage} style={{ background: '#0D2A33', display: 'flex', flexDirection: 'column' }}>
        <div role="banner" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: '10px 16px', background: 'var(--hull)', borderBottom: '1px solid var(--rope)', zIndex: 4,
        }}>
          <div className="row" style={{ gap: 10 }}>
            {(['R', 'K'] as House[]).map((x) => {
              const provs = PROVINCES.filter((p) => c.owner[p.id] === x);
              const hidden = giving && x !== h;
              const active = giving && x === h;
              return (
                <div key={x} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', borderRadius: 8,
                  background: 'var(--hull-2)', border: `1px solid ${active ? HOUSES[x].color : 'var(--rope)'}`,
                }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: HOUSES[x].color, boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${HOUSES[x].color} 35%, transparent)` : undefined }} />
                  <b style={{ fontFamily: 'var(--display)' }}>{HOUSES[x].n}</b>
                  <Stat label="Gold" value={hidden ? '?' : active ? `${goldLeft}/${c.gold[x]}` : c.gold[x]} title={active ? 'Verfügbar nach geplanten Befehlen / gesamt' : undefined} />
                  <Stat label="Provinzen" value={provs.length} />
                  <Stat label="Städte" value={provs.filter((p) => p.city).length} />
                  <Stat label="Punkte" value={score(c, x)} />
                </div>
              );
            })}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 17, color: 'var(--brass)' }}>Runde {c.round} von {c.maxRounds}</div>
              <div className="rule" style={{ fontSize: 12 }}>{phaseText}</div>
            </div>
            {giving && <Stat label="Befehle" value={`${draft.length}/${ORDERS_PER_ROUND}`} />}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative', paddingLeft: city ? 330 : 0, transition: 'padding-left .2s' }}>
          <CampaignMap c={c} selected={sel} targets={targets} orders={giving ? draft : []} onProvince={onProvince} />
        </div>

        {menu && menuStyle && (
          <div className="card stack" style={{ ...menuStyle, gap: 8, background: 'var(--hull)', borderColor: 'var(--brass)' }} role="dialog" aria-label={`Aktionen für ${PROV[menu.prov].n}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b style={{ fontFamily: 'var(--display)', fontSize: 16 }}>{PROV[menu.prov].n}</b>
              <button type="button" className="ghost" aria-label="Schließen" onClick={() => setMenu(null)}>×</button>
            </div>

            {menu.kind === 'choose' && menuArmy && <>
              <span className="rule">Hier stehen ein Heer und eine Stadt. Was möchtest du auswählen?</span>
              <button type="button" onClick={() => setMenu({ ...menu, kind: 'army' })}>Heer · {menuArmy.size} Figuren</button>
              <button type="button" onClick={() => openCity(menu.prov)}>Stadt {PROV[menu.prov].n}</button>
            </>}

            {menu.kind === 'army' && menuArmy && <>
              <span className="rule">Heer von {HOUSES[menuArmy.house].n}: {menuArmy.size} Figuren, {specText(menuArmy)}</span>
              {orderOf(menuArmy.id) >= 0 ? <>
                <span>Befehl: {describe(c, draft[orderOf(menuArmy.id)])}</span>
                <button type="button" onClick={() => { setDraft(draft.filter((_, j) => j !== orderOf(menuArmy.id))); }}>Befehl zurücknehmen</button>
              </> : <>
                <button type="button" className={draft.length >= ORDERS_PER_ROUND ? 'muted' : ''} onClick={() => { if (draft.length >= ORDERS_PER_ROUND) { flash(`Pro Runde sind ${ORDERS_PER_ROUND} Befehle erlaubt.`); return; } setMode({ kind: 'move', army: menuArmy.id }); setMenu(null); }}>Ziehen …</button>
                <button type="button" className={draft.length >= ORDERS_PER_ROUND ? 'muted' : ''} onClick={() => { if (draft.length >= ORDERS_PER_ROUND) { flash(`Pro Runde sind ${ORDERS_PER_ROUND} Befehle erlaubt.`); return; } setMode({ kind: 'support', army: menuArmy.id }); setMenu(null); }}>Unterstützen …</button>
                <ActionBtn o={{ kind: 'forage', army: menuArmy.id }} label={`Fouragieren (+${LAND[PROV[menu.prov].land].forage})`} />
                <span className="rule" style={{ fontSize: 12 }}>Ohne Befehl hält das Heer seine Stellung.</span>
              </>}
            </>}

          </div>
        )}

        {city && <CityPanel c={c} prov={city} house={h} giving={giving} draft={draft} why={why} add={add}
          orderIndex={cityOrder(city)} onRemove={(i) => setDraft(draft.filter((_, j) => j !== i))} onClose={() => setCity(null)} />}

        {msg && <div className="toast" role="alert" style={{ top: 76 }}>{msg}</div>}
        {mode && <div className="toast" role="status" style={{ top: 'auto', bottom: 24 }}>{mode.kind === 'move' ? 'Wohin soll das Heer ziehen?' : 'Welche Nachbarprovinz soll das Heer unterstützen?'} Tippe eine hellblaue Provinz an. <button type="button" className="ghost" onClick={() => setMode(null)}>Abbrechen</button></div>}
        {c.phase === 'orders' && !ready && (
          <div className="overlay"><div className="dialog">
            <h2>Runde {c.round}: {HOUSES[h].n}</h2>
            <p>Gib das Gerät an <b>{HOUSES[h].n}</b>. {HOUSES[OTHER[h]].n} schaut bitte weg, die Befehle sind geheim.</p>
            {c.sealed[OTHER[h]] && <p>{HOUSES[OTHER[h]].n} hat seine Befehle schon versiegelt.</p>}
            <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="primary" onClick={() => setReady(true)}>Ich bin {HOUSES[h].n}</button></div>
          </div></div>
        )}
        {c.phase === 'over' && (
          <div className="overlay"><div className="dialog">
            <h2>{c.winner ? `${HOUSES[c.winner].n} gewinnt` : 'Unentschieden'}</h2>
            <p>{c.winReason}</p>
            <p>Punkte: Ravensmoor {score(c, 'R')} · Kerrow {score(c, 'K')}</p>
            <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="primary" onClick={() => { setC(newCampaign()); setReady(false); }}>Neue Kampagne</button></div>
          </div></div>
        )}
      </div>

      <aside className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}><Link to="/">← Zur Lobby</Link><div className="row" style={{ gap: 10 }}><span className="rule">Kampagne · Prototyp</span><HelpButton /></div></div>

        {c.phase === 'battles' && (
          <div className="card promo stack" style={{ gap: 8 }}>
            <h2>Schlachten</h2>
            <div className="rule">Knappe Kämpfe werden auf dem Brett ausgetragen. Der Angreifer führt die Offiziere. Jede Unterstützung gibt eine Karte extra.</div>
            {c.battles.map((b) => {
              const att = armyById(c, b.attacker)!, def = armyById(c, b.defender)!;
              return (
                <div key={b.id} className="card stack" style={{ gap: 6 }}>
                  <b>Schlacht um {PROV[b.prov].n}</b>
                  <span className="rule">{HOUSES[att.house].n} ({att.size}, Stärke {b.attStrength}) greift {HOUSES[def.house].n} ({def.size}, Stärke {b.defStrength}) an · {LAND[PROV[b.prov].land].n}</span>
                  <div className="row">
                    <button type="button" className="primary" onClick={() => setBattle({ id: b.id, st: battleGame(c, b.id, Math.random) })}>Auf dem Brett austragen</button>
                    <button type="button" onClick={() => setC(autoBattle(c, b.id, Math.random))}>Auswürfeln</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {giving && (
          <div className="card stack" style={{ gap: 6 }}>
            <b>Befehle von {HOUSES[h].n}</b>
            {draft.length === 0 && <span className="rule">Tippe ein eigenes Heer oder eine eigene Stadt auf der Karte an. Heere ohne Befehl halten ihre Stellung.</span>}
            {draft.map((o, i) => (
              <div key={i} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span>{describe(c, o)}</span>
                <button type="button" className="ghost" aria-label="Befehl entfernen" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button type="button" className="primary" onClick={seal}>Befehle versiegeln</button>
          </div>
        )}

        {sel && (
          <div className="card stack" style={{ gap: 4 }}>
            <h2>{PROV[sel].n}</h2>
            <span className="rule">{LAND[PROV[sel].land].n}{PROV[sel].city ? ' · Stadt' : ''}{PROV[sel].capital ? ` · Hauptstadt von ${HOUSES[PROV[sel].capital!].n}` : ''} · {c.owner[sel] ? HOUSES[c.owner[sel]!].n : 'unbeansprucht'}</span>
            <span className="rule">{LAND[PROV[sel].land].note}</span>
            {armyAt(c, sel) && <span>Heer von {HOUSES[armyAt(c, sel)!.house].n}: {armyAt(c, sel)!.size} Figuren</span>}
          </div>
        )}

        <div className="card stack" style={{ gap: 4 }}>
          <div className="lbl">Bericht</div>
          {c.report.slice(-14).map((l, i) => <span key={i} className="rule">{l}</span>)}
        </div>
        <div className="card stack" style={{ gap: 4 }}>
          <div className="lbl">Regeln kurz</div>
          <span className="rule">Pro Runde {ORDERS_PER_ROUND} Befehle. Alle Befehle werden gleichzeitig ausgeführt. Stärke = Heer + halbe Größe unterstützender Heere, Verteidiger im Gebirge, auf Hügeln und im Wald stärker. Ab 1,5-facher Übermacht entscheidet sich ein Kampf von selbst, sonst kommt es zur Schlacht.</span>
          <span className="rule">Einkommen: 1 Gold je Provinz, 2 je Stadt, +2 je Markt. Städte bauen Gebäude (Stadt anklicken, Menü links): Kapelle, Gießerei, Kaserne und Offiziersmesse schalten Spezialisten frei, die Stadtmauer stärkt Verteidiger um 30 %. Sieg: gegnerische Hauptstadt erobern oder nach {c.maxRounds} Runden die meisten Punkte (Provinz 1, Stadt 3).</span>
        </div>
        <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={restart}>Kampagne neu beginnen</button>
      </aside>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string | number; title?: string }) {
  return (
    <div title={title} style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 34 }}>
      <span style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span>
      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </div>
  );
}

function CityPanel({ c, prov, house, giving, draft, why, add, orderIndex, onRemove, onClose }: {
  c: CampaignState; prov: string; house: House; giving: boolean; draft: Order[]; why: (o: Order) => string; add: (o: Order) => void;
  orderIndex: number; onRemove: (i: number) => void; onClose: () => void;
}) {
  const p = PROV[prov];
  const owner = c.owner[prov];
  const mine = giving && owner === house;
  const army = armyAt(c, prov);
  const Act = ({ o, label, sub }: { o: Order; label: string; sub?: string }) => {
    const w = why(o);
    return (
      <div className="stack" style={{ gap: 2 }}>
        <button type="button" className={w ? 'muted' : ''} title={w || undefined} onClick={() => add(o)} style={{ textAlign: 'left' }}>{label}</button>
        {(w || sub) && <span className="rule" style={{ fontSize: 12 }}>{w || sub}</span>}
      </div>
    );
  };
  return (
    <div role="dialog" aria-label={`Stadt ${p.n}`} className="stack" style={{
      position: 'absolute', left: 0, top: 58, bottom: 0, width: 330, zIndex: 6, overflowY: 'auto', gap: 12,
      padding: 16, background: 'var(--hull)', borderRight: '1px solid var(--brass)', boxShadow: '8px 0 24px rgba(0,0,0,.35)',
    }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 0 }}>
          <span className="lbl">Stadt</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontWeight: 600 }}>{p.n}</h2>
        </div>
        <button type="button" className="ghost" aria-label="Stadtmenü schließen" onClick={onClose}>×</button>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="chip"><i style={{ background: owner ? HOUSES[owner].color : '#6E6A60' }} />{owner ? HOUSES[owner].n : 'unbeansprucht'}</span>
        <span className="rule">· {LAND[p.land].n}</span>
        {p.capital && <span className="rule">· Hauptstadt</span>}
      </div>
      <span className="rule">{army ? `Heer von ${HOUSES[army.house].n}: ${army.size} Figuren` : 'Kein Heer in der Stadt.'}</span>

      {mine && orderIndex >= 0 && (
        <div className="card promo stack" style={{ gap: 6 }}>
          <span className="lbl">Befehl dieser Runde</span>
          <span>{describe(c, draft[orderIndex])}</span>
          <button type="button" onClick={() => onRemove(orderIndex)}>Befehl zurücknehmen</button>
        </div>
      )}
      {mine && orderIndex < 0 && <span className="rule">Pro Stadt und Runde ein Befehl: bauen, rekrutieren oder ausbilden. Jeder zählt zu deinen {ORDERS_PER_ROUND} Befehlen.</span>}

      <div className="stack" style={{ gap: 8 }}>
        <span className="lbl">Gebäude</span>
        {BUILDING_KEYS.map((b) => {
          const built = hasBuilding(c, prov, b);
          return (
            <div key={b} className="card stack" style={{ gap: 4, padding: 10, borderColor: built ? 'var(--ok)' : 'var(--rope)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{BUILDINGS[b].n}</b>
                <span className="rule">{built ? 'gebaut' : `${BUILDINGS[b].cost} Gold`}</span>
              </div>
              <span className="rule" style={{ fontSize: 12 }}>{BUILDINGS[b].effect}</span>
              {mine && !built && orderIndex < 0 && <Act o={{ kind: 'build', prov, b }} label={`${BUILDINGS[b].n} bauen`} />}
            </div>
          );
        })}
      </div>

      {mine && orderIndex < 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="lbl">Truppen</span>
          <Act o={{ kind: 'recruit', prov }} label={`${recruitSize(c, prov)} Figuren rekrutieren (${COST.recruit} Gold)`} sub="Die Rekruten stoßen nach dem Abmarsch zum Heer in der Stadt oder bilden ein neues." />
          {(Object.keys(SPEC_NAME) as SpecKey[]).map((k) => (
            <Act key={k} o={{ kind: 'train', prov, spec: k }} label={`${SPEC_NAME[k]} ausbilden (${COST.train} Gold)`}
              sub={hasBuilding(c, prov, buildingFor(k)) ? undefined : `braucht ${BUILDINGS[buildingFor(k)].n}`} />
          ))}
        </div>
      )}
    </div>
  );
}
