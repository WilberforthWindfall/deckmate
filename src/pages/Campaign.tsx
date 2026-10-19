import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import GameView from '../components/GameView.tsx';
import { act, type Action } from '../game/actions.ts';
import { battleResult } from '../game/battle.ts';
import type { GameState } from '../game/rules.ts';
import CampaignMap from '../campaign/CampaignMap.tsx';
import {
  COST, ORDERS_PER_ROUND, SPEC_NAME, OTHER, applyBattle, armyAt, armyById, autoBattle, battleGame, newCampaign, orderProblem, score, sealOrders,
  type Campaign as CampaignState, type Order, type SpecKey,
} from '../campaign/engine.ts';
import { ADJ, HOUSES, LAND, PROV, type House } from '../campaign/map.ts';

// Campaign prototype on one device: houses give their orders in turn (the other player looks away), then all resolve at once.

const KEY = 'deckmate.kampagne.v1';
const load = (): CampaignState => { try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch { /* ignore */ } return newCampaign(); };
const save = (c: CampaignState) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ } };

function describe(c: CampaignState, o: Order): string {
  if (o.kind === 'move') { const a = armyById(c, o.army)!; return `Heer ${PROV[a.prov].n} (${a.size}) zieht nach ${PROV[o.to].n}`; }
  if (o.kind === 'support') { const a = armyById(c, o.army)!; return `Heer ${PROV[a.prov].n} unterstützt ${PROV[o.target].n}`; }
  if (o.kind === 'forage') { const a = armyById(c, o.army)!; return `Heer ${PROV[a.prov].n} fouragiert (+${LAND[PROV[a.prov].land].forage})`; }
  if (o.kind === 'recruit') return `${PROV[o.prov].n}: 3 Figuren rekrutieren (${COST.recruit} Gold)`;
  return `${PROV[o.prov].n}: ${SPEC_NAME[o.spec]} ausbilden (${COST.train} Gold)`;
}

