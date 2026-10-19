import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../auth.tsx';
import { db } from '../firebase.ts';
import { createGame, deleteGame, joinGame, watchLobby, watchMyFinished, type GameDoc } from '../online.ts';
import { SIDE_NAME, type Side } from '../game/rules.ts';

export default function Lobby() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [games, setGames] = useState<GameDoc[]>([]);
  const [finished, setFinished] = useState<GameDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [side, setSide] = useState<Side | 'any'>('any');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [record, setRecord] = useState({ wins: 0, losses: 0 });

  useEffect(() => watchLobby((g) => { setGames(g); setLoaded(true); }, (e) => { setError(firestoreHint(e)); setLoaded(true); }), []);
  useEffect(() => (user ? watchMyFinished(user.uid, setFinished) : undefined), [user]);
  useEffect(() => (user ? onSnapshot(doc(db, 'users', user.uid), (s) => { const d = s.data(); if (d) setRecord({ wins: d.wins ?? 0, losses: d.losses ?? 0 }); }, () => {}) : undefined), [user]);

  if (!user) return null;
  const me = user.uid;
  const mine = games.filter((g) => g.members.includes(me));
  const open = games.filter((g) => !g.members.includes(me) && g.status === 'open');

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const s: Side = side === 'any' ? (Math.random() < 0.5 ? 'M' : 'O') : side;
      const id = await createGame(user!, name, s);
      nav(`/spiel/${id}`);
    } catch (err) { setError(firestoreHint(err)); setBusy(false); }
  }
  async function join(id: string) {
    setError('');
    try { await joinGame(user!, id); nav(`/spiel/${id}`); } catch (err) { setError((err as Error).message || firestoreHint(err)); }
  }
  async function copyLink(id: string) {
    const url = `${location.origin}/spiel/${id}`;
    try { await navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(null), 1800); } catch { prompt('Einladungslink', url); }
  }

  const Row = ({ g, action }: { g: GameDoc; action: JSX.Element }) => (
    <div className="game-row">
      <div style={{ minWidth: 0 }}>
        <div className="title">{g.name}</div>
        <div className="crew">
          {(['M', 'O'] as Side[]).map((s) => <span key={s}><i className={`dot ${s}`} />{SIDE_NAME[s]}: {g.names[s] ?? <em>frei</em>}</span>)}
          <span>{statusText(g, me)}</span>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>{action}</div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-inner">
        <div className="brand">
          <div><h1>Deckmate</h1><p>Willkommen an Bord, {user.displayName ?? 'Seefahrer'}.</p></div>
          <div className="row"><span className="rule stat">{record.wins} Siege · {record.losses} Niederlagen</span><button type="button" onClick={logout}>Abmelden</button></div>
        </div>
        {error && <ErrorBox text={error} />}
        <div className="lobby">
          <div className="stack">
            <section className="card">
              <h2>Deine Partien</h2>
              <div className="game-list">
                {mine.length ? mine.map((g) => (
                  <Row key={g.id} g={g} action={<>
                    {g.status === 'open' && <button type="button" onClick={() => copyLink(g.id)}>{copied === g.id ? 'Link kopiert' : 'Einladungslink'}</button>}
                    {g.createdBy === me && (confirmDel === g.id
                      ? <><button type="button" onClick={() => deleteGame(g.id)}>Wirklich löschen</button><button type="button" className="ghost" onClick={() => setConfirmDel(null)}>Abbrechen</button></>
                      : <button type="button" className="ghost" onClick={() => setConfirmDel(g.id)}>Löschen</button>)}
                    <button type="button" className="primary" onClick={() => nav(`/spiel/${g.id}`)}>Öffnen</button>
                  </>} />
                )) : <div className="empty">{loaded ? 'Du hast gerade keine offenen Partien. Lege rechts eine an oder tritt einer bei.' : 'Lade Partien …'}</div>}
              </div>
            </section>
            <section className="card">
              <h2>Offene Partien</h2>
              <div className="game-list">
                {open.length ? open.map((g) => <Row key={g.id} g={g} action={<button type="button" className="primary" onClick={() => join(g.id)}>Mitspielen</button>} />)
                  : <div className="empty">{loaded ? 'Gerade wartet niemand auf eine Gegenseite.' : 'Lade Partien …'}</div>}
              </div>
            </section>
            {finished.length > 0 && (
              <section className="card">
                <h2>Beendet</h2>
                <div className="game-list">
                  {finished.map((g) => <Row key={g.id} g={g} action={<button type="button" onClick={() => nav(`/spiel/${g.id}`)}>Ansehen</button>} />)}
                </div>
              </section>
            )}
          </div>
          <div className="stack">
            <form className="card stack" onSubmit={create}>
              <h2>Neue Partie</h2>
              <label className="stack" style={{ gap: 4 }}><span className="lbl">Name</span>
                <input id="gname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wache auf der Tempest" maxLength={60} /></label>
              <label className="stack" style={{ gap: 4 }}><span className="lbl">Deine Seite</span>
                <select id="gside" value={side} onChange={(e) => setSide(e.target.value as Side | 'any')}>
                  <option value="any">Zufällig</option><option value="M">Mannschaft</option><option value="O">Offiziere</option>
                </select></label>
              <button type="submit" className="primary" disabled={busy}>Partie anlegen</button>
              <p className="rule" style={{ margin: 0 }}>Danach kannst du einen Einladungslink teilen oder warten, bis jemand aus der Lobby beitritt.</p>
            </form>
            <div className="card stack">
              <h2>An einem Gerät</h2>
              <p className="rule" style={{ margin: 0 }}>Beide Seiten spielen abwechselnd am selben Bildschirm. Mit Testszenen zum Prüfen der Regeln.</p>
              <Link to="/lokal"><button type="button">Lokale Partie öffnen</button></Link>
            </div>
            <div className="card stack">
              <h2>Kampagnen-Schlacht</h2>
              <p className="rule" style={{ margin: 0 }}>Prototyp: Zwei Heere aus dem Kampagnenmodus treffen sich auf dem Brett. Heere und Gelände wählen, aufstellen, kämpfen.</p>
              <Link to="/schlacht"><button type="button">Schlacht ausprobieren</button></Link>
            </div>
            <div className="card stack">
              <h2>Kampagne um Eridanos</h2>
              <p className="rule" style={{ margin: 0 }}>Prototyp an einem Gerät: Ravensmoor gegen Kerrow auf der Hexkarte. Geheime Befehle reihum, knappe Kämpfe als Deckmate-Schlacht.</p>
              <Link to="/kampagne"><button type="button" className="primary">Kampagne spielen</button></Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function statusText(g: GameDoc, me: string) {
  if (g.status === 'open') return 'wartet auf Gegenseite';
  if (g.status === 'over') return g.state.winner ? `${SIDE_NAME[g.state.winner]} gewannen` : 'beendet';
  if (g.state.phase === 'setup') return 'vor dem Ablegen';
  const turnUid = g.players[g.state.turn];
  return turnUid === me ? 'du bist am Zug' : `${SIDE_NAME[g.state.turn]} am Zug`;
}

function ErrorBox({ text }: { text: string }) {
  const m = text.match(/https:\/\/console\.firebase\.google\.com\S+/);
  if (!m) return <div className="card error">{text}</div>;
  const [before] = text.split(m[0]);
  return (
    <div className="card error">
      {before.trim()} <a href={m[0]} target="_blank" rel="noreferrer">Index in Firebase anlegen</a>
      <div style={{ fontSize: '0.85em', opacity: 0.8, marginTop: 4 }}>Danach 1–5 Minuten warten, bis der Index „Aktiviert“ ist, und die Seite neu laden.</div>
    </div>
  );
}

export function firestoreHint(err: unknown) {
  const code = (err as { code?: string })?.code ?? '';
  const msg = (err as Error)?.message ?? '';
  console.error('[Deckmate] Firestore-Fehler', code, msg);
  if (code === 'permission-denied') return 'Kein Zugriff auf die Datenbank. Die Firestore-Sicherheitsregeln müssen noch veröffentlicht werden.';
  if (code === 'failed-precondition') {
    const link = msg.match(/https:\/\/console\.firebase\.google\.com\S+/)?.[0];
    if (link?.includes('create_composite')) return `Firestore braucht noch einen Index. ${link}`;
    if (/index/i.test(msg) && /build/i.test(msg)) return 'Der Firestore-Index wird gerade noch aufgebaut. Bitte in ein paar Minuten neu laden.';
    return `Firestore braucht noch einen Index. ${link ?? ''}`.trim();
  }
  if (code === 'unavailable') return 'Keine Verbindung zur Datenbank. Prüfe dein Internet.';
  return (err as Error)?.message || 'Das hat nicht geklappt.';
}
