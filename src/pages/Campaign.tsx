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
import Chat from '../campaign/Chat.tsx';
import { BUILDING_ICON } from '../campaign/CampaignMap.tsx';
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
import { CITY_HEX, HEX_ADJ, HOUSES, LAND, hexCenter, hexLand, hexName, pathTo, reachable, type HexKey, type House } from '../campaign/map.ts';

// Campaign prototype on one device: houses give their orders in turn (the other player looks away), then all resolve at once.

const KEY = 'deckmate.kampagne.v2';
type Pos = { x: number; y: number; w: number; h: number };
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
  /** The signed-in player (for the chat). */
  uid: string; userName: string;
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
  const [cardPos, setCardPos] = useState<Pos | null>(null);
  const [popPos, setPopPos] = useState<Pos | null>(null);
  /** "Lage" drawer on the left, settings menu, chat expanded although the room is needed elsewhere. */
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => { try { return localStorage.getItem('deckmate.kampagne.tipp') === '1'; } catch { return false; } });
  const svgRef = useRef<SVGSVGElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  /** 2D (SVG) or 3D map; remembered per browser. */
  const [view3d, setView3d] = useState(() => { try { return localStorage.getItem('deckmate.kampagne.ansicht') === '3d'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('deckmate.kampagne.ansicht', view3d ? '3d' : '2d'); } catch { /* ignore */ } }, [view3d]);
  /** Screen position (client coordinates) of a field, from whichever map is shown. */
  const projector = useRef<((hex: HexKey) => [number, number] | null) | null>(null);
  const [, setCamTick] = useState(0);
  const [banner, setBanner] = useState<number | null>(null);
  const shownRound = useRef(0);

  useEffect(() => { if (!setup && !online) save(c); }, [c, setup]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearSel = () => { setUnit(null); setPath([]); setMode('move'); setBuildMode(null); setSite(null); };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setUnit(null); setPath([]); setBuildMode(null); setSite(null); setPanel({ kind: 'overview' }); setDrawer(false); setMenu(false); } };
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
  /** Where a field is on screen, relative to the map box. */
  const posOf = (hex: HexKey | null): Pos | null => {
    const box = mapBox.current;
    if (!hex || !box) return null;
    let pt: [number, number] | null = null;
    if (view3d) pt = projector.current?.(hex) ?? null;
    else {
      const m = svgRef.current?.getScreenCTM();
      if (m) { const [x, y] = hexCenter(hex); const q = new DOMPoint(x, y).matrixTransform(m); pt = [q.x, q.y]; }
    }
    if (!pt) return null;
    const r = box.getBoundingClientRect();
    return { x: Math.round(pt[0] - r.left), y: Math.round(pt[1] - r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const same = (a: Pos | null, b: Pos | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  const popHexRef = useRef<HexKey | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = card ? posOf(card.hex) : null, b = posOf(popHexRef.current);
      setCardPos((old) => (card ? (a ? (same(old, a) ? old : a) : old) : null));
      setPopPos((old) => (same(old, b) ? old : b));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }); // runs after every render; cheap, and keeps cards next to their field while the camera moves
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

  const popHex = mineSel && (selArmy || selAgent) && !buildMode ? selPos : null;
  popHexRef.current = popHex;
  const chatCollapsed = !!(popHex || barTab) && !chatOpen;
  const houseState = (x: House) => {
    if (c.phase === 'battles') return { t: 'Schlacht', col: 'var(--muted)' };
    if (c.phase !== 'orders') return null;
    if (c.sealed[x]) return { t: '✓ versiegelt', col: '#9FD6AE' };
    if (online || solo) return x === h ? { t: 'deine Befehle', col: 'var(--brass)' } : { t: solo ? 'überlegt' : 'gibt Befehle', col: 'var(--muted)' };
    return x === c.current && ready ? { t: 'am Zug', col: 'var(--brass)' } : null;
  };
  const ORDER_ICON: Record<string, string> = { move: '➜', agent: '➜', support: '⛨', forage: '⚘', recruit: '+', train: '★', research: '✦' };
  const orderIcon = (o: Order) => (o.kind === 'build' ? BUILDING_ICON[o.b] : o.kind === 'upgrade' ? BUILDING_ICON[c.buildings[o.hex]] ?? '↑' : ORDER_ICON[o.kind] ?? '•');
  const free = ORDERS_PER_ROUND - orderCount(draft);
  const showDrawer = drawer || panel.kind !== 'overview';
  const closeDrawer = () => { setDrawer(false); setPanel({ kind: 'overview' }); };
  const conflictsList = !show && explained.length > 0 && (
    <div className="stack" style={{ gap: 6 }}>
      <span className="cmp-cap">Konflikte der letzten Runde</span>
      {explained.map((e, i) => (
        <button key={i} type="button" onClick={() => { setConf(i); closeDrawer(); }} style={{ textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', flex: 'none', background: e.winner ? HOUSES[e.winner].color : 'var(--muted)' }} />
          <span style={{ flex: 1 }}>{e.title}</span>
          {e.ratio && <span className="cmp-meta">{e.ratio.split(' · ')[0]}</span>}
        </button>
      ))}
    </div>
  );
  const logbook = (
    <div className="stack" style={{ gap: 4 }}>
      <span className="cmp-cap">Logbuch</span>
      {walking ? <span className="cmp-meta">Die Befehle werden aufgedeckt …</span> : c.report.slice(-14).map((l, i) => <span key={i} className="cmp-meta" style={{ lineHeight: 1.45 }}>{l}</span>)}
    </div>
  );
  // army popover: next to the unit, flipped to the left near the right edge
  const PW = 300;
  // at the bottom edge below the unit, so the fields it can reach stay free to click
  const popStyle = popPos
    ? { left: Math.max(12 + (showDrawer ? 340 : 0), Math.min(popPos.x - PW / 2, popPos.w - PW - 12)), bottom: 16 }
    : { left: '50%', bottom: 16, transform: 'translateX(-50%)' };

  return (
    <div className="cmp">
      <header className="cmp-top" role="banner">
        <div className="row" style={{ gap: 14, flexWrap: 'nowrap', minWidth: 0 }}>
          <span className="cmp-brand">Deckmate</span>
          <span className="cmp-sep" />
          <span className="stack" style={{ gap: 0, lineHeight: 1.2 }}>
            <b style={{ fontSize: 15 }}>Runde {mapC.round} <span className="cmp-meta" style={{ fontWeight: 400 }}>von {c.maxRounds}</span></b>
            <span className="cmp-meta" style={{ fontSize: 12 }}>{phaseText}</span>
          </span>
        </div>
        <div className="row" style={{ flex: 1, justifyContent: 'center', gap: 8 }}>
          {(['R', 'K'] as House[]).map((x) => {
            const hidden = online || solo ? x !== h && c.phase !== 'over' : giving && x !== h;
            const mine = (online || solo || giving) && x === h;
            const st = houseState(x);
            const sub = online ? `${online.names[x] ?? 'frei'}${x === h ? ' · du' : ''}` : solo ? (x === h ? 'du' : 'Computer') : '';
            return (
              <div key={x} className="house-chip" style={{ boxShadow: mine ? `inset 0 0 0 1px ${HOUSES[x].color}` : undefined }}
                title={`${HOUSES[x].n}: ${score(mapC, x)} Punkte${hidden ? '' : `, ${mapC.gold[x]} Gold`}`}>
                <span className="dot" style={{ background: HOUSES[x].color }} />
                <b>{HOUSES[x].n}</b>
                {sub && <span className="sub">{sub}</span>}
                {!hidden && <span className="sub">{mine && goldLeft !== mapC.gold[x] ? `${goldLeft}/${mapC.gold[x]}` : mapC.gold[x]} Gold</span>}
                <span className="pts" aria-label={`${score(mapC, x)} Punkte`}>{score(mapC, x)}</span>
                {st && <span style={{ fontSize: 12, color: st.col }}>{st.t}</span>}
              </div>
            );
          })}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap', position: 'relative' }}>
          <HelpButton />
          <button type="button" className="icon-btn" aria-label="Einstellungen" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></svg>
          </button>
          <Link to="/" className="cmp-meta" style={{ height: 40, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>Lobby
          </Link>
          {menu && (
            <div className="menu" role="menu" onClick={(e) => { if ((e.target as HTMLElement).closest('button[data-close]')) setMenu(false); }}>
              {online && <div style={{ padding: '6px 8px' }}><AlertToggle /></div>}
              <button type="button" data-close onClick={() => setView3d(!view3d)}>Ansicht: {view3d ? '2D-Karte' : '3D-Karte'}</button>
              {!online && <button type="button" data-close onClick={restart}>Kampagne neu beginnen …</button>}
              <span className="cmp-meta" style={{ padding: '6px 12px', fontSize: 12 }}>{online ? online.name : solo ? `Gegen den Computer (${solo.level})` : 'An einem Gerät'}</span>
            </div>
          )}
        </div>
      </header>

      <div className="cmp-body">
        <div ref={mapBox} className="stage">
          {view3d ? (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <CampaignMap3D {...mapProps} house={h} projector={projector} onCamera={() => (card || popHex) && setCamTick((t) => t + 1)} />
            </div>
          ) : <CampaignMap {...mapProps} svgRef={svgRef} />}

          <div className="row" style={{ position: 'absolute', left: showDrawer ? 352 : 12, top: 12, gap: 8, zIndex: 3 }}>
            <div className="seg" role="group" aria-label="Kartenansicht">
              {[false, true].map((d) => <button key={String(d)} type="button" aria-pressed={view3d === d} onClick={() => setView3d(d)}>{d ? '3D' : '2D'}</button>)}
            </div>
            {!showDrawer && (
              <button type="button" className="map-tool" onClick={() => setDrawer(true)} style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>Lage
              </button>
            )}
          </div>

          {showDrawer && (
            <div className="drawer" role="region" aria-label="Lage">
              <button type="button" className="icon-btn" aria-label="Schließen" onClick={closeDrawer} style={{ position: 'absolute', right: 8, top: 8, zIndex: 1 }}>×</button>
              {panel.kind === 'city'
                ? <CityPanel c={c} prov={panel.prov} house={h} giving={giving} draft={draft} add={add} remove={removeOrder} onBack={() => { setPanel({ kind: 'overview' }); setDrawer(true); }} onBuild={openBuild} />
                : panel.kind === 'hex'
                  ? <HexPanel c={c} hex={panel.hex} house={h} giving={giving} draft={draft} add={add} remove={removeOrder} onBack={() => { setPanel({ kind: 'overview' }); setDrawer(true); }}
                      onCity={(p) => setPanel({ kind: 'city', prov: p })} onBuild={openBuild} />
                  : <>
                      <Overview key={h} c={mapC} house={h} giving={giving} viewer={me ?? (giving ? h : null)} draft={draft} onArmy={(id) => { closeDrawer(); selectArmy(id); }} onAgent={(id) => { closeDrawer(); selectAgent(id); }}
                        onCity={(p) => { setPanel({ kind: 'city', prov: p }); }} />
                      {online && conflictsList}
                      {online && logbook}
                    </>}
            </div>
          )}

          {card && cardPos && conf !== null && (
            <ConflictCard e={card} index={conf} count={explained.length} pos={cardPos}
              onPrev={() => setConf(Math.max(0, conf - 1))}
              onNext={() => (conf + 1 < explained.length ? setConf(conf + 1) : show === 'conflicts' ? finishReveal() : setConf(null))}
              onClose={() => (show === 'conflicts' ? finishReveal() : setConf(null))}
              finalLabel={show === 'conflicts' ? (c.phase === 'battles' ? 'Zu den Schlachten' : 'Weiter') : 'Schließen'} />
          )}

          {buildMode && giving && (
            <div role="status" className="popover" style={{ left: '50%', bottom: 16, transform: 'translateX(-50%)', width: 'min(520px, calc(100% - 32px))', flexDirection: 'row', alignItems: 'center' }}>
              <span style={{ flex: 1 }}>{buildMode.kind === 'build'
                ? <>Wo soll {BUILDINGS[buildMode.b].art === 'einen' ? 'der' : 'die'} <b>{BUILDINGS[buildMode.b].n}</b> stehen? Tippe ein leuchtendes Feld an.</>
                : <>Welche <b>{BUILDINGS[buildMode.b].n}</b> ausbauen? Tippe ein leuchtendes Feld an.</>}</span>
              <button type="button" className="ghost" onClick={() => setBuildMode(null)}>Abbrechen</button>
            </div>
          )}

          {giving && !buildMode && !popHex && (
            <BuildBar c={c} house={h} draft={draft} add={(o) => { if (add(o)) setSite(null); }} remove={removeOrder} site={site} tab={barTab}
              setTab={(t) => { setBarTab(t); setChatOpen(false); if (!t) setSite(null); }} onPick={(p) => { clearSel(); setBuildMode(p); }} onClearSite={() => setSite(null)} shift={showDrawer ? 340 : 0} />
          )}

          {popHex && (
            <section role="dialog" aria-label="Befehl geben" className="popover" style={popStyle}>
              <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                {selArmy
                  ? <span style={{ height: 28, minWidth: 40, padding: '0 8px', borderRadius: 6, background: HOUSES[selArmy.house].color, color: '#FFF8F2', fontWeight: 700, display: 'grid', placeItems: 'center' }}>{selArmy.size}</span>
                  : <span style={{ height: 28, width: 28, borderRadius: 6, background: 'var(--hull-2)', color: 'var(--brass)', display: 'grid', placeItems: 'center' }}>★</span>}
                <div className="stack" style={{ gap: 0, flex: 1, minWidth: 0 }}>
                  <b style={{ fontFamily: 'var(--display)', fontSize: 17, lineHeight: 1.15 }}>{selArmy ? `Heer bei ${hexName(selArmy.hex)}` : `${SPEC_NAME[selAgent!.spec]} bei ${hexName(selAgent!.hex)}`}</b>
                  <span className="cmp-meta">{selArmy ? specText(selArmy) : 'Einzelgänger, meidet feindliche Heere'}</span>
                </div>
                <button type="button" className="icon-btn" aria-label="Auswahl aufheben" onClick={clearSel}>×</button>
              </div>
              {selOrder >= 0 ? (
                <>
                  <span>{describe(c, h, draft[selOrder])}</span>
                  <button type="button" onClick={() => removeOrder(selOrder)}>Befehl zurücknehmen</button>
                </>
              ) : !planning ? (
                <span className="cmp-meta">Alle {ORDERS_PER_ROUND} Befehle dieser Runde sind vergeben.</span>
              ) : mode === 'support' ? (
                <>
                  <span className="cmp-meta">Nachbarfeld antippen: Das Heer zählt dort mit halber Größe.</span>
                  <button type="button" onClick={() => setMode('move')}>Doch ziehen</button>
                </>
              ) : (
                <>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{path.length ? `Weg nach ${hexName(path[path.length - 1])}` : 'Felder antippen, um den Weg zu legen'}</span>
                    <span className="cmp-meta">{pathCost(path)} von {budget}</span>
                  </div>
                  <div className="progress" aria-hidden="true"><i style={{ width: `${Math.min(100, (pathCost(path) / Math.max(1, budget)) * 100)}%` }} /></div>
                  {path.length > 0 && (
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <button type="button" className="primary" style={{ flex: 1, height: 40 }} onClick={() => confirmPath()}>Weg bestätigen</button>
                      <button type="button" aria-label="Schritt zurück" style={{ width: 40, height: 40, padding: 0 }} onClick={() => setPath(path.slice(0, -1))}>↶</button>
                    </div>
                  )}
                  {selArmy && (
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap', borderTop: '1px solid #22344A', paddingTop: 10 }}>
                      <button type="button" style={{ flex: 1 }} onClick={() => { setMode('support'); setPath([]); }}>Unterstützen</button>
                      <button type="button" style={{ flex: 1 }} className={forageWhy ? 'muted' : ''} title={forageWhy || undefined} onClick={() => add({ kind: 'forage', army: selArmy.id })}>Fouragieren +{forage}</button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {show && rv && !(show === 'conflicts' && card) && (
            <div role="status" className="popover" style={{ top: 12, left: '50%', transform: 'translateX(-50%)', width: 'max-content', maxWidth: 'calc(100% - 32px)', flexDirection: 'row', alignItems: 'center', gap: 14, padding: '10px 16px' }}>
              <span style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--brass)' }}>Runde {rv.round}</span>
              <span>{show === 'orders' ? 'Die Befehle werden aufgedeckt.' : show === 'walk' ? `Die Heere ziehen · Schritt ${Math.min(step, walkLen - 1)} von ${walkLen - 1}` : show === 'conflicts' ? `${explained.length === 1 ? 'Ein Konflikt' : `${explained.length} Konflikte`} in dieser Runde.` : 'Alle sind angekommen.'}</span>
              {show === 'orders' && <button type="button" onClick={() => setShow('walk')}>Heere ziehen lassen</button>}
              {show === 'walk' && <button type="button" className="ghost" onClick={() => setShow('settle')}>Überspringen</button>}
            </div>
          )}
        </div>

        <aside className="cmp-side" aria-label="Befehle und Diplomatie">
          <div style={{ flex: online ? 'none' : 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {c.phase === 'battles' && !show && (
              <div className="cmp-sec">
                <h2 className="cmp-h">Schlachten</h2>
                {c.battles.map((b) => {
                  const att = armyById(c, b.attacker)!, def = armyById(c, b.defender)!;
                  return (
                    <div key={b.id} className="stack" style={{ gap: 8, paddingBottom: 12, borderBottom: '1px solid #22344A' }}>
                      <b>{b.field ? 'Feldschlacht' : 'Schlacht'} bei {hexName(b.hex)}</b>
                      <span className="cmp-meta">{HOUSES[att.house].n} {att.size} ({num(b.attStrength)}) gegen {HOUSES[def.house].n} {def.size} ({num(b.defStrength)}) · {LAND[hexLand(b.hex)].n}. {HOUSES[att.house].n} führt die Offiziere.</span>
                      {b.game
                        ? <LinkedBattle gameId={b.game} onOpen={() => nav(`/spiel/${b.game}`)} onTake={(st) => { const out = outcomeOf(st); if (out) apply((p) => (hasBattle(p, b.id) ? applyBattle(p, b.id, out) : p)); }} />
                        : <div className="row" style={{ gap: 8 }}>
                            {!solo && <button type="button" className="primary" onClick={() => boardBattle(b.id)}>Auf dem Brett</button>}
                            <button type="button" className={solo ? 'primary' : ''} onClick={() => apply((p) => (hasBattle(p, b.id) ? autoBattle(p, b.id, Math.random) : p))}>Auswürfeln</button>
                          </div>}
                    </div>
                  );
                })}
              </div>
            )}

            {waitingForOther && !show && !solo && (
              <div className="cmp-sec">
                <h2 className="cmp-h">Befehle versiegelt</h2>
                <span className="cmp-meta">Sobald {online!.names[other] ?? HOUSES[other].n} versiegelt, wird die Runde aufgedeckt.</span>
              </div>
            )}

            {giving && (
              <div className="cmp-sec" style={{ gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h2 className="cmp-h">Deine Befehle</h2>
                  <span className="cmp-meta">{orderCount(draft)} von {ORDERS_PER_ROUND}</span>
                </div>
                {online && c.sealed[other] && <span className="cmp-meta">{HOUSES[other].n} hat versiegelt und wartet auf dich.</span>}
                <div className="stack" style={{ gap: 0 }}>
                  {draft.map((o, i) => (
                    <div key={i} className="order-row">
                      <span className="ico" aria-hidden="true">{orderIcon(o)}</span>
                      <span className="txt">{describe(c, h, o)}</span>
                      <button type="button" className="icon-btn" aria-label="Befehl entfernen" onClick={() => removeOrder(i)}>×</button>
                    </div>
                  ))}
                  {free > 0 && (
                    <div className="order-row" style={{ borderBottom: 0, color: 'var(--muted)', fontSize: 13 }}>
                      <span className="ico" style={{ background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--rope)', color: 'var(--muted)' }}>{free}</span>
                      <span className="txt">{free === 1 ? 'Noch ein Befehl frei' : `Noch ${free === 2 ? 'zwei' : 'drei'} Befehle frei`}</span>
                    </div>
                  )}
                </div>
                {c.round === 1 && !hintSeen && draft.length === 0 && (
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap', fontSize: 13 }}>
                    <span style={{ flex: 1 }}>Tipp: Heer antippen und Felder für den Weg wählen. Alles Weitere steht im Feldbuch.</span>
                    <button type="button" className="icon-btn" aria-label="Tipp ausblenden" onClick={() => { setHintSeen(true); try { localStorage.setItem('deckmate.kampagne.tipp', '1'); } catch { /* ignore */ } }}>×</button>
                  </div>
                )}
                {idle.length > 0 && free > 0 && (
                  <div className="stack" style={{ gap: 6, marginTop: 4 }}>
                    <span className="cmp-cap">Ohne Befehl</span>
                    <div className="row" style={{ gap: 6 }}>
                      {idle.map((a) => <button key={a.id} type="button" className="pill" onClick={() => selectArmy(a.id)}>{hexName(a.hex)} · {a.size}</button>)}
                    </div>
                  </div>
                )}
                <button type="button" className="primary" style={{ height: 48, fontSize: 15, marginTop: 8 }} onClick={seal}>Befehle versiegeln</button>
              </div>
            )}

            {!online && (
              <div className="cmp-sec" style={{ flex: 1 }}>
                {conflictsList}
                {logbook}
              </div>
            )}
          </div>

          {online && (
            <Chat gameId={online.id} me={h} uid={online.uid} name={online.userName} others={(['R', 'K'] as House[]).filter((x) => x !== h)}
              collapsed={chatCollapsed} onExpand={() => setChatOpen(true)} />
          )}
        </aside>
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
            <div style={{ fontSize: 15, color: 'var(--parchment)' }}>von {c.maxRounds} · Ravensmoor {score(c, 'R')} : {score(c, 'K')} Kerrow</div>
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
                <span key={x}><b style={{ color: HOUSES[x].light }}>{HOUSES[x].n}:</b> {goalText(c.goals![x])} {goalMet(c, x) ? <b>Erfüllt, +{GOAL_POINTS} Punkte.</b> : <span className="rule">Nicht erfüllt.</span>}</span>
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
  );
}

function ConflictCard({ e, index, count, pos, onPrev, onNext, onClose, finalLabel }: {
  e: Explanation; index: number; count: number; pos: { x: number; y: number; w: number; h: number };
  onPrev: () => void; onNext: () => void; onClose: () => void; finalLabel: string;
}) {
  const W = 310, gap = 44;
  const roomRight = pos.w - 12 - (pos.x + gap), roomLeft = pos.x - gap - 12;
  const left = roomRight >= W || roomRight >= roomLeft ? Math.min(pos.x + gap, pos.w - 12 - W) : Math.max(12, pos.x - gap - W);
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
