import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { watchGame } from '../online.ts';
import { AlertToggle, useTurnAlert } from '../components/turnAlert.tsx';
import GameView from '../components/GameView.tsx';
import { act, type Action } from '../game/actions.ts';
import { battleResult } from '../game/battle.ts';
import type { BattleOutcome } from '../campaign/engine.ts';
import type { GameState } from '../game/rules.ts';
import { HelpButton } from '../campaign/Help.tsx';
import Overview from '../campaign/Overview.tsx';
import { CityPanel, HexPanel, describe, specText } from '../campaign/Panels.tsx';
import BuildBar, { type BuildPick } from '../campaign/BuildBar.tsx';
import StartDialog from '../campaign/StartDialog.tsx';
import { aiOrders } from '../campaign/ai.ts';
import { FeedbackForm } from '../components/Feedback.tsx';
import CampaignMap from '../campaign/CampaignMap.tsx';
import CampaignMap3D from '../campaign/CampaignMap3D.tsx';
import { explain, num, type Explanation } from '../campaign/explain.ts';
import {
  AGENT_RANGE, BUILDINGS, ORDERS_PER_ROUND, levelOf, orderCount, SPEC_NAME, OTHER, applyBattle, agentById, armyById, autoBattle, battleGame, engagedIds,
  GOAL_POINTS, finalScore, goalMet, goalText, movePreview, newCampaign, orderCost, orderProblem, pathCost, rangeOf, score, sealOrders,
  type Branch, type Campaign as CampaignState, type Order, type Tone,
} from '../campaign/engine.ts';
import { CITY_HEX, HEX_ADJ, HOUSES, LAND, PROVINCES, hexCenter, hexLand, hexName, pathTo, reachable, type HexKey, type House } from '../campaign/map.ts';

// Campaign prototype on one device: houses give their orders in turn (the other player looks away), then all resolve at once.

const KEY = 'deckmate.kampagne.v2';
/** Width of the left panel, which is always open (overview, city or field). */
const LEFT = 330;
const LEFT_PANEL = {
  position: 'absolute' as const, left: 0, top: 58, bottom: 0, width: LEFT, zIndex: 6, overflowY: 'auto' as const, gap: 12,
  padding: 16, background: 'var(--hull)', borderRight: '1px solid var(--rope)',
};
const saved = (): CampaignState | null => {
  try { const s = localStorage.getItem(KEY); if (s) { const c = JSON.parse(s) as CampaignState; if (c.v === 2) return c; } } catch { /* ignore */ }
  return null;
};
const save = (c: CampaignState) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ } };
const STEP_MS = 650;

type Unit = { kind: 'army' | 'agent'; id: string };
/** Online play: one house per player, state from Firestore, changes as transactions. */
export interface OnlineSession {
  id: string; me: House; c: CampaignState; names: Record<House, string | null>; name: string;
  commit: (fn: (c: CampaignState, me: House) => CampaignState) => Promise<void>;
  startBattle: (battleId: string) => Promise<string>;
}
const outcomeOf = (st: GameState): BattleOutcome | null => {
  const r = battleResult(st);
  return r ? { attackerWon: r.winner === 'O', attacker: { size: r.attacker.size, spec: r.attacker.spec }, defender: { size: r.defender.size }, retreat: false, how: 'auf dem Brett' } : null;
};
type Panel = { kind: 'overview' } | { kind: 'city'; prov: string } | { kind: 'hex'; hex: HexKey };