export default function Campaign() {
  const [c, setC] = useState<CampaignState>(load);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Order[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<null | { kind: 'move' | 'support'; army: string }>(null);
  const [spec, setSpec] = useState<SpecKey>('KAN');
  const [msg, setMsg] = useState('');
  const [battle, setBattle] = useState<{ id: string; st: GameState } | null>(null);

  useEffect(() => save(c), [c]);
  const h = c.current;
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const targets = useMemo(() => {
    if (!mode) return [];
    const a = armyById(c, mode.army);
    return a ? ADJ[a.prov] : [];
  }, [mode, c]);

  function add(o: Order) {
    const why = orderProblem(c, h, o, draft);
    if (why) { flash(why); return; }
    setDraft([...draft, o]); setMode(null);
  }
  function onProvince(id: string) {
    if (c.phase !== 'orders' || !ready) { setSel(id); return; }
    if (mode) {
      if (!targets.includes(id)) { flash('Das ist keine Nachbarprovinz.'); return; }
      add(mode.kind === 'move' ? { kind: 'move', army: mode.army, to: id } : { kind: 'support', army: mode.army, target: id });
      return;
    }
    setSel(id);
  }
  function seal() {
    try {
      const next = sealOrders(c, h, draft, Math.random);
      setC(next); setDraft([]); setSel(null); setMode(null); setReady(false);
    } catch (e) { flash((e as Error).message); }
  }
  function restart() {
    if (!confirm('Kampagne neu beginnen? Der aktuelle Stand geht verloren.')) return;
    setC(newCampaign()); setDraft([]); setReady(false); setSel(null); setMode(null); setBattle(null);
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

  const selArmy = sel ? armyAt(c, sel) : null;
  const ownArmy = selArmy && selArmy.house === h ? selArmy : null;
  const hasOrder = (id: string) => draft.some((o) => 'army' in o && o.army === id);
  const goldLeft = c.gold[h] - draft.reduce((g, o) => g + (o.kind === 'recruit' ? COST.recruit : o.kind === 'train' ? COST.train : 0), 0);

  return (
    <div className="app">
      <div className="stage" style={{ background: '#0D2A33' }}>
        <CampaignMap c={c} selected={sel} targets={targets} orders={c.phase === 'orders' && ready ? draft : []} onProvince={onProvince} />
        {msg && <div className="toast" role="alert">{msg}</div>}
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
        <div className="row" style={{ justifyContent: 'space-between' }}><Link to="/">← Zur Lobby</Link><span className="rule">Kampagne · Prototyp</span></div>
        <div className="card">
          <div className="turn">
            <span className="dot" style={{ background: HOUSES[h].color }} />
            <div>
              <div className="who">Runde {c.round} von {c.maxRounds}</div>
              <div className="sub">{c.phase === 'orders' ? (ready ? `${HOUSES[h].n} gibt Befehle` : 'Übergabe') : c.phase === 'battles' ? 'Schlachten' : 'Kampagne beendet'}</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8, gap: 12 }}>
            {(['R', 'K'] as House[]).map((x) => (
              <span key={x} className="rule"><i className="dot" style={{ background: HOUSES[x].color, display: 'inline-block', width: 9, height: 9, marginRight: 6 }} />
                {HOUSES[x].n}: {c.phase === 'orders' && ready && x !== h ? '? Gold' : `${c.gold[x]} Gold`} · {score(c, x)} Punkte</span>
            ))}
          </div>
        </div>

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

        {c.phase === 'orders' && ready && (
          <>
            <div className="card stack" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>Befehle von {HOUSES[h].n}</b><span className="rule">{draft.length} von {ORDERS_PER_ROUND} · {goldLeft} Gold übrig</span></div>
              {draft.length === 0 && <span className="rule">Wähle eine Provinz mit eigenem Heer oder eigener Stadt. Heere ohne Befehl halten ihre Stellung.</span>}
              {draft.map((o, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{describe(c, o)}</span>
                  <button type="button" className="ghost" aria-label="Befehl entfernen" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <button type="button" className="primary" onClick={seal}>Befehle versiegeln</button>
            </div>

            {sel && (
              <div className="card stack" style={{ gap: 6 }}>
                <h2>{PROV[sel].n}</h2>
                <span className="rule">{LAND[PROV[sel].land].n}{PROV[sel].city ? ' · Stadt' : ''}{PROV[sel].capital ? ` · Hauptstadt von ${HOUSES[PROV[sel].capital!].n}` : ''} · {c.owner[sel] ? HOUSES[c.owner[sel]!].n : 'unbeansprucht'}</span>
                <span className="rule">{LAND[PROV[sel].land].note}</span>
                {selArmy && <span>Heer von {HOUSES[selArmy.house].n}: {selArmy.size} Figuren{selArmy.house === h && ` (Captain ${selArmy.spec.CAP}, Kapläne ${selArmy.spec.KAP}, Kanonaden ${selArmy.spec.KAN}, Marines ${selArmy.spec.MAR})`}</span>}
                {ownArmy && !hasOrder(ownArmy.id) && (
                  <div className="row">
                    <button type="button" onClick={() => setMode({ kind: 'move', army: ownArmy.id })}>Ziehen …</button>
                    <button type="button" onClick={() => setMode({ kind: 'support', army: ownArmy.id })}>Unterstützen …</button>
                    <button type="button" onClick={() => add({ kind: 'forage', army: ownArmy.id })}>Fouragieren</button>
                  </div>
                )}
                {ownArmy && hasOrder(ownArmy.id) && <span className="rule">Dieses Heer hat schon einen Befehl.</span>}
                {PROV[sel].city && c.owner[sel] === h && (
                  <div className="row">
                    <button type="button" onClick={() => add({ kind: 'recruit', prov: sel })}>Rekrutieren ({COST.recruit} Gold)</button>
                    <select value={spec} onChange={(e) => setSpec(e.target.value as SpecKey)} style={{ width: 'auto' }} aria-label="Spezialist">
                      {(Object.keys(SPEC_NAME) as SpecKey[]).map((k) => <option key={k} value={k}>{SPEC_NAME[k]}</option>)}
                    </select>
                    <button type="button" onClick={() => add({ kind: 'train', prov: sel, spec })}>Ausbilden ({COST.train} Gold)</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="card stack" style={{ gap: 4 }}>
          <div className="lbl">Bericht</div>
          {c.report.slice(-14).map((l, i) => <span key={i} className="rule">{l}</span>)}
        </div>
        <div className="card stack" style={{ gap: 4 }}>
          <div className="lbl">Regeln kurz</div>
          <span className="rule">Pro Runde {ORDERS_PER_ROUND} Befehle. Alle Befehle werden gleichzeitig ausgeführt. Stärke = Heer + halbe Größe unterstützender Heere, Verteidiger im Gebirge, auf Hügeln und im Wald stärker. Ab 1,5-facher Übermacht entscheidet sich ein Kampf von selbst, sonst kommt es zur Schlacht.</span>
          <span className="rule">Einkommen: 1 Gold je Provinz, 2 je Stadt. Sieg: gegnerische Hauptstadt erobern oder nach {c.maxRounds} Runden die meisten Punkte (Provinz 1, Stadt 3).</span>
        </div>
        <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={restart}>Kampagne neu beginnen</button>
      </aside>
    </div>
  );
}
