import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../auth.tsx';
import { db } from '../firebase.ts';
import { createCampaign, createGame, deleteGame, isCampaign, joinCampaign, joinGame, parseCampaign, watchLobby, watchMyFinished, type AnyDoc, type CampaignDoc, type GameDoc } from '../online.ts';
import { HOUSES, type House } from '../campaign/map.ts';
import { DEFAULT_OPTIONS, type CampaignOptions } from '../campaign/engine.ts';
import { SIDE_NAME, type Side } from '../game/rules.ts';
import { FeedbackButton } from '../components/Feedback.tsx';

export default function Lobby() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [games, setGames] = useState<AnyDoc[]>([]);
  const [finished, setFinished] = useState<AnyDoc[]>([]);
  const [cName, setCName] = useState('');
  const [cHouse, setCHouse] = useState<House | 'any'>('any');
  const [cOpts, setCOpts] = useState<CampaignOptions>(DEFAULT_OPTIONS);
  const [kind, setKind] = useState<'partie' | 'kampagne'>('partie');
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
  async function createC(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const h: House = cHouse === 'any' ? (Math.random() < 0.5 ? 'R' : 'K') : cHouse;
      nav(`/kampagne/${await createCampaign(user!, cName, h, cOpts)}`);
    } catch (err) { setError(firestoreHint(err)); setBusy(false); }
  }
  const path = (g: AnyDoc) => (isCampaign(g) ? `/kampagne/${g.id}` : `/spiel/${g.id}`);
  async function join(g: AnyDoc) {
    setError('');
    try { if (isCampaign(g)) await joinCampaign(user!, g.id); else await joinGame(user!, g.id); nav(path(g)); } catch (err) { setError((err as Error).message || firestoreHint(err)); }
  }
  async function copyLink(g: AnyDoc) {
    const id = g.id;
    const url = `${location.origin}${path(g)}`;
    try { await navigator.clipboard.writeText(url); setCopied(id); setTimeout(() => setCopied(null), 1800); } catch { prompt('Einladungslink', url); }
  }

  const Row = ({ g, action }: { g: AnyDoc; action: JSX.Element }) => (
    <div className="game-row">
      <div style={{ minWidth: 0 }}>
        <div className="title">{isCampaign(g) && <span className="tag" style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, border: '1px solid var(--brass)', color: 'var(--brass)', marginRight: 6 }}>Kampagne</span>}{(g as GameDoc).campaign && <span className="tag" style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, border: '1px solid var(--rope)', marginRight: 6 }}>Kampagnen-Schlacht</span>}{g.name}</div>
        <div className="crew">
          {isCampaign(g)
            ? (['R', 'K'] as House[]).map((h) => <span key={h}><i className="dot" style={{ background: HOUSES[h].color }} />{HOUSES[h].n}: {g.names[h] ?? <em>frei</em>}</span>)
            : (['M', 'O'] as Side[]).map((s) => <span key={s}><i className={`dot ${s}`} />{SIDE_NAME[s]}: {g.names[s] ?? <em>frei</em>}</span>)}
          <span>{isCampaign(g) ? campaignStatus(g, me) : statusText(g, me)}</span>
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
                    {g.status === 'open' && <button type="button" onClick={() => copyLink(g)}>{copied === g.id ? 'Link kopiert' : 'Einladungslink'}</button>}
                    {g.createdBy === me && (confirmDel === g.id
                      ? <><button type="button" onClick={() => deleteGame(g.id)}>Wirklich löschen</button><button type="button" className="ghost" onClick={() => setConfirmDel(null)}>Abbrechen</button></>
                      : <button type="button" className="ghost" onClick={() => setConfirmDel(g.id)}>Löschen</button>)}
                    <button type="button" className="primary" onClick={() => nav(path(g))}>Öffnen</button>
                  </>} />
                )) : <div className="empty">{loaded ? 'Du hast gerade keine offenen Partien. Lege rechts eine an oder tritt einer bei.' : 'Lade Partien …'}</div>}
              </div>
            </section>
            <section className="card">
              <h2>Offene Partien</h2>
              <div className="game-list">
                {open.length ? open.map((g) => <Row key={g.id} g={g} action={<button type="button" className="primary" onClick={() => join(g)}>Mitspielen</button>} />)
                  : <div className="empty">{loaded ? 'Gerade wartet niemand auf eine Gegenseite.' : 'Lade Partien …'}</div>}
              </div>
            </section>
            {finished.length > 0 && (
              <section className="card">
                <h2>Beendet</h2>
                <div className="game-list">
                  {finished.map((g) => <Row key={g.id} g={g} action={<button type="button" onClick={() => nav(path(g))}>Ansehen</button>} />)}
                </div>
              </section>
            )}
          </div>
          <div className="stack">
            <div className="card stack">
              <h2>Neues Spiel</h2>
              <div className="seg" role="tablist" aria-label="Art" style={{ alignSelf: 'flex-start' }}>
                <button type="button" role="tab" aria-selected={kind === 'partie'} onClick={() => setKind('partie')}>Deckmate-Partie</button>
                <button type="button" role="tab" aria-selected={kind === 'kampagne'} onClick={() => setKind('kampagne')}>Kampagne</button>
              </div>
              {kind === 'partie' ? (
                <form className="stack" onSubmit={create}>
                  <label className="stack" style={{ gap: 4 }}><span className="lbl">Name</span>
                    <input id="gname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wache auf der Tempest" maxLength={60} /></label>
                  <label className="stack" style={{ gap: 4 }}><span className="lbl">Deine Seite</span>
                    <select id="gside" value={side} onChange={(e) => setSide(e.target.value as Side | 'any')}>
                      <option value="any">Zufällig</option><option value="M">Mannschaft</option><option value="O">Offiziere</option>
                    </select></label>
                  <button type="submit" className="primary" disabled={busy}>Partie anlegen</button>
                </form>
              ) : (
                <form className="stack" onSubmit={createC}>
                  <label className="stack" style={{ gap: 4 }}><span className="lbl">Name</span>
                    <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Der Winter von Aldfurt" maxLength={60} /></label>
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <label className="stack" style={{ gap: 4, flex: 1, minWidth: 140 }}><span className="lbl">Dein Haus</span>
                      <select value={cHouse} onChange={(e) => setCHouse(e.target.value as House | 'any')}>
                        <option value="any">Zufällig</option><option value="R">Ravensmoor</option><option value="K">Kerrow</option>
                      </select></label>
                    <label className="stack" style={{ gap: 4, flex: 1, minWidth: 140 }}><span className="lbl">Runden</span>
                      <select value={cOpts.maxRounds} onChange={(e) => setCOpts({ ...cOpts, maxRounds: Number(e.target.value) })}>
                        <option value={6}>6 · kurz</option><option value={10}>10 · normal</option><option value={15}>15 · lang</option>
                      </select></label>
                  </div>
                  <label className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input type="checkbox" style={{ width: 18, height: 18, flex: 'none' }} checked={cOpts.goals} onChange={(e) => setCOpts({ ...cOpts, goals: e.target.checked })} /><span>Geheime Ziele</span></label>
                  <label className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input type="checkbox" style={{ width: 18, height: 18, flex: 'none' }} checked={cOpts.experience} onChange={(e) => setCOpts({ ...cOpts, experience: e.target.checked })} /><span>Erfahrung der Heere</span></label>
                  <button type="submit" className="primary" disabled={busy}>Kampagne anlegen</button>
                </form>
              )}
              <p className="rule" style={{ margin: 0 }}>Danach Einladungslink teilen oder warten, bis jemand beitritt.</p>
            </div>
            <div className="card stack" style={{ gap: 4 }}>
              <h2>Ohne Mitspieler online</h2>
              <Link className="lobby-link" to="/lokal">Partie an einem Gerät<span>›</span></Link>
              <Link className="lobby-link" to="/kampagne">Kampagne an einem Gerät oder gegen den Computer<span>›</span></Link>
              <Link className="lobby-link" to="/schlacht">Kampagnen-Schlacht ausprobieren<span>›</span></Link>
            </div>
            <div className="card stack">
              <h2>Feedback an die Werft</h2>
              <p className="rule" style={{ margin: 0 }}>Wünsche und Kritik landen direkt bei der Entwicklung.</p>
              <FeedbackButton where="lobby" defaultName={user.displayName ?? ''} context={{ Bilanz: `${record.wins} ${record.wins === 1 ? 'Sieg' : 'Siege'}, ${record.losses} ${record.losses === 1 ? 'Niederlage' : 'Niederlagen'}` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function campaignStatus(g: CampaignDoc, me: string) {
  if (g.status === 'open') return 'wartet auf das zweite Haus';
  let c;
  try { c = parseCampaign(g); } catch { return ''; }
  if (g.status === 'over' || c.phase === 'over') return c.winner ? `${HOUSES[c.winner].n} gewann` : 'unentschieden';
  const mine = (['R', 'K'] as House[]).find((h) => g.players[h] === me);
  if (c.phase === 'battles') return `Runde ${c.round} · Schlachten`;
  if (mine && !c.sealed[mine]) return `Runde ${c.round} · deine Befehle`;
  if (mine) return `Runde ${c.round} · warte auf ${HOUSES[mine === 'R' ? 'K' : 'R'].n}`;
  return `Runde ${c.round}`;
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
