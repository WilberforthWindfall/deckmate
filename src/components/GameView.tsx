import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Table3D } from '../three/Table3D.ts';
import type { Action } from '../game/actions.ts';
import {
  CARDS, PIECES, SIDE_NAME, cardBlocker, legalMoves, sqName, type GameState, type Options, type PieceType, type Side,
} from '../game/rules.ts';

interface Props {
  state: GameState;
  /** Side controlled in this browser; null means both (one device). */
  mySide: Side | null;
  names?: Record<Side, string | null>;
  onAction: (a: Action) => Promise<void> | void;
  /** Test scenes: any piece may move regardless of turn, no cards. */
  freeMode?: boolean;
  waiting?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  overActions?: ReactNode;
  onOptions?: (o: Options) => void;
}

const DICE = '⚀⚁⚂⚃⚄⚅';

export default function GameView({ state: st, mySide, names, onAction, freeMode, waiting, header, footer, overActions, onOptions }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const table = useRef<Table3D | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [selCard, setSelCard] = useState<{ side: Side; index: number } | null>(null);
  const [follow, setFollow] = useState(mySide === null);
  const [toast, setToast] = useState('');
  const [hideOver, setHideOver] = useState(false);
  const [sending, setSending] = useState(false);

  const controls = (s: Side) => freeMode || mySide === null || mySide === s;

  const moves = useMemo(() => {
    if (sel === null) return [];
    const p = st.board[sel];
    if (!p || !controls(p.s) || sending) return [];
    return legalMoves(st, sel, !!freeMode);
  }, [st, sel, mySide, freeMode, sending]);

  async function send(a: Action) {
    setSending(true);
    try { await onAction(a); } catch (err) { setToast((err as Error).message || 'Das hat nicht geklappt.'); setTimeout(() => setToast(''), 3200); }
    setSending(false);
  }

  const handlers = useRef({
    onSquare: (_i: number) => {},
    onCard: (side: Side, index: number) => setSelCard({ side, index }),
  });
  handlers.current.onSquare = (i: number) => {
    if (st.fx.shieldPick && controls(st.turn)) {
      const p = st.board[i];
      if (p && p.s === st.turn) send({ type: 'shield', at: i });
      return;
    }
    const m = sel !== null ? moves.find((x) => x.to === i) : undefined;
    if (m) { setSel(null); send({ type: 'move', from: m.from, to: m.to, path: m.path }); return; }
    setSel(st.board[i] ? i : null);
  };

  useEffect(() => {
    if (!host.current) return;
    const t = new Table3D(host.current, {
      onSquare: (i) => handlers.current.onSquare(i),
      onCard: (s, i) => handlers.current.onCard(s, i),
    });
    table.current = t;
    if (mySide) t.face(mySide);
    return () => { t.dispose(); table.current = null; };
  }, []);

  useEffect(() => {
    table.current?.update({ state: st, selected: sel, moves, shieldPick: st.fx.shieldPick && controls(st.turn), selectedCard: selCard });
  });

  useEffect(() => { if (follow && st.phase === 'play') table.current?.face(st.turn); }, [st.turn, st.phase, follow]);
  useEffect(() => { setSel(null); }, [st.v]);
  useEffect(() => { if (st.phase !== 'over') setHideOver(false); }, [st.phase]);
  useEffect(() => { if (selCard && !st.hands[selCard.side][selCard.index]) setSelCard(null); }, [st.hands, selCard]);

  const p = sel !== null ? st.board[sel] : null;
  const caps = moves.filter((m) => m.cap.length).length;
  const mustCap = p && !freeMode && moves.length && moves.every((m) => m.cap.length) && caps > 0;
  const nameOf = (s: Side) => names?.[s] ?? SIDE_NAME[s];
  const myTurn = mySide === null || st.turn === mySide;

  const chips: string[] = [];
  if (st.fx.noPflicht) chips.push('Keine Schlagpflicht');
  if (st.fx.retreat) chips.push('Böe: 1 Feld in jede Richtung');
  if (st.fx.shieldPick) chips.push('Figur für Ehrenwache wählen');
  (['M', 'O'] as Side[]).forEach((s) => { if (st.fx.skip[s]) chips.push(`${SIDE_NAME[s]} setzen nächsten Zug aus`); });
  st.board.forEach((q) => { if (q?.shielded) chips.push(`${PIECES[q.t].n} unter Ehrenwache`); });

  const turnTitle = freeMode ? 'Testszene'
    : st.phase === 'setup' ? 'Vor dem Ablegen'
    : st.phase === 'over' ? `${SIDE_NAME[st.winner!]} gewinnen`
    : mySide === null ? `${SIDE_NAME[st.turn]} am Zug`
    : myTurn ? 'Du bist am Zug' : `${nameOf(st.turn)} ist am Zug`;
  const turnSub = freeMode ? 'Freies Ziehen ohne Zugreihenfolge'
    : st.phase === 'setup' ? 'Wählt, welche Seite beginnt'
    : st.phase === 'over' ? st.winReason ?? ''
    : `Zug ${st.moveNo}${st.fx.played ? ' · Karte gespielt' : ''}`;
  const turnDot = st.phase === 'over' ? st.winner : st.phase === 'play' && !freeMode ? st.turn : null;

  const card = selCard ? st.hands[selCard.side][selCard.index] : undefined;
  const cardWhy = card && selCard ? (freeMode ? 'In Testszenen gibt es keine Karten.' : !controls(selCard.side) ? 'Das ist eine Karte der Gegenseite.' : cardBlocker(st, selCard.side, card)) : '';

  return (
    <div className="app">
      <div className="stage" ref={host}>
        <div className="hud"><h1>Deckmate</h1><span>Ziehen zum Drehen · Mausrad zum Zoomen</span></div>
        {toast && <div className="toast" role="alert">{toast}</div>}
        <div className="viewbtns">
          <button type="button" onClick={() => table.current?.face('M')}>Mannschaft</button>
          <button type="button" onClick={() => table.current?.face('O')}>Offiziere</button>
          <button type="button" onClick={() => table.current?.topDown()}>Draufsicht</button>
          <button type="button" aria-label="Näher heran" onClick={() => table.current?.zoom(-1.5)}>+</button>
          <button type="button" aria-label="Weiter weg" onClick={() => table.current?.zoom(1.5)}>−</button>
        </div>
        {waiting && <div className="overlay"><div className="dialog">{waiting}</div></div>}
        {!waiting && !freeMode && st.phase === 'setup' && (
          <div className="overlay"><div className="dialog">
            <h2>Wer sticht zuerst in See?</h2>
            <p>Jede Seite hat zwei Karten erhalten. Sie liegen vor ihr auf dem Tisch. Pro Zug darf vor dem Ziehen eine Karte gespielt werden.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" disabled={sending} onClick={() => send({ type: 'start', first: 'M' })}>Mannschaft beginnt</button>
              <button type="button" disabled={sending} onClick={() => send({ type: 'start', first: 'O' })}>Offiziere beginnen</button>
              <button type="button" className="primary" disabled={sending} onClick={() => send({ type: 'start', first: 'roll' })}>Würfeln lassen</button>
            </div>
          </div></div>
        )}
        {!freeMode && st.phase === 'over' && !hideOver && (
          <div className="overlay"><div className="dialog">
            <h2>{mySide === null ? `${SIDE_NAME[st.winner!]} gewinnen` : st.winner === mySide ? 'Sieg!' : 'Niederlage'}</h2>
            <p>{st.winReason} Die Partie dauerte {st.moveNo - 1} Züge.</p>
            <div className="row" style={{ justifyContent: 'center' }}>{overActions}<button type="button" onClick={() => setHideOver(true)}>Brett ansehen</button></div>
          </div></div>
        )}
      </div>

      <aside className="panel">
        {header}
        <div className="card">
          <div className="turn">
            <span className={`dot ${turnDot ?? ''}`} style={turnDot ? undefined : { background: freeMode ? 'var(--brass)' : 'var(--muted)' }} />
            <div><div className="who">{turnTitle}</div><div className="sub">{turnSub}</div></div>
          </div>
          {chips.length > 0 && !freeMode && <div className="fx">{chips.map((c) => <span key={c}>{c}</span>)}</div>}
        </div>

        {st.pending && (
          <div className="card promo">
            {st.pending.kind === 'promoM' ? <>
              <h2>Beförderung auf {sqName(st.pending.at)}</h2>
              <div className="rule">Pasch ergibt einen Turm (schwarz), kein Pasch einen Läufer (weiß).</div>
              {controls('M') ? <div className="row" style={{ marginTop: 10 }}><button type="button" className="primary" disabled={sending} onClick={() => send({ type: 'roll' })}>Würfeln</button></div>
                : <div className="warn" style={{ marginTop: 8 }}>Die Mannschaft würfelt.</div>}
            </> : <>
              <h2>Umwandlung auf {sqName(st.pending.at)}</h2>
              <div className="rule">Der Infanterist hat Reihe 1 erreicht.</div>
              {controls('O') ? <div className="row" style={{ marginTop: 10 }}>{(['CAP', 'KAN', 'KAP', 'MAR'] as PieceType[]).map((t) =>
                <button key={t} type="button" disabled={sending} onClick={() => send({ type: 'convert', t })}>{PIECES[t].n}</button>)}</div>
                : <div className="warn" style={{ marginTop: 8 }}>Die Offiziere wählen die neue Figur.</div>}
            </>}
          </div>
        )}
        {st.lastDice && <div className="card"><div className="lbl">Letzter Wurf</div><div className="dice">{DICE[st.lastDice[0] - 1]} {DICE[st.lastDice[1] - 1]}</div></div>}

        {!freeMode && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="lbl">Karten auf dem Tisch</div>
            {(['O', 'M'] as Side[]).map((s) => (
              <div key={s} className="stack" style={{ gap: 6 }}>
                <div className={`side ${s}`}>{nameOf(s)}{mySide === s ? ' (du)' : ''}</div>
                <div className="row">{st.hands[s].length ? st.hands[s].map((k, i) => (
                  <button key={i} type="button" className={`chip${selCard?.side === s && selCard.index === i ? ' on' : ''}`} onClick={() => setSelCard({ side: s, index: i })}>
                    <i style={{ background: s === 'M' ? 'var(--coral)' : 'var(--navy)' }} />{CARDS[k].t}
                  </button>)) : <span className="rule">Keine Karten</span>}</div>
              </div>
            ))}
          </div>
        )}
        {card && selCard && (
          <div className="card">
            <h2>{CARDS[card].t}</h2>
            <div className={`side ${selCard.side}`}>Karte der {SIDE_NAME[selCard.side]}</div>
            <div className="story">{CARDS[card][selCard.side]}</div>
            <div>{CARDS[card].e}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className={cardWhy ? 'muted' : 'primary'} disabled={sending} onClick={() => { if (!cardWhy) { send({ type: 'card', side: selCard.side, index: selCard.index }); setSelCard(null); } }}>Karte ausspielen</button>
            </div>
            {cardWhy && <div className="warn" style={{ marginTop: 8 }}>{cardWhy}</div>}
          </div>
        )}

        <div className="card">
          {st.fx.shieldPick && controls(st.turn) ? <>
            <h2>Ehrenwache</h2><div className="rule">Klicke eine Figur der {SIDE_NAME[st.turn]} an. Sie ist bis zum Ende des nächsten gegnerischen Zugs geschützt.</div>
          </> : p ? <>
            <h2>{PIECES[p.t].n}</h2>
            <div className={`side ${p.s}`} style={{ marginBottom: 8 }}>{SIDE_NAME[p.s]} · Feld {sqName(sel!)}{p.shielded ? ' · unter Ehrenwache' : ''}</div>
            <div className="rule">{PIECES[p.t].r}</div>
            <div className="count">{moves.length} legale Züge, davon {caps} Schläge</div>
            {!freeMode && st.phase === 'play' && p.s !== st.turn && <div className="warn" style={{ marginTop: 8 }}>Die {SIDE_NAME[p.s]} sind nicht am Zug.</div>}
            {!freeMode && mySide && p.s !== mySide && p.s === st.turn && <div className="warn" style={{ marginTop: 8 }}>Das ist eine Figur der Gegenseite.</div>}
            {mustCap ? <div className="warn" style={{ marginTop: 8 }}>Schlagpflicht aktiv.</div> : null}
          </> : <>
            <h2>Figur wählen</h2>
            <div className="rule">Klicke eine Figur an. Blaue Punkte zeigen Züge, rote Ringe Schläge. Fahre über ein Schlagziel, um den Serienpfad zu sehen. Karten auf dem Tisch lassen sich ebenfalls anklicken.</div>
          </>}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="lbl">Einstellungen</div>
          {onOptions ? <>
            <label className="opt"><input type="checkbox" checked={st.options.mPflicht} onChange={(e) => onOptions({ ...st.options, mPflicht: e.target.checked })} /> Schlagpflicht auch für die Mannschaft (Dame-Regel)</label>
            <label className="opt"><input type="checkbox" checked={st.options.sideFirst} onChange={(e) => onOptions({ ...st.options, sideFirst: e.target.checked })} /> Seitlicher Schlag als erster Schlag erlaubt</label>
          </> : <div className="rule">Schlagpflicht Mannschaft: {st.options.mPflicht ? 'ja' : 'nein'} · Seitlicher Erstschlag: {st.options.sideFirst ? 'ja' : 'nein'}</div>}
          <label className="opt"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Kamera dreht zur Seite, die am Zug ist</label>
        </div>
        <div className="legend">
          <span><i style={{ background: 'var(--mark)', borderRadius: '50%' }} />Zug</span>
          <span><i style={{ border: '2px solid var(--hit)', borderRadius: '50%', boxSizing: 'border-box' }} />Schlag</span>
          <span><i style={{ background: 'var(--brass)' }} />Serienpfad</span>
        </div>
        {footer}
        <div className="stack" style={{ gap: 6 }}>
          <div className="lbl">Logbuch</div>
          <div className="log">{st.log.length ? st.log.slice(0, 12).map((l, i) => <div key={i}>{l}</div>) : <div>Noch keine Züge.</div>}</div>
        </div>
      </aside>
    </div>
  );
}
