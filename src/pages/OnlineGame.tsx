import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import GameView from '../components/GameView.tsx';
import { useAuth } from '../auth.tsx';
import { joinGame, rematch, sendAction, watchGame, type GameDoc } from '../online.ts';
import { SIDE_NAME, type Side } from '../game/rules.ts';
import { firestoreHint } from './Lobby.tsx';
import { AlertToggle, useTurnAlert } from '../components/turnAlert.tsx';

export default function OnlineGame() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [game, setGame] = useState<GameDoc | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);

  useEffect(() => watchGame(id, setGame, (e) => setError(firestoreHint(e))), [id]);
  const meSide = game && user ? (['M', 'O'] as Side[]).find((s) => game.players[s] === user.uid) ?? null : null;
  const full = !!(game?.players.M && game?.players.O);
  const turnNeed = !game || !meSide ? null
    : !full ? null
    : game.state.phase === 'over' ? 'Partie beendet'
    : game.state.phase === 'setup' ? null
    : game.state.turn === meSide ? 'Du bist am Zug' : null;
  useTurnAlert(turnNeed, game?.name ?? 'Partie');

  if (!user) return null;
  if (error) return <Message title="Partie nicht erreichbar" text={error} />;
  if (game === undefined) return <Message title="Lade Partie …" text="" />;
  if (game === null) return <Message title="Diese Partie gibt es nicht mehr" text="Vielleicht wurde sie gelöscht." />;

  const mySide = (['M', 'O'] as Side[]).find((s) => game.players[s] === user.uid) ?? null;
  const free = (['M', 'O'] as Side[]).find((s) => !game.players[s]);

  if (!mySide) {
    return (
      <div className="page"><div className="page-inner"><div className="card stack login">
        <h2>{game.name}</h2>
        {free ? <>
          <p className="rule" style={{ margin: 0 }}>{game.names[free === 'M' ? 'O' : 'M']} lädt dich ein. Du spielst die {SIDE_NAME[free]}.</p>
          <div className="row">
            <button type="button" className="primary" disabled={joining} onClick={async () => { setJoining(true); try { await joinGame(user, id); } catch (e) { setError((e as Error).message); } setJoining(false); }}>Mitspielen</button>
            <Link to="/"><button type="button" className="ghost">Zur Lobby</button></Link>
          </div>
        </> : <>
          <p className="rule" style={{ margin: 0 }}>Diese Partie ist bereits voll.</p>
          <Link to="/"><button type="button">Zur Lobby</button></Link>
        </>}
      </div></div></div>
    );
  }

  const opponent = mySide === 'M' ? 'O' : 'M';
  const inviteUrl = `${location.origin}/spiel/${id}`;
  async function copy() {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { prompt('Einladungslink', inviteUrl); }
  }

  const waiting = !game.players[opponent] ? (
    <>
      <h2>Warte auf die Gegenseite</h2>
      <p>Du spielst die {SIDE_NAME[mySide]}. Schick den Link an deinen Gegner, oder warte, bis jemand aus der Lobby beitritt.</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button type="button" className="primary" onClick={copy}>{copied ? 'Link kopiert' : 'Einladungslink kopieren'}</button>
        <Link to="/"><button type="button">Zur Lobby</button></Link>
      </div>
      <p style={{ fontSize: 12, wordBreak: 'break-all' }}>{inviteUrl}</p>
    </>
  ) : undefined;

  return (
    <GameView
      state={game.state}
      mySide={mySide}
      names={game.names}
      waiting={waiting}
      onAction={(a) => sendAction(user, id, a)}
      feedback={{ name: user.displayName ?? undefined, context: { Partie: game.name, 'Partie-ID': id, Kampagne: game.campaign?.id ?? null } }}
      header={
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>{game.campaign ? <Link to={`/kampagne/${game.campaign.id}`}>← Zur Kampagne</Link> : <Link to="/">← Zur Lobby</Link>}<span className="rule">{game.name}</span></div>
          <div className="players">
            {(['M', 'O'] as Side[]).map((s) => <div key={s}><i className={`dot ${s}`} /><b>{game.names[s] ?? 'frei'}</b>{s === mySide && <span className="rule">(du)</span>}</div>)}
          </div>
          <AlertToggle />
        </div>
      }
      footer={game.state.phase === 'play' ? (
        <div className="row">
          {confirmResign
            ? <><button type="button" onClick={() => sendAction(user, id, { type: 'resign', side: mySide })}>Wirklich aufgeben</button><button type="button" className="ghost" onClick={() => setConfirmResign(false)}>Weiterspielen</button></>
            : <button type="button" className="ghost" onClick={() => setConfirmResign(true)}>{mySide === 'M' ? 'Mannschaft ergibt sich' : 'Flagge streichen'}</button>}
        </div>
      ) : undefined}
      overActions={game.campaign ? <>
        <Link to={`/kampagne/${game.campaign.id}`}><button type="button" className="primary">Zurück zur Kampagne – Ergebnis übernehmen</button></Link>
      </> : <>
        <button type="button" className="primary" onClick={async () => nav(`/spiel/${await rematch(user, game)}`)}>Revanche mit getauschten Seiten</button>
        <Link to="/"><button type="button">Zur Lobby</button></Link>
      </>}
    />
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return <div className="page"><div className="page-inner"><div className="card stack login"><h2>{title}</h2>{text && <p className="rule" style={{ margin: 0 }}>{text}</p>}<Link to="/">Zur Lobby</Link></div></div></div>;
}
