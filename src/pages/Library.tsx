import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase.ts';
import { useAuth } from '../auth.tsx';
import { Table3D } from '../three/Table3D.ts';
import { readFrame } from '../game/replay.ts';
import { newGame, SIDE_NAME, type GameState, type Side } from '../game/rules.ts';
import { deleteLocal, entryOf, localLibrary, type LibraryEntry } from '../library.ts';
import { isCampaign, watchMyFinished, type GameDoc } from '../online.ts';

const when = (t: number) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** List of finished games: online games of the signed-in player plus games played on this device. */
export function LibraryList() {
  const { user } = useAuth();
  const [online, setOnline] = useState<LibraryEntry[]>([]);
  const [local, setLocal] = useState<LibraryEntry[]>(() => localLibrary());
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => (user ? watchMyFinished(user.uid, (games) => setOnline(games.filter((g) => !isCampaign(g)).map((g) => {
    const d = g as GameDoc;
    return entryOf(d.id, d.name, d.state, d.names, 'online', d.createdAt?.toMillis() ?? 0);
  })), 50) : undefined), [user]);

  const Row = ({ e }: { e: LibraryEntry }) => (
    <div className="lib-row">
      <div style={{ minWidth: 0 }}>
        <div className="title">{e.name}</div>
        <div className="rule" style={{ fontSize: 12 }}>
          {e.at ? `${when(e.at)} · ` : ''}{e.names.M ?? 'Mannschaft'} gegen {e.names.O ?? 'Offiziere'} · {e.winner ? `${SIDE_NAME[e.winner]} gewannen` : 'ohne Sieger'} · {e.moves} Züge
          {!e.replay.length && ' · nur Logbuch (vor der Aufzeichnung gespielt)'}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', flex: 'none' }}>
        {e.where === 'lokal' && (confirm === e.id
          ? <><button type="button" onClick={() => { deleteLocal(e.id); setLocal(localLibrary()); setConfirm(null); }}>Wirklich löschen</button><button type="button" className="ghost" onClick={() => setConfirm(null)}>Abbrechen</button></>
          : <button type="button" className="ghost" onClick={() => setConfirm(e.id)}>Löschen</button>)}
        <Link to={`/bibliothek/${e.where}/${e.id}`}><button type="button" className="primary">Nachspielen</button></Link>
      </div>
    </div>
  );

  return (
    <div className="page"><div className="page-inner">
      <div className="brand">
        <div><h1>Bibliothek</h1><p>Beendete Partien Zug für Zug nachspielen und daraus lernen.</p></div>
        <Link to="/"><button type="button">Zur Lobby</button></Link>
      </div>
      <div className="stack">
        <section className="card">
          <h2>Online gespielt</h2>
          {!user ? <div className="empty">Melde dich an, um deine Online-Partien zu sehen.</div>
            : online.length ? online.map((e) => <Row key={e.id} e={e} />) : <div className="empty">Noch keine beendete Online-Partie.</div>}
        </section>
        <section className="card">
          <h2>An diesem Gerät gespielt</h2>
          {local.length ? local.map((e) => <Row key={e.id} e={e} />) : <div className="empty">Noch keine beendete Partie an diesem Gerät. Sie landen hier automatisch, sobald eine Partie endet.</div>}
        </section>
      </div>
    </div></div>
  );
}

/** Builds a board state from a replay frame that the 3D table can show. */
function frameState(frames: string[], i: number): GameState {
  const f = readFrame(frames[i]);
  const st = newGame(() => 0, { mPflicht: false, sideFirst: true });
  st.board = f.board; st.phase = 'play'; st.turn = f.turn; st.moveNo = f.moveNo;
  st.hands = { M: [], O: [] }; st.v = i; st.log = [];
  const p = f.last ? f.board[f.last[1]] : null;
  st.lastMove = f.last && p ? { from: f.last[0], to: f.last[1], path: [f.last[1]], cap: [], t: p.t, s: p.s } : null;
  return st;
}

