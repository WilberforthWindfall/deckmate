import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import GameView from '../components/GameView.tsx';
import { act, type Action } from '../game/actions.ts';
import { battleResult } from '../game/battle.ts';
import type { GameState } from '../game/rules.ts';
import { HelpButton } from '../campaign/Help.tsx';
import { FeedbackForm } from '../components/Feedback.tsx';
import CampaignMap from '../campaign/CampaignMap.tsx';
import { explain, num, type Explanation } from '../campaign/explain.ts';
import {
  BUILDINGS, BUILDING_KEYS, COST, ORDERS_PER_ROUND, SPEC_NAME, OTHER, applyBattle, buildingFor, hasBuilding, orderCost, recruitSize, armyAt, armyById, autoBattle, battleGame, newCampaign, movePreview, orderProblem, score, sealOrders,
  type CArmy, type Campaign as CampaignState, type Order, type SpecKey, type Tone,
} from '../campaign/engine.ts';
import { ADJ, HOUSES, LAND, PROV, PROVINCES, provCenter, type House } from '../campaign/map.ts';

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

export default function Campaign() {
  const [c, setC] = useState<CampaignState>(load);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Order[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [armySel, setArmySel] = useState<string | null>(null);
  const [mode, setMode] = useState<'move' | 'support'>('move');
  const [city, setCity] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [battle, setBattle] = useState<{ id: string; st: GameState } | null>(null);
  /**
   * Reveal after both houses sealed: all orders as arrows, then every army sets out (those that turn back stop halfway),
   * then they settle where they end up, then the conflicts are explained one by one.
   */
  const [show, setShow] = useState<null | 'orders' | 'advance' | 'settle' | 'conflicts'>(null);
  /** Index of the conflict whose explanation card is open. */
  const [conf, setConf] = useState<number | null>(null);
  const [cardPos, setCardPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const [banner, setBanner] = useState<number | null>(null);
  const shownRound = useRef(0);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => save(c), [c]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setArmySel(null); setCity(null); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  useEffect(() => { if (c.reveal && show === null) setShow('orders'); }, [c.reveal, show]);
  const finishReveal = () => { setShow(null); setConf(null); setC((p) => ({ ...p, reveal: null })); };
  useEffect(() => {
    if (show === 'orders') { const t = setTimeout(() => setShow('advance'), 3500); return () => clearTimeout(t); }
    if (show === 'advance') { const t = setTimeout(() => setShow('settle'), 1000); return () => clearTimeout(t); }
    if (show === 'settle') {
      const t = setTimeout(() => { if (c.conflicts?.length) { setConf(0); setShow('conflicts'); } else finishReveal(); }, 1100);
      return () => clearTimeout(t);
    }
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!show && !c.reveal && c.phase === 'orders' && !ready && shownRound.current !== c.round) { shownRound.current = c.round; setBanner(c.round); }
  }, [show, c.reveal, c.phase, c.round, ready]);
  const explained: Explanation[] = (c.conflicts ?? []).map(explain);
  const card = conf !== null ? explained[conf] ?? null : null;
  useLayoutEffect(() => {
    const place = () => {
      const svg = svgRef.current, box = mapBox.current;
      if (!card || !svg || !box) { setCardPos(null); return; }
      const m = svg.getScreenCTM();
      if (!m) return;
      const [x, y] = provCenter(card.prov);
      const pt = new DOMPoint(x, y).matrixTransform(m);
      const r = box.getBoundingClientRect();
      setCardPos({ x: pt.x - r.left, y: pt.y - r.top, w: r.width, h: r.height });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [card?.prov, city]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (banner !== null) { const t = setTimeout(() => setBanner(null), 2600); return () => clearTimeout(t); } }, [banner]);

  const h = c.current;
  const giving = c.phase === 'orders' && ready && !show;
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const why = (o: Order) => orderProblem(c, h, o, draft);
  function add(o: Order) {
    const w = why(o);
    if (w) { flash(w); return; }
    setDraft([...draft, o]); setArmySel(null); setMode('move');
  }
  function openCity(id: string) { setArmySel(null); setCity(id); }

  const orderOf = (armyId: string) => draft.findIndex((o) => 'army' in o && o.army === armyId);
  const selArmy = armySel ? armyById(c, armySel) : null;
  const selOrder = selArmy ? orderOf(selArmy.id) : -1;
  const targeting = !!(giving && selArmy && selArmy.house === h && selOrder < 0 && draft.length < ORDERS_PER_ROUND);
  const targets = targeting ? ADJ[selArmy!.prov] : [];

  function onArmy(id: string) {
    const a = armyById(c, id);
    if (!a) return;
    if (targeting && a.id !== selArmy!.id && targets.includes(a.prov)) { onProvince(a.prov); return; }
    setCity(null); setSel(a.prov);
    if (!giving || a.house !== h) { setArmySel(null); return; }
    if (armySel === id) { setArmySel(null); return; }
    setArmySel(id); setMode('move');
  }

  function onProvince(id: string) {
    setSel(id);
    if (targeting && targets.includes(id)) {
      add(mode === 'move' ? { kind: 'move', army: selArmy!.id, to: id } : { kind: 'support', army: selArmy!.id, target: id });
      return;
    }
    if (PROV[id].city) { openCity(id); return; }
    setCity(null);
    const a = armyAt(c, id);
    if (giving && a && a.house === h) { onArmy(a.id); return; }
    setArmySel(null);
  }

  function seal() {
    try {
      const next = sealOrders(c, h, draft, Math.random);
      setC(next); setDraft([]); setSel(null); setArmySel(null); setCity(null); setReady(false);
    } catch (e) { flash((e as Error).message); }
  }
  function restart() {
    if (!confirm('Kampagne neu beginnen? Der aktuelle Stand geht verloren.')) return;
    shownRound.current = 0;
    setC(newCampaign()); setDraft([]); setReady(false); setSel(null); setArmySel(null); setCity(null); setBattle(null); setShow(null); setConf(null);
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

  const cityOrder = (prov: string) => draft.findIndex((o) => (o.kind === 'recruit' || o.kind === 'train' || o.kind === 'build') && o.prov === prov);
  const goldLeft = c.gold[h] - draft.reduce((g, o) => g + orderCost(o), 0);
  const phaseText = show === 'conflicts' ? 'Konflikte der Runde' : show ? 'Befehle werden aufgedeckt' : c.phase === 'orders' ? (ready ? `${HOUSES[h].n} gibt Befehle` : 'Übergabe') : c.phase === 'battles' ? 'Schlachten' : 'Kampagne beendet';

  const labels: Record<string, { text: string; tone: Tone }> = {};
  if (targeting) for (const t of targets) labels[t] = mode === 'move' ? movePreview(c, h, selArmy!.id, t, draft) : { text: `+${String(selArmy!.size / 2).replace('.', ',')} Stärke`, tone: 'plain' };
  const idle = giving ? c.armies.filter((a) => a.house === h && !a.prov.startsWith('@') && orderOf(a.id) < 0) : [];

  // What the map shows: during the first reveal step the positions before the march and all orders of both houses.
  const before = show === 'orders' && c.reveal ? c.reveal : null;
  const mapC = before ? { ...c, round: before.round, armies: before.armies, owner: before.owner, gold: before.gold ?? c.gold, battles: [] } : c;
  const mapOrders = show === 'orders' && c.reveal ? [...c.reveal.orders.R, ...c.reveal.orders.K] : giving ? draft : [];
  const halfway: Record<string, [number, number]> = {};
  if (show === 'advance') for (const e of explained) for (const t of e.turnedBack) {
    const [x1, y1] = provCenter(t.from), [x2, y2] = provCenter(t.to);
    halfway[t.army] = [x1 + (x2 - x1) * 0.55, y1 + (y2 - y1) * 0.55];
  }

  const forage = selArmy ? LAND[PROV[selArmy.prov].land].forage : 0;
  const forageWhy = selArmy ? why({ kind: 'forage', army: selArmy.id }) : '';

  return (
    <div className="app">
      <div className="stage" ref={stage} style={{ background: '#0D2A33', display: 'flex', flexDirection: 'column' }}>
        <div role="banner" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: '10px 16px', background: 'var(--hull)', borderBottom: '1px solid var(--rope)', zIndex: 4,
        }}>
          <div className="row" style={{ gap: 10 }}>
            {(['R', 'K'] as House[]).map((x) => {
              const provs = PROVINCES.filter((p) => mapC.owner[p.id] === x);
              const hidden = giving && x !== h;
              const active = giving && x === h;
              return (
                <div key={x} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', borderRadius: 8,
                  background: 'var(--hull-2)', border: `1px solid ${active ? HOUSES[x].color : 'var(--rope)'}`,
                }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: HOUSES[x].color, boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${HOUSES[x].color} 35%, transparent)` : undefined }} />
                  <b style={{ fontFamily: 'var(--display)' }}>{HOUSES[x].n}</b>
                  <Stat label="Gold" value={hidden ? '?' : active ? `${goldLeft}/${mapC.gold[x]}` : mapC.gold[x]} title={active ? 'Verfügbar nach geplanten Befehlen / gesamt' : undefined} />
                  <Stat label="Provinzen" value={provs.length} />
                  <Stat label="Städte" value={provs.filter((p) => p.city).length} />
                  <Stat label="Punkte" value={score(mapC, x)} />
                </div>
              );
            })}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 17, color: 'var(--brass)' }}>Runde {mapC.round} von {c.maxRounds}</div>
              <div className="rule" style={{ fontSize: 12 }}>{phaseText}</div>
            </div>
            {giving && <Stat label="Befehle" value={`${draft.length}/${ORDERS_PER_ROUND}`} />}
          </div>
        </div>

        <div ref={mapBox} style={{ flex: 1, minHeight: 0, position: 'relative', paddingLeft: city ? 330 : 0, transition: 'padding-left .2s' }}>
          <CampaignMap c={mapC} selected={sel} targets={targets} orders={mapOrders} onProvince={(id) => onProvince(id)}
            onArmy={onArmy} selectedArmy={armySel} labels={labels} svgRef={svgRef}
            focus={card ? [card.prov, ...(card.prov2 ? [card.prov2] : [])] : undefined} posOverride={halfway} />

          {card && cardPos && conf !== null && (
            <ConflictCard e={card} index={conf} count={explained.length} pos={cardPos}
              onPrev={() => setConf(Math.max(0, conf - 1))}
              onNext={() => (conf + 1 < explained.length ? setConf(conf + 1) : show === 'conflicts' ? finishReveal() : setConf(null))}
              onClose={() => (show === 'conflicts' ? finishReveal() : setConf(null))}
              finalLabel={show === 'conflicts' ? (c.phase === 'battles' ? 'Zu den Schlachten' : 'Weiter') : 'Schließen'} />
          )}

          {giving && selArmy && selArmy.house === h && (
            <div role="dialog" aria-label={`Heer in ${PROV[selArmy.prov].n}`} className="card" style={{
              position: 'absolute', left: (city ? 330 : 0) + 16, right: 16, bottom: 16, margin: '0 auto', maxWidth: 660, zIndex: 5,
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--hull)', borderColor: 'var(--brass)',
              boxShadow: '0 10px 30px rgba(0,0,0,.4)',
            }}>
              <div className="stack" style={{ gap: 2, flex: '1 1 240px', minWidth: 0 }}>
                <b style={{ fontFamily: 'var(--display)' }}>Heer in {PROV[selArmy.prov].n} · {selArmy.size} Figuren</b>
                <span className="rule" style={{ fontSize: 12 }}>{specText(selArmy)}</span>
                <span style={{ fontSize: 13 }}>
                  {selOrder >= 0 ? `Befehl: ${describe(c, draft[selOrder])}`
                    : !targeting ? `Alle ${ORDERS_PER_ROUND} Befehle dieser Runde sind vergeben.`
                    : mode === 'move' ? 'Tippe eine leuchtende Nachbarprovinz an, um dorthin zu ziehen. Gegnerische Unterstützung ist geheim und nicht eingerechnet.'
                    : 'Welche Nachbarprovinz soll das Heer unterstützen? Es zählt mit halber Größe.'}
                </span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {selOrder >= 0 && <button type="button" onClick={() => setDraft(draft.filter((_, j) => j !== selOrder))}>Befehl zurücknehmen</button>}
                {targeting && (mode === 'move'
                  ? <button type="button" onClick={() => setMode('support')}>Unterstützen …</button>
                  : <button type="button" onClick={() => setMode('move')}>Ziehen …</button>)}
                {targeting && <button type="button" className={forageWhy ? 'muted' : ''} title={forageWhy || undefined} onClick={() => add({ kind: 'forage', army: selArmy.id })}>Fouragieren (+{forage})</button>}
                <button type="button" className="ghost" aria-label="Auswahl aufheben" onClick={() => setArmySel(null)}>×</button>
              </div>
            </div>
          )}

          {show && c.reveal && !(show === 'conflicts' && card) && (
            <div role="status" style={{
              position: 'absolute', top: 16, left: 0, right: 0, margin: '0 auto', width: 'max-content', maxWidth: 'calc(100% - 32px)', zIndex: 6,
              display: 'flex', gap: 14, alignItems: 'center', padding: '10px 18px', borderRadius: 10,
              background: 'color-mix(in srgb, var(--hull) 92%, transparent)', border: '1px solid var(--brass)', boxShadow: '0 10px 30px rgba(0,0,0,.4)',
            }}>
              <span style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--brass)' }}>Runde {c.reveal.round}</span>
              <span>{show === 'orders' ? 'Die Befehle beider Häuser werden aufgedeckt.' : show === 'conflicts' ? `${explained.length === 1 ? 'Ein Konflikt' : `${explained.length} Konflikte`} in dieser Runde.` : 'Die Heere ziehen …'}</span>
              {show === 'orders' && <button type="button" onClick={() => setShow('advance')}>Heere ziehen lassen</button>}
            </div>
          )}
        </div>

        {city && <CityPanel c={c} prov={city} house={h} giving={giving} draft={draft} why={why} add={add}
          orderIndex={cityOrder(city)} onRemove={(i) => setDraft(draft.filter((_, j) => j !== i))} onClose={() => setCity(null)} />}

        {msg && <div className="toast" role="alert" style={{ top: 76 }}>{msg}</div>}

        {banner !== null && (
          <div className="overlay round-banner" role="status" onClick={() => setBanner(null)} style={{ cursor: 'pointer', zIndex: 20 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, justifyContent: 'center', color: 'var(--brass)' }}>
                <span style={{ height: 1, width: 90, background: 'linear-gradient(90deg, transparent, var(--brass))' }} />
                <span style={{ fontSize: 14 }}>✦</span>
                <span style={{ height: 1, width: 90, background: 'linear-gradient(270deg, transparent, var(--brass))' }} />
              </div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 64, lineHeight: 1.1, color: '#F1E3BE', textShadow: '0 4px 24px rgba(0,0,0,.6)', margin: '6px 0' }}>Runde {banner}</div>
              <div className="rule" style={{ fontSize: 15, color: 'var(--parchment)' }}>
                von {c.maxRounds} · Ravensmoor {score(c, 'R')} : {score(c, 'K')} Kerrow
              </div>
            </div>
          </div>
        )}

        {c.phase === 'orders' && !ready && !show && banner === null && (
          <div className="overlay"><div className="dialog">
            <h2>Runde {c.round}: {HOUSES[h].n}</h2>
            <p>Gib das Gerät an <b>{HOUSES[h].n}</b>. {HOUSES[OTHER[h]].n} schaut bitte weg, die Befehle sind geheim.</p>
            {c.sealed[OTHER[h]] && <p>{HOUSES[OTHER[h]].n} hat seine Befehle schon versiegelt.</p>}
            <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="primary" onClick={() => setReady(true)}>Ich bin {HOUSES[h].n}</button></div>
          </div></div>
        )}
        {c.phase === 'over' && !show && (
          <div className="overlay" style={{ zIndex: 30 }}><div className="dialog" style={{ maxHeight: 'calc(100% - 32px)', overflowY: 'auto', width: 'min(520px, 100%)', maxWidth: 520 }}>
            <h2>{c.winner ? `${HOUSES[c.winner].n} gewinnt` : 'Unentschieden'}</h2>
            <p>{c.winReason}</p>
            <p>Punkte: Ravensmoor {score(c, 'R')} · Kerrow {score(c, 'K')}</p>
            <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="primary" onClick={() => { shownRound.current = 0; setC(newCampaign()); setReady(false); }}>Neue Kampagne</button></div>
            <div style={{ borderTop: '1px solid var(--rope)', marginTop: 16, paddingTop: 14, textAlign: 'left' }}>
              <h3 style={{ fontFamily: 'var(--display)', fontWeight: 500, margin: '0 0 8px' }}>Wie war die Kampagne?</h3>
              <FeedbackForm where="kampagne-ende" intro="Ein paar Sätze von dir helfen enorm: Was hat Spaß gemacht, was war zäh oder unklar, was fehlt?"
                context={{ Runde: c.round, Sieger: c.winner ? HOUSES[c.winner].n : 'Unentschieden', Punkte: `Ravensmoor ${score(c, 'R')} : ${score(c, 'K')} Kerrow`, Grund: c.winReason ?? '' }} />
            </div>
          </div></div>
        )}
      </div>

      <aside className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}><Link to="/">← Zur Lobby</Link><div className="row" style={{ gap: 10 }}><span className="rule">Kampagne · Prototyp</span><HelpButton /></div></div>

        {c.phase === 'battles' && !show && (
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
            {draft.length === 0 && <span className="rule">Tippe die Fahne eines Heeres an, um es zu befehligen, oder ein Stadtfeld für das Stadtmenü.</span>}
            {draft.map((o, i) => (
              <div key={i} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span>{describe(c, o)}</span>
                <button type="button" className="ghost" aria-label="Befehl entfernen" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {idle.length > 0 && draft.length < ORDERS_PER_ROUND && (
              <div className="stack" style={{ gap: 4, padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--brass) 10%, transparent)', border: '1px dashed var(--brass)' }}>
                <span style={{ fontSize: 13 }}>{idle.length === 1 ? '1 Heer hat' : `${idle.length} Heere haben`} noch keinen Befehl und {idle.length === 1 ? 'hält' : 'halten'} sonst die Stellung:</span>
                <div className="row" style={{ gap: 6 }}>
                  {idle.map((a) => <button key={a.id} type="button" onClick={() => onArmy(a.id)}>{PROV[a.prov].n} ({a.size})</button>)}
                </div>
              </div>
            )}
            <button type="button" className="primary" onClick={seal}>Befehle versiegeln</button>
          </div>
        )}

        {sel && !PROV[sel].city && (
          <div className="card stack" style={{ gap: 4 }}>
            <h2>{PROV[sel].n}</h2>
            <span className="rule">{LAND[PROV[sel].land].n} · {c.owner[sel] ? HOUSES[c.owner[sel]!].n : 'unbeansprucht'}</span>
            <span className="rule">{LAND[PROV[sel].land].note}</span>
            {armyAt(c, sel) && <span>Heer von {HOUSES[armyAt(c, sel)!.house].n}: {armyAt(c, sel)!.size} Figuren</span>}
          </div>
        )}

        {!show && explained.length > 0 && (
          <div className="card stack" style={{ gap: 6 }}>
            <div className="lbl">Konflikte der letzten Runde</div>
            {explained.map((e, i) => (
              <button key={i} type="button" onClick={() => setConf(i)} style={{ textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: e.winner ? HOUSES[e.winner].color : 'var(--muted)' }} />
                <span style={{ flex: 1 }}>{e.title}</span>
                {e.ratio && <span className="rule" style={{ fontSize: 12 }}>{e.ratio.split(' · ')[0]}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="card stack" style={{ gap: 4 }}>
          <div className="lbl">Bericht</div>
          {before ? <span className="rule">Die Befehle werden aufgedeckt …</span> : c.report.slice(-14).map((l, i) => <span key={i} className="rule">{l}</span>)}
        </div>
        <span className="rule" style={{ fontSize: 12 }}>Alle Begriffe und Regeln stehen im Feldbuch hinter dem goldenen ?.</span>
        <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={restart}>Kampagne neu beginnen</button>
      </aside>
    </div>
  );
}

function ConflictCard({ e, index, count, pos, onPrev, onNext, onClose, finalLabel }: {
  e: Explanation; index: number; count: number; pos: { x: number; y: number; w: number; h: number };
  onPrev: () => void; onNext: () => void; onClose: () => void; finalLabel: string;
}) {
  const W = 340;
  const right = pos.x + 60 + W < pos.w - 12;
  const left = right ? pos.x + 60 : Math.max(12, pos.x - 60 - W);
  const top = Math.max(12, Math.min(pos.y - 90, pos.h - 450));
  const last = index + 1 >= count;
  return (
    <div role="dialog" aria-label={e.title} className="card stack" style={{
      position: 'absolute', left, top, width: W, zIndex: 7, gap: 10, background: 'var(--hull)', borderColor: '#F3D27A',
      boxShadow: '0 14px 40px rgba(0,0,0,.5)',
    }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div className="stack" style={{ gap: 0 }}>
          <span className="lbl">Konflikt {index + 1} von {count}</span>
          <b style={{ fontFamily: 'var(--display)', fontSize: 18 }}>{e.title}</b>
        </div>
        <button type="button" className="ghost" aria-label="Schließen" onClick={onClose}>×</button>
      </div>
      {e.sides.map((s, i) => (
        <div key={i} className="stack" style={{ gap: 2, paddingLeft: 10, borderLeft: `4px solid ${HOUSES[s.house].color}`, opacity: e.winner && e.winner !== s.house ? 0.75 : 1 }}>
          <span style={{ fontSize: 13 }}>{s.label}{e.winner === s.house ? ' ✓' : ''}</span>
          <span className="rule" style={{ fontSize: 12 }}>{s.formula}</span>
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>Stärke {num(s.total)}</b>
        </div>
      ))}
      {e.ratio && <span className="chip" style={{ alignSelf: 'flex-start', fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'var(--hull-2)', border: '1px solid var(--rope)' }}>{e.ratio} · klarer Sieg ab 1,5-fach</span>}
      <p style={{ margin: 0, lineHeight: 1.45 }}>{e.result}</p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className={index === 0 ? 'ghost muted' : 'ghost'} disabled={index === 0} onClick={onPrev}>‹ Zurück</button>
        <button type="button" className="primary" onClick={onNext}>{last ? finalLabel : 'Nächster Konflikt ›'}</button>
      </div>
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