export default function Campaign({ online }: { online?: OnlineSession } = {}) {
  const nav = useNavigate();
  const [localC, setC] = useState<CampaignState>(() => (online ? online.c : saved() ?? newCampaign()));
  const c = online ? online.c : localC;
  /** Start dialog: shown when there is no saved campaign, or for a new one. */
  const [setup, setSetup] = useState(() => !online && !saved());
  const [readyLocal, setReady] = useState(false);
  /** One device against the computer. */
  const solo = !online && c.opts?.ai ? c.opts.ai : null;
  const ready = online || solo ? true : readyLocal;
  const [draft, setDraft] = useState<Order[]>([]);
  // online: the draft survives a reload; the last reveal is shown once per browser
  const draftKey = online ? `deckmate.kampagne.entwurf.${online.id}.${c.round}` : null;
  useEffect(() => { if (draftKey) try { const s = localStorage.getItem(draftKey); setDraft(s ? JSON.parse(s) : []); } catch { /* ignore */ } }, [draftKey]);
  useEffect(() => { if (draftKey) try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* ignore */ } }, [draft, draftKey]);
  const seenKey = online ? `deckmate.kampagne.gesehen.${online.id}` : '';
  const [seen, setSeen] = useState(() => { try { return Number(localStorage.getItem(seenKey) ?? 0) || 0; } catch { return 0; } });
  const revealPending = !!c.reveal && (!online || c.reveal.round > seen);
  const [selHex, setSelHex] = useState<HexKey | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [path, setPath] = useState<HexKey[]>([]);
  const [mode, setMode] = useState<'move' | 'support'>('move');
  const [buildMode, setBuildMode] = useState<BuildPick | null>(null);
  /** Build bar: open tab and the field picked first (cards then show what fits there). */
  const [barTab, setBarTab] = useState<Branch | null>(null);
  const [site, setSite] = useState<HexKey | null>(null);
  const [panel, setPanel] = useState<Panel>({ kind: 'overview' });
  const [msg, setMsg] = useState('');
  const [battle, setBattle] = useState<{ id: string; st: GameState } | null>(null);
  /** Reveal: all orders as lines, then the walk step by step, then everyone settles, then the conflicts are explained. */
  const [show, setShow] = useState<null | 'orders' | 'walk' | 'settle' | 'conflicts'>(null);
  const [step, setStep] = useState(0);
  /** Index of the conflict whose explanation card is open. */
  const [conf, setConf] = useState<number | null>(null);
  const [cardPos, setCardPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  /** 2D (SVG) or 3D map; remembered per browser. */
  const [view3d, setView3d] = useState(() => { try { return localStorage.getItem('deckmate.kampagne.ansicht') === '3d'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('deckmate.kampagne.ansicht', view3d ? '3d' : '2d'); } catch { /* ignore */ } }, [view3d]);
  /** Screen position (client coordinates) of a field, from whichever map is shown. */
  const projector = useRef<((hex: HexKey) => [number, number] | null) | null>(null);
  const [camTick, setCamTick] = useState(0);
  const [banner, setBanner] = useState<number | null>(null);
  const shownRound = useRef(0);

  useEffect(() => { if (!setup && !online) save(c); }, [c, setup]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearSel = () => { setUnit(null); setPath([]); setMode('move'); setBuildMode(null); setSite(null); };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setUnit(null); setPath([]); setBuildMode(null); setSite(null); setPanel({ kind: 'overview' }); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const walkLen = c.reveal ? Math.max(1, ...Object.values(c.reveal.walk ?? {}).map((w) => w.length)) : 1;
  useEffect(() => { if (revealPending && show === null) { setStep(0); setShow('orders'); } }, [revealPending, show]);
  const finishReveal = () => {
    setShow(null); setConf(null);
    if (!online) { setC((p) => ({ ...p, reveal: null })); return; }
    const r = c.reveal?.round ?? 0;
    setSeen(r); try { localStorage.setItem(seenKey, String(r)); } catch { /* ignore */ }
  };
  useEffect(() => {
    if (show === 'orders') { const t = setTimeout(() => setShow('walk'), 3000); return () => clearTimeout(t); }
    if (show === 'walk') {
      const t = setTimeout(() => { if (step + 1 <= walkLen) setStep(step + 1); else setShow('settle'); }, STEP_MS);
      return () => clearTimeout(t);
    }
    if (show === 'settle') {
      const t = setTimeout(() => { if (c.conflicts?.length) { setConf(0); setShow('conflicts'); } else finishReveal(); }, 900);
      return () => clearTimeout(t);
    }
  }, [show, step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!show && !revealPending && c.phase === 'orders' && (online || solo || !ready) && shownRound.current !== c.round) { shownRound.current = c.round; setBanner(c.round); }
  }, [show, revealPending, c.phase, c.round, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const explained: Explanation[] = (c.conflicts ?? []).map(explain);
  const card = conf !== null ? explained[conf] ?? null : null;
  useLayoutEffect(() => {
    const place = () => {
      const box = mapBox.current;
      if (!card || !box) { setCardPos(null); return; }
      let pt: [number, number] | null = null;
      if (view3d) pt = projector.current?.(card.hex) ?? null;
      else {
        const m = svgRef.current?.getScreenCTM();
        if (m) { const [x, y] = hexCenter(card.hex); const q = new DOMPoint(x, y).matrixTransform(m); pt = [q.x, q.y]; }
      }
      if (!pt) return;
      const r = box.getBoundingClientRect();
      const next = { x: Math.round(pt[0] - r.left), y: Math.round(pt[1] - r.top), w: Math.round(r.width), h: Math.round(r.height) };
      setCardPos((old) => (old && old.x === next.x && old.y === next.y && old.w === next.w && old.h === next.h ? old : next));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [card?.hex, view3d, camTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (banner !== null) { const t = setTimeout(() => setBanner(null), 2600); return () => clearTimeout(t); } }, [banner]);

  const me: House | null = online ? online.me : solo ? OTHER[solo.house] : null;
  const h: House = me ?? c.current;
  const other: House = h === 'R' ? 'K' : 'R';
  const waitingForOther = !!(online || solo) && c.phase === 'orders' && c.sealed[h];
  // the computer gives its orders as soon as the reveal is over
  useEffect(() => {
    if (!solo || setup || show || revealPending || c.phase !== 'orders' || c.sealed[solo.house]) return;
    const t = setTimeout(() => setC((p) => (p.sealed[solo.house] || p.phase !== 'orders' ? p : sealOrders(p, solo.house, aiOrders(p, solo.house, solo.level, Math.random), Math.random))), 400);
    return () => clearTimeout(t);
  }, [solo?.house, setup, show, revealPending, c.phase, c.round, c.sealed[solo?.house ?? 'R']]); // eslint-disable-line react-hooks/exhaustive-deps
  const giving = c.phase === 'orders' && ready && !show && !waitingForOther;
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3200); };
  // online: tab title, chime and notification when it is this player's turn
  const need = !online ? null
    : revealPending && !show ? 'Runde aufgedeckt'
    : c.phase === 'orders' && !c.sealed[h] ? `Runde ${c.round}: deine Befehle`
    : c.phase === 'battles' ? 'Schlacht wartet'
    : c.phase === 'over' ? 'Kampagne beendet' : null;
  useTurnAlert(need, online ? online.name : 'Kampagne');
  /** Changes the campaign: locally right away, online as a transaction on the latest state. */
  async function apply(fn: (p: CampaignState, me: House) => CampaignState): Promise<boolean> {
    try {
      if (online) await online.commit(fn);
      else setC(fn(c, me ?? c.current));
      return true;
    } catch (e) { flash((e as Error).message); return false; }
  }

  const why = (o: Order) => orderProblem(c, h, o, draft);
  function add(o: Order) {
    const w = why(o);
    if (w) { flash(w); return false; }
    setDraft([...draft, o]); clearSel();
    return true;
  }
  const removeOrder = (i: number) => setDraft(draft.filter((_, j) => j !== i));

  // ----- selected unit and its way -----
  const selArmy = unit?.kind === 'army' ? armyById(c, unit.id) : null;
  const selAgent = unit?.kind === 'agent' ? agentById(c, unit.id) : null;
  const selPos = selArmy?.hex ?? selAgent?.hex ?? null;
  const selOrder = unit ? draft.findIndex((o) => ('army' in o && o.army === unit.id) || (o.kind === 'agent' && o.agent === unit.id)) : -1;
  const engaged = engagedIds(c);
  const mineSel = !!(giving && unit && (selArmy?.house === h || selAgent?.house === h) && !(selArmy && engaged.has(selArmy.id)));
  const planning = mineSel && selOrder < 0 && orderCount(draft) < ORDERS_PER_ROUND;
  const budget = selArmy ? rangeOf(selArmy) : selAgent ? AGENT_RANGE : 0;
  const left = budget - pathCost(path);
  const enemyHexes = new Set(c.armies.filter((a) => a.house !== h).map((a) => a.hex));
  const pathEnd = path.length ? path[path.length - 1] : selPos;
  const stoppedOnEnemy = !!(path.length && enemyHexes.has(path[path.length - 1]));
  const reachInfo = planning && mode === 'move' && pathEnd && !stoppedOnEnemy
    ? reachable(pathEnd, left, selArmy ? enemyHexes : new Set(), selAgent ? enemyHexes : new Set())
    : null;
  const reach: Record<HexKey, number> | undefined = reachInfo ? reachInfo.cost : planning && mode === 'support' && selPos ? Object.fromEntries(HEX_ADJ[selPos].map((k) => [k, 1])) : undefined;
  // build site picking
  const siteReach: Record<HexKey, number> | undefined = buildMode && giving
    ? Object.fromEntries(Object.keys(c.hexOwner).filter((k) => !why(siteOrder(buildMode, k))).map((k) => [k, 0]))
    : undefined;
  function siteOrder(p: BuildPick, k: HexKey): Order {
    return p.kind === 'build' ? { kind: 'build', hex: k, b: p.b } : c.buildings[k] === p.b ? { kind: 'upgrade', hex: k } : { kind: 'build', hex: '', b: p.b };
  }
  function openBuild(at: HexKey | null) {
    clearSel();
    setSite(at);
    const b = at ? c.buildings[at] : undefined;
    setBarTab(b ? BUILDINGS[b].branch : at && CITY_HEX[at] ? 'verteidigung' : barTab ?? 'wirtschaft');
  }

  function selectArmy(id: string) {
    const a = armyById(c, id);
    if (!a) return;
    setBuildMode(null);
    if (planning && mode === 'support' && selArmy && HEX_ADJ[selArmy.hex].includes(a.hex) && a.id !== selArmy.id) { onHex(a.hex); return; }
    if (planning && mode === 'move' && unit?.id !== id && reach && a.hex in reach) { onHex(a.hex); return; }
    setSelHex(a.hex);
    if (!giving || a.house !== h) { clearSel(); setPanel({ kind: 'hex', hex: a.hex }); return; }
    if (unit?.id === id) { clearSel(); return; }
    setUnit({ kind: 'army', id }); setPath([]); setMode('move');
  }
  function selectAgent(id: string) {
    const g = agentById(c, id);
    if (!g) return;
    setBuildMode(null);
    if (planning && reach && g.hex in reach && unit?.id !== id) { onHex(g.hex); return; }
    setSelHex(g.hex);
    if (!giving || g.house !== h) { clearSel(); setPanel({ kind: 'hex', hex: g.hex }); return; }
    if (unit?.id === id) { clearSel(); return; }
    setUnit({ kind: 'agent', id }); setPath([]); setMode('move');
  }
  function confirmPath(p = path) {
    if (!unit || !p.length) return;
    add(unit.kind === 'army' ? { kind: 'move', army: unit.id, path: p } : { kind: 'agent', agent: unit.id, path: p });
  }
  function onHex(k: HexKey) {
    if (buildMode) {
      if (siteReach && k in siteReach) { add(siteOrder(buildMode, k)); return; }
      setBuildMode(null);
    }
    if (planning && mode === 'support' && selArmy) {
      if (HEX_ADJ[selArmy.hex].includes(k)) { add({ kind: 'support', army: selArmy.id, target: k }); return; }
    }
    if (planning && mode === 'move' && selPos) {
      if (path.length && k === path[path.length - 1]) { confirmPath(); return; }
      const onPath = path.indexOf(k);
      if (onPath >= 0) { setPath(path.slice(0, onPath + 1)); return; }
      if (k === selPos) { setPath([]); return; }
      if (reachInfo && k in reachInfo.cost && k !== pathEnd) { setPath([...path, ...pathTo(reachInfo.prev, k)]); return; }
    }
    clearSel();
    setSelHex(k);
    setPanel(CITY_HEX[k] ? { kind: 'city', prov: CITY_HEX[k] } : { kind: 'hex', hex: k });
    if (barTab && giving && (c.hexOwner[k] === h)) setSite(k);
  }

  async function seal() {
    const orders = draft;
    if (await apply((p, me) => sealOrders(p, me, orders, Math.random))) {
      setDraft([]); setSelHex(null); clearSel(); setPanel({ kind: 'overview' }); setReady(false);
    }
  }
  const hasBattle = (p: CampaignState, id: string) => p.battles.some((x) => x.id === id);
  async function boardBattle(id: string) {
    if (!online) { setBattle({ id, st: battleGame(c, id, Math.random) }); return; }
    try { nav(`/spiel/${await online.startBattle(id)}`); } catch (e) { flash((e as Error).message); }
  }
  function restart() { setSetup(true); }
  function begin(o: Parameters<typeof newCampaign>[0]) {
    shownRound.current = 0;
    setC(newCampaign(o)); setDraft([]); setReady(false); setSelHex(null); clearSel(); setPanel({ kind: 'overview' }); setBattle(null); setShow(null); setConf(null);
    setSetup(false);
  }
  function takeBattle() {
    if (!battle) return;
    const r = battleResult(battle.st);
    if (!r) return;
    const id = battle.id, out = outcomeOf(battle.st)!;
    apply((p) => (hasBattle(p, id) ? applyBattle(p, id, out) : p));
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

  const goldLeft = c.gold[h] - draft.reduce((g, o) => g + orderCost(c, h, o), 0);
  const phaseText = show === 'conflicts' ? 'Konflikte der Runde' : show ? 'Befehle werden aufgedeckt' : c.phase === 'orders'
    ? (waitingForOther ? (solo ? 'Der Computer überlegt …' : `Warte auf ${HOUSES[other].n}`) : online || solo ? 'Deine Befehle' : ready ? `${HOUSES[h].n} gibt Befehle` : 'Übergabe')
    : c.phase === 'battles' ? 'Schlachten' : 'Kampagne beendet';

  // signs on fields: expected outcome at the end of the way, or the support bonus
  const labels: Record<HexKey, { text: string; tone: Tone }> = {};
  if (planning && selArmy && mode === 'move') {
    if (path.length) labels[path[path.length - 1]] = movePreview(c, h, selArmy.id, path[path.length - 1], draft);
    if (reach) for (const k of Object.keys(reach)) if (enemyHexes.has(k) && !labels[k]) labels[k] = movePreview(c, h, selArmy.id, k, draft);
  }
  if (planning && selArmy && mode === 'support') for (const k of HEX_ADJ[selArmy.hex]) labels[k] = { text: `+${num(selArmy.size / 2)} Stärke`, tone: 'plain' };
  const idle = giving ? c.armies.filter((a) => a.house === h && !engaged.has(a.id) && !draft.some((o) => 'army' in o && o.army === a.id)) : [];

  // What the map shows during the reveal: positions before the march, then step by step along the walks.
  const rv = c.reveal;
  const walking = (show === 'orders' || show === 'walk') && rv;
  const at = Math.min(step, walkLen - 1);
  let mapC: CampaignState = c;
  const posOverride: Record<string, [number, number]> = {};
  if (walking) {
    const hexOwner = { ...rv.hexOwner };
    if (show === 'walk') for (const a of rv.armies) for (const k of (rv.walk[a.id] ?? []).slice(1, at + 1)) hexOwner[k] = a.house;
    const buildings = { ...c.buildings };
    const levels = { ...(c.levels ?? {}) };
    for (const x of ['R', 'K'] as House[]) for (const o of rv.orders[x]) {
      if (o.kind === 'build') delete buildings[o.hex];
      if (o.kind === 'upgrade') levels[o.hex] = Math.max(1, (levels[o.hex] ?? 1) - 1);
    }
    mapC = { ...c, round: rv.round, armies: rv.armies, agents: rv.agents, traders: rv.traders, hexOwner, owner: rv.owner, gold: rv.gold, battles: [], buildings, levels };
    if (show === 'walk') {
      for (const [id, w] of Object.entries(rv.walk)) posOverride[id] = hexCenter(w[at]);
      // those stopped in a conflict at this step march halfway towards the field and come back
      for (const e of explained) if (e.step === step) for (const t of e.turnedBack) {
        const [x1, y1] = hexCenter(t.from), [x2, y2] = hexCenter(t.to);
        posOverride[t.army] = [x1 + (x2 - x1) * 0.5, y1 + (y2 - y1) * 0.5];
      }
    }
  }
  const mapOrders = walking && show === 'orders' ? [...rv.orders.R, ...rv.orders.K] : giving ? draft : [];
  // who is on the move in this step (they march and raise dust)
  const moving = new Set<string>();
  if (show === 'walk' && rv) {
    for (const [id, w] of Object.entries(rv.walk)) if (at > 0 && w[at] !== w[at - 1]) moving.add(id);
    for (const e of explained) if (e.step === step) for (const t of e.turnedBack) moving.add(t.army);
  }
  // buildings ordered this round show up as construction sites
  const construction = (walking && rv ? (['R', 'K'] as House[]).flatMap((x) => rv.orders[x].map((o) => ({ o, x }))) : giving ? draft.map((o) => ({ o, x: h })) : [])
    .flatMap(({ o, x }) => (o.kind === 'build' ? [{ hex: o.hex, b: o.b, house: x }]
      : o.kind === 'upgrade' && c.buildings[o.hex] ? [{ hex: o.hex, b: c.buildings[o.hex], house: x, up: walking ? levelOf(mapC, o.hex) + 1 : levelOf(c, o.hex) + 1 }] : []));
  const plan = planning && selPos && mode === 'move' ? { from: selPos, path, house: h } : null;
  const mapProps = {
    c: mapC, selectedHex: selHex, selectedUnit: unit?.id ?? null, reach: siteReach ?? reach, plan, orders: mapOrders,
    onHex, onArmy: selectArmy, onAgent: selectAgent, labels,
    focus: card ? [card.hex, ...(card.hex2 ? [card.hex2] : [])] : undefined, posOverride, stepMs: show === 'walk' ? STEP_MS - 50 : 900,
    moving, construction,
  };

  const forage = selArmy ? LAND[hexLand(selArmy.hex)].forage : 0;
  const forageWhy = selArmy ? why({ kind: 'forage', army: selArmy.id }) : '';

  return (
    <div className="app">
      <div className="stage" style={{ background: '#0D2A33', display: 'flex', flexDirection: 'column' }}>
        <div role="banner" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          padding: '10px 16px', background: 'var(--hull)', borderBottom: '1px solid var(--rope)', zIndex: 4,
        }}>
          <div className="row" style={{ gap: 10 }}>
            {(['R', 'K'] as House[]).map((x) => {
              const provs = PROVINCES.filter((p) => mapC.owner[p.id] === x);
              const hidden = online || solo ? x !== h && c.phase !== 'over' : giving && x !== h;
              const active = giving && x === h;
              return (
                <div key={x} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', borderRadius: 8,
                  background: 'var(--hull-2)', border: `1px solid ${active ? HOUSES[x].color : 'var(--rope)'}`,
                }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: HOUSES[x].color, boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${HOUSES[x].color} 35%, transparent)` : undefined }} />
                  <span className="stack" style={{ gap: 0, lineHeight: 1.1 }}>
                    <b style={{ fontFamily: 'var(--display)' }}>{HOUSES[x].n}</b>
                    {online && <span className="rule" style={{ fontSize: 11 }}>{online.names[x] ?? 'frei'}{x === h ? ' (du)' : ''}</span>}
                    {solo && <span className="rule" style={{ fontSize: 11 }}>{x === h ? 'du' : solo.level === 'leicht' ? 'Computer, leicht' : 'Computer'}</span>}
                  </span>
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
            {giving && <Stat label="Befehle" value={`${orderCount(draft)}/${ORDERS_PER_ROUND}`} />}
          </div>
        </div>

        <div ref={mapBox} style={{ flex: 1, minHeight: 0, position: 'relative', paddingLeft: LEFT }}>
          {view3d ? (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <CampaignMap3D {...mapProps} house={h} projector={projector} onCamera={() => card && setCamTick((t) => t + 1)} />
            </div>
          ) : <CampaignMap {...mapProps} svgRef={svgRef} />}
          <div role="group" aria-label="Kartenansicht" className="row" style={{ position: 'absolute', left: LEFT + 12, top: 12, gap: 0, zIndex: 3 }}>
            {[false, true].map((d) => (
              <button key={String(d)} type="button" className={view3d === d ? 'on' : ''} aria-pressed={view3d === d} onClick={() => setView3d(d)}
                style={{ borderRadius: d ? '0 6px 6px 0' : '6px 0 0 6px', marginLeft: d ? -1 : 0 }}>{d ? '3D' : '2D'}</button>
            ))}
          </div>

          {card && cardPos && conf !== null && (
            <ConflictCard e={card} index={conf} count={explained.length} pos={cardPos}
              onPrev={() => setConf(Math.max(0, conf - 1))}
              onNext={() => (conf + 1 < explained.length ? setConf(conf + 1) : show === 'conflicts' ? finishReveal() : setConf(null))}
              onClose={() => (show === 'conflicts' ? finishReveal() : setConf(null))}
              finalLabel={show === 'conflicts' ? (c.phase === 'battles' ? 'Zu den Schlachten' : 'Weiter') : 'Schließen'} />
          )}

          {buildMode && giving && (
            <div role="status" className="card" style={{ position: 'absolute', left: LEFT + 16, right: 16, bottom: 16, margin: '0 auto', maxWidth: 560, zIndex: 5, display: 'flex', gap: 10, alignItems: 'center', background: 'var(--hull)', borderColor: 'var(--brass)' }}>
              <span style={{ flex: 1 }}>{buildMode.kind === 'build'
                ? <>Wo soll {BUILDINGS[buildMode.b].art === 'einen' ? 'der' : 'die'} <b>{BUILDINGS[buildMode.b].n}</b> stehen? Tippe ein leuchtendes Feld an.</>
                : <>Welche <b>{BUILDINGS[buildMode.b].n}</b> soll ausgebaut werden? Tippe ein leuchtendes Feld an.</>}</span>
              <button type="button" className="ghost" onClick={() => setBuildMode(null)}>Abbrechen</button>
            </div>
          )}

          {giving && !buildMode && !(mineSel && (selArmy || selAgent)) && (
            <div style={{ position: 'absolute', left: LEFT, right: 0, bottom: 0 }}>
              <BuildBar c={c} house={h} draft={draft} add={(o) => { if (add(o)) setSite(null); }} remove={removeOrder} site={site} tab={barTab}
                setTab={(t) => { setBarTab(t); if (!t) setSite(null); }} onPick={(p) => { clearSel(); setBuildMode(p); }} onClearSite={() => setSite(null)} />
            </div>
          )}

          {mineSel && (selArmy || selAgent) && !buildMode && (
            <div role="dialog" aria-label="Befehl geben" className="card" style={{
              position: 'absolute', left: LEFT + 16, right: 16, bottom: 16, margin: '0 auto', maxWidth: 700, zIndex: 5,
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--hull)', borderColor: 'var(--brass)',
              boxShadow: '0 10px 30px rgba(0,0,0,.4)',
            }}>
              <div className="stack" style={{ gap: 2, flex: '1 1 260px', minWidth: 0 }}>
                <b style={{ fontFamily: 'var(--display)' }}>
                  {selArmy ? `Heer bei ${hexName(selArmy.hex)} · ${selArmy.size} Figuren` : `${SPEC_NAME[selAgent!.spec]} bei ${hexName(selAgent!.hex)}`}
                </b>
                <span className="rule" style={{ fontSize: 12 }}>
                  {selArmy ? `${specText(selArmy)} · Reichweite ${budget}` : `Einzelgänger · Reichweite ${budget}, meidet feindliche Heere`}
                  {planning && mode === 'move' && ` · Weg ${pathCost(path)}/${budget} Punkte`}
                </span>
                <span style={{ fontSize: 13 }}>
                  {selOrder >= 0 ? `Befehl: ${describe(c, h, draft[selOrder])}`
                    : !planning ? `Alle ${ORDERS_PER_ROUND} Befehle dieser Runde sind vergeben.`
                    : mode === 'support' ? 'Welches Nachbarfeld soll das Heer unterstützen? Es zählt dort mit halber Größe.'
                    : !path.length ? 'Tippe ein leuchtendes Feld an: Der Weg folgt den Hexfeldern. Gebirge und Sumpf kosten 2 Punkte.'
                    : stoppedOnEnemy ? 'Der Weg endet am feindlichen Heer. Bestätigen oder Schritte zurücknehmen.'
                    : 'Weitere Felder anklicken verlängert den Weg (Wegpunkte). Das letzte Feld noch einmal antippen oder bestätigen.'}
                </span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {selOrder >= 0 && <button type="button" onClick={() => removeOrder(selOrder)}>Befehl zurücknehmen</button>}
                {planning && mode === 'move' && path.length > 0 && <button type="button" className="primary" onClick={() => confirmPath()}>Weg bestätigen</button>}
                {planning && mode === 'move' && path.length > 0 && <button type="button" onClick={() => setPath(path.slice(0, -1))}>Schritt zurück</button>}
                {planning && selArmy && (mode === 'move'
                  ? <button type="button" onClick={() => { setMode('support'); setPath([]); }}>Unterstützen …</button>
                  : <button type="button" onClick={() => setMode('move')}>Ziehen …</button>)}
                {planning && selArmy && <button type="button" className={forageWhy ? 'muted' : ''} title={forageWhy || undefined} onClick={() => add({ kind: 'forage', army: selArmy.id })}>Fouragieren (+{forage})</button>}
                <button type="button" className="ghost" aria-label="Auswahl aufheben" onClick={clearSel}>×</button>
              </div>
            </div>
          )}

          {show && rv && !(show === 'conflicts' && card) && (
            <div role="status" style={{
              position: 'absolute', top: 16, left: LEFT, right: 0, margin: '0 auto', width: 'max-content', maxWidth: 'calc(100% - 32px)', zIndex: 6,
              display: 'flex', gap: 14, alignItems: 'center', padding: '10px 18px', borderRadius: 10,
              background: 'color-mix(in srgb, var(--hull) 92%, transparent)', border: '1px solid var(--brass)', boxShadow: '0 10px 30px rgba(0,0,0,.4)',
            }}>
              <span style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--brass)' }}>Runde {rv.round}</span>
              <span>{show === 'orders' ? 'Die Befehle beider Häuser werden aufgedeckt.' : show === 'walk' ? `Die Heere ziehen · Schritt ${Math.min(step, walkLen - 1)} von ${walkLen - 1}` : show === 'conflicts' ? `${explained.length === 1 ? 'Ein Konflikt' : `${explained.length} Konflikte`} in dieser Runde.` : 'Alle sind angekommen.'}</span>
              {show === 'orders' && <button type="button" onClick={() => setShow('walk')}>Heere ziehen lassen</button>}
              {show === 'walk' && <button type="button" className="ghost" onClick={() => setShow('settle')}>Überspringen</button>}
            </div>
          )}
        </div>

        <div className="stack" style={LEFT_PANEL}>
          {panel.kind === 'city'
            ? <CityPanel c={c} prov={panel.prov} house={h} giving={giving} draft={draft} add={add} remove={removeOrder} onBack={() => setPanel({ kind: 'overview' })}
                onBuild={openBuild} />
            : panel.kind === 'hex'
              ? <HexPanel c={c} hex={panel.hex} house={h} giving={giving} draft={draft} add={add} remove={removeOrder} onBack={() => setPanel({ kind: 'overview' })}
                  onCity={(p) => setPanel({ kind: 'city', prov: p })} onBuild={openBuild} />
              : <Overview key={h} c={mapC} house={h} giving={giving} viewer={me ?? (giving ? h : null)} draft={draft} onArmy={selectArmy} onAgent={selectAgent}
                  onCity={(p) => { setPanel({ kind: 'city', prov: p }); }} />}
        </div>

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

        {setup && <StartDialog onStart={begin} onCancel={saved() && c.phase !== 'over' ? () => setSetup(false) : undefined} />}

        {!online && !solo && c.phase === 'orders' && !ready && !show && banner === null && !setup && (
          <div className="overlay" style={{ zIndex: 12 }}><div className="dialog">
            <h2>Runde {c.round}: {HOUSES[h].n}</h2>
            <p>Gib das Gerät an <b>{HOUSES[h].n}</b>. {HOUSES[OTHER[h]].n} schaut bitte weg, die Befehle sind geheim.</p>
            {c.sealed[OTHER[h]] && <p>{HOUSES[OTHER[h]].n} hat seine Befehle schon versiegelt.</p>}
            <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="primary" onClick={() => setReady(true)}>Ich bin {HOUSES[h].n}</button></div>
          </div></div>
        )}
        {c.phase === 'over' && !show && !setup && (
          <div className="overlay" style={{ zIndex: 30 }}><div className="dialog" style={{ maxHeight: 'calc(100% - 32px)', overflowY: 'auto', width: 'min(520px, 100%)', maxWidth: 520 }}>
            <h2>{c.winner ? `${HOUSES[c.winner].n} gewinnt` : 'Unentschieden'}</h2>
            <p>{c.winReason}</p>
            <p>Punkte: Ravensmoor {finalScore(c, 'R')} · Kerrow {finalScore(c, 'K')}</p>
            {c.goals && (
              <div className="stack" style={{ gap: 6, textAlign: 'left', margin: '0 0 12px' }}>
                <span className="lbl">Geheime Ziele</span>
                {(['R', 'K'] as House[]).map((x) => (
                  <span key={x}><b style={{ color: HOUSES[x].color }}>{HOUSES[x].n}:</b> {goalText(c.goals![x])} {goalMet(c, x) ? <b>Erfüllt, +{GOAL_POINTS} Punkte.</b> : <span className="rule">Nicht erfüllt.</span>}</span>
                ))}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'center' }}>{online
              ? <Link to="/"><button type="button" className="primary">Zur Lobby</button></Link>
              : <button type="button" className="primary" onClick={() => setSetup(true)}>Neue Kampagne</button>}</div>
            <div style={{ borderTop: '1px solid var(--rope)', marginTop: 16, paddingTop: 14, textAlign: 'left' }}>
              <h3 style={{ fontFamily: 'var(--display)', fontWeight: 500, margin: '0 0 8px' }}>Wie war die Kampagne?</h3>
              <FeedbackForm where="kampagne-ende" intro="Ein paar Sätze von dir helfen enorm: Was hat Spaß gemacht, was war zäh oder unklar, was fehlt?"
                context={{ Runde: c.round, Sieger: c.winner ? HOUSES[c.winner].n : 'Unentschieden', Punkte: `Ravensmoor ${finalScore(c, 'R')} : ${finalScore(c, 'K')} Kerrow`, Grund: c.winReason ?? '' }} />
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
                  <b>{b.field ? 'Feldschlacht' : 'Schlacht'} bei {hexName(b.hex)}</b>
                  <span className="rule">{b.field
                    ? `${HOUSES[att.house].n} (${att.size}, Stärke ${num(b.attStrength)}) trifft auf ${HOUSES[def.house].n} (${def.size}, Stärke ${num(b.defStrength)}) im Feld · ${LAND[hexLand(b.hex)].n}. ${HOUSES[att.house].n} führt die Offiziere.`
                    : `${HOUSES[att.house].n} (${att.size}, Stärke ${num(b.attStrength)}) greift ${HOUSES[def.house].n} (${def.size}, Stärke ${num(b.defStrength)}) an · ${LAND[hexLand(b.hex)].n}`}</span>
                  {b.game
                    ? <LinkedBattle gameId={b.game} onOpen={() => nav(`/spiel/${b.game}`)} onTake={(st) => { const out = outcomeOf(st); if (out) apply((p) => (hasBattle(p, b.id) ? applyBattle(p, b.id, out) : p)); }} />
                    : <div className="row">
                        {!solo && <button type="button" className="primary" onClick={() => boardBattle(b.id)}>{online ? 'Auf dem Brett austragen (beide Spieler)' : 'Auf dem Brett austragen'}</button>}
                        <button type="button" className={solo ? 'primary' : ''} onClick={() => apply((p) => (hasBattle(p, b.id) ? autoBattle(p, b.id, Math.random) : p))}>Auswürfeln</button>
                      </div>}
                </div>
              );
            })}
          </div>
        )}

        {waitingForOther && !show && !solo && (
          <div className="card promo stack" style={{ gap: 6 }}>
            <b>Befehle versiegelt</b>
            <span className="rule">Sobald {online!.names[other] ?? HOUSES[other].n} ({HOUSES[other].n}) versiegelt, wird die Runde aufgedeckt. Du kannst die Seite offen lassen oder später wiederkommen.</span>
          </div>
        )}
        {giving && (
          <div className="card stack" style={{ gap: 6 }}>
            <b>Befehle von {HOUSES[h].n}</b>
            {online && c.sealed[other] && <span className="rule" style={{ fontSize: 12 }}>{HOUSES[other].n} hat schon versiegelt und wartet auf dich.</span>}
            {draft.length === 0 && <span className="rule">Tippe die Fahne eines Heeres an und lege seinen Weg über die Hexfelder fest. Felder und Städte öffnest du mit einem Klick aufs Feld.</span>}
            {draft.map((o, i) => (
              <div key={i} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span>{describe(c, h, o)}</span>
                <button type="button" className="ghost" aria-label="Befehl entfernen" onClick={() => removeOrder(i)}>×</button>
              </div>
            ))}
            {idle.length > 0 && draft.length < ORDERS_PER_ROUND && (
              <div className="stack" style={{ gap: 4, padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--brass) 10%, transparent)', border: '1px dashed var(--brass)' }}>
                <span style={{ fontSize: 13 }}>{idle.length === 1 ? '1 Heer hat' : `${idle.length} Heere haben`} noch keinen Befehl und {idle.length === 1 ? 'hält' : 'halten'} sonst die Stellung:</span>
                <div className="row" style={{ gap: 6 }}>
                  {idle.map((a) => <button key={a.id} type="button" onClick={() => selectArmy(a.id)}>{hexName(a.hex)} ({a.size})</button>)}
                </div>
              </div>
            )}
            <button type="button" className="primary" onClick={seal}>Befehle versiegeln</button>
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
          {walking ? <span className="rule">Die Befehle werden aufgedeckt …</span> : c.report.slice(-16).map((l, i) => <span key={i} className="rule">{l}</span>)}
        </div>
        {online && <AlertToggle />}
        <span className="rule" style={{ fontSize: 12 }}>Alle Begriffe und Regeln stehen im Feldbuch hinter dem goldenen ?.</span>
        {!online && <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={restart}>Kampagne neu beginnen</button>}
      </aside>
    </div>
  );
}

function ConflictCard({ e, index, count, pos, onPrev, onNext, onClose, finalLabel }: {
  e: Explanation; index: number; count: number; pos: { x: number; y: number; w: number; h: number };
  onPrev: () => void; onNext: () => void; onClose: () => void; finalLabel: string;
}) {
  const W = 310, gap = 44;
  const roomRight = pos.w - 12 - (pos.x + gap), roomLeft = pos.x - gap - (LEFT + 12);
  const left = roomRight >= W || roomRight >= roomLeft ? Math.min(pos.x + gap, pos.w - 12 - W) : Math.max(LEFT + 12, pos.x - gap - W);
  const top = Math.max(12, Math.min(pos.y - 90, pos.h - 460));
  const last = index + 1 >= count;
  return (
    <div role="dialog" aria-label={e.title} className="card stack" style={{
      position: 'absolute', left, top, width: W, zIndex: 7, gap: 10, background: 'var(--hull)', borderColor: '#F3D27A',
      boxShadow: '0 14px 40px rgba(0,0,0,.5)',
    }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div className="stack" style={{ gap: 0 }}>
          <span className="lbl">Konflikt {index + 1} von {count} · Schritt {e.step}</span>
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

/** Battle fought as a linked online Deckmate game: open it, and take over the result once it is over. */
function LinkedBattle({ gameId, onOpen, onTake }: { gameId: string; onOpen: () => void; onTake: (st: GameState) => void }) {
  const [st, setSt] = useState<GameState | null>(null);
  useEffect(() => watchGame(gameId, (g) => setSt(g?.state ?? null), () => setSt(null)), [gameId]);
  const over = st?.phase === 'over';
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="rule" style={{ fontSize: 12 }}>{over ? 'Die Partie ist entschieden.' : 'Die Partie läuft – beide Spieler spielen sie online.'}</span>
      <div className="row">
        <button type="button" className={over ? '' : 'primary'} onClick={onOpen}>{over ? 'Partie ansehen' : 'Zur Schlacht'}</button>
        {over && <button type="button" className="primary" onClick={() => onTake(st!)}>Ergebnis übernehmen</button>}
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