export function Replay() {
  const { where = 'lokal', id = '' } = useParams();
  const { user } = useAuth();
  const [entry, setEntry] = useState<LibraryEntry | null | undefined>(undefined);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const table = useRef<Table3D | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (where === 'lokal') { setEntry(localLibrary().find((e) => e.id === id) ?? null); return; }
    if (!user) return;
    getDoc(doc(db, 'games', id)).then((s) => {
      if (!s.exists()) { setEntry(null); return; }
      const g = { id: s.id, ...s.data() } as GameDoc;
      setEntry(entryOf(g.id, g.name, g.state, g.names, 'online', g.createdAt?.toMillis() ?? 0));
    }).catch(() => setEntry(null));
  }, [where, id, user]);

  const frames = entry?.replay ?? [];
  const last = Math.max(0, frames.length - 1);
  const state = useMemo(() => (frames.length ? frameState(frames, Math.min(i, last)) : null), [frames, i, last]);
  const shown = state ? readFrame(frames[Math.min(i, last)]).recordLen : entry?.record.length ?? 0;

  useEffect(() => {
    if (!host.current || !frames.length) return;
    const t = new Table3D(host.current, { onSquare: () => {}, onCard: () => {} });
    table.current = t;
    return () => { t.dispose(); table.current = null; };
  }, [frames.length > 0]);
  useEffect(() => { if (state) table.current?.update({ state, selected: null, moves: [], shieldPick: false, selectedCard: null }); }, [state]);
  useEffect(() => {
    if (!playing) return;
    if (i >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setI((x) => Math.min(last, x + 1)), 1100);
    return () => clearTimeout(t);
  }, [playing, i, last]);
  useEffect(() => {
    const el = logRef.current?.querySelector('.latest') as HTMLElement | null;
    if (el && logRef.current) logRef.current.scrollTop = el.offsetTop - logRef.current.clientHeight / 2;
  }, [shown]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => Math.min(last, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [last]);

  if (entry === undefined) return <div className="page"><div className="page-inner"><p className="rule">Lade Partie …</p></div></div>;
  if (entry === null) return <div className="page"><div className="page-inner"><div className="card stack login"><h2>Partie nicht gefunden</h2><Link to="/bibliothek">Zur Bibliothek</Link></div></div></div>;

  const nameOf = (s: Side) => entry.names[s] ?? SIDE_NAME[s];
  return (
    <div className="app">
      <div className="stage" ref={host}>
        <div className="hud"><h1>Deckmate</h1></div>
        {!frames.length && <div className="overlay"><div className="dialog"><h2>Keine Aufzeichnung</h2><p>Diese Partie wurde vor der Aufzeichnung gespielt. Das Logbuch rechts enthält alle Züge.</p></div></div>}
        {frames.length > 0 && <div className="viewbtns">
          <button type="button" onClick={() => table.current?.face('M')}>Mannschaft</button>
          <button type="button" onClick={() => table.current?.face('O')}>Offiziere</button>
          <button type="button" onClick={() => table.current?.topDown()}>Draufsicht</button>
        </div>}
      </div>
      <aside className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}><Link to="/bibliothek">← Bibliothek</Link><span className="rule">{entry.where === 'lokal' ? 'an diesem Gerät' : 'online'}</span></div>
        <div className="card">
          <h2>{entry.name}</h2>
          <div className="rule"><span className="side M">{nameOf('M')}</span> gegen <span className="side O">{nameOf('O')}</span></div>
          <div className="rule" style={{ marginTop: 4 }}>{entry.winner ? `${SIDE_NAME[entry.winner]} gewannen` : 'ohne Sieger'}{entry.winReason ? ` – ${entry.winReason}` : ''} · {entry.moves} Züge</div>
        </div>
        {frames.length > 0 && (
          <div className="card stack" style={{ gap: 10 }}>
            <div className="lbl">Schritt {Math.min(i, last) + 1} von {frames.length} · Zug {state?.moveNo}</div>
            <div className="replay-bar">
              <button type="button" aria-label="Zum Anfang" onClick={() => { setPlaying(false); setI(0); }}>⏮</button>
              <button type="button" aria-label="Zurück" onClick={() => { setPlaying(false); setI((x) => Math.max(0, x - 1)); }}>◀</button>
              <button type="button" className="primary" onClick={() => { if (i >= last) setI(0); setPlaying((p) => !p); }}>{playing ? 'Pause' : 'Abspielen'}</button>
              <button type="button" aria-label="Weiter" onClick={() => { setPlaying(false); setI((x) => Math.min(last, x + 1)); }}>▶</button>
              <button type="button" aria-label="Zum Ende" onClick={() => { setPlaying(false); setI(last); }}>⏭</button>
            </div>
            <div className="replay-bar"><input type="range" min={0} max={last} value={Math.min(i, last)} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} aria-label="Schritt wählen" /></div>
            <div className="rule" style={{ fontSize: 12 }}>Pfeiltasten ← → blättern Schritt für Schritt. Ein Klick auf eine Zeile im Logbuch springt dorthin.</div>
          </div>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <div className="lbl">Logbuch</div>
          <div className="log full" ref={logRef} style={{ maxHeight: 420 }}>
            {entry.record.map((l, k) => {
              const target = frames.findIndex((f) => readFrame(f).recordLen > k);
              return <div key={k} className={k === shown - 1 ? 'latest' : undefined} style={{ cursor: target >= 0 ? 'pointer' : undefined, opacity: k < shown ? 1 : 0.45 }}
                onClick={() => { if (target >= 0) { setPlaying(false); setI(target); } }}>{l}</div>;
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
