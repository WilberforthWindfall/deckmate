import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { commitCampaign, joinCampaign, parseCampaign, startCampaignBattle, watchCampaign, type CampaignDoc } from '../online.ts';
import { HOUSES, type House } from '../campaign/map.ts';
import type { Campaign as CampaignState } from '../campaign/engine.ts';
import Campaign, { type OnlineSession } from './Campaign.tsx';
import { firestoreHint } from './Lobby.tsx';

// Online campaign for two players: each plays one house on their own device. Orders are given at the same time;
// whoever seals last resolves the round in a transaction.

export default function OnlineCampaign() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [g, setG] = useState<CampaignDoc | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => watchCampaign(id, setG, (e) => setError(firestoreHint(e))), [id]);
  const c = useMemo<CampaignState | null>(() => (g ? parseCampaign(g) : null), [g?.cstate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;
  if (error) return <Message title="Kampagne nicht erreichbar" text={error} />;
  if (g === undefined) return <Message title="Lade Kampagne …" text="" />;
  if (g === null || !c) return <Message title="Diese Kampagne gibt es nicht" text="Vielleicht wurde sie gelöscht." />;

  const me = (['R', 'K'] as House[]).find((h) => g.players[h] === user.uid) ?? null;
  const free = (['R', 'K'] as House[]).find((h) => !g.players[h]);
  const inviteUrl = `${location.origin}/kampagne/${id}`;
  const copy = async () => { try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { prompt('Einladungslink', inviteUrl); } };
  const opts = c.opts ? `${c.maxRounds} Runden${c.opts.goals ? ' · geheime Ziele' : ''}${c.opts.experience ? ' · Erfahrung' : ''}` : `${c.maxRounds} Runden`;

  if (!me) {
    return (
      <div className="page"><div className="page-inner"><div className="card stack login">
        <h2>{g.name}</h2>
        <p className="rule" style={{ margin: 0 }}>Kampagne um Eridanos · {opts}</p>
        {free ? <>
          <p style={{ margin: 0 }}>{g.names[free === 'R' ? 'K' : 'R']} lädt dich ein. Du führst das Haus <b style={{ color: HOUSES[free].color }}>{HOUSES[free].n}</b>.</p>
          <div className="row">
            <button type="button" className="primary" disabled={joining} onClick={async () => { setJoining(true); try { await joinCampaign(user, id); } catch (e) { setError((e as Error).message); } setJoining(false); }}>Mitspielen</button>
            <Link to="/"><button type="button" className="ghost">Zur Lobby</button></Link>
          </div>
        </> : <>
          <p className="rule" style={{ margin: 0 }}>Beide Häuser sind schon vergeben.</p>
          <Link to="/"><button type="button">Zur Lobby</button></Link>
        </>}
      </div></div></div>
    );
  }

  const other: House = me === 'R' ? 'K' : 'R';
  if (!g.players[other]) {
    return (
      <div className="page"><div className="page-inner"><div className="card stack login" style={{ textAlign: 'center' }}>
        <h2>Warte auf das andere Haus</h2>
        <p style={{ margin: 0 }}>Du führst <b style={{ color: HOUSES[me].color }}>{HOUSES[me].n}</b>. Schick den Link an deinen Gegner, oder warte, bis jemand aus der Lobby beitritt.</p>
        <p className="rule" style={{ margin: 0 }}>{g.name} · {opts}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="primary" onClick={copy}>{copied ? 'Link kopiert' : 'Einladungslink kopieren'}</button>
          <Link to="/"><button type="button">Zur Lobby</button></Link>
        </div>
        <p style={{ fontSize: 12, wordBreak: 'break-all', margin: 0 }}>{inviteUrl}</p>
      </div></div></div>
    );
  }

  const session: OnlineSession = {
    id, me, c, names: g.names, name: g.name, uid: user.uid, userName: user.displayName || user.email?.split('@')[0] || 'Unbekannt',
    commit: (fn) => commitCampaign(user, id, fn),
    startBattle: (battleId) => startCampaignBattle(user, id, battleId),
  };
  return <Campaign online={session} />;
}

function Message({ title, text }: { title: string; text: string }) {
  return <div className="page"><div className="page-inner"><div className="card stack login"><h2>{title}</h2>{text && <p className="rule" style={{ margin: 0 }}>{text}</p>}<Link to="/">Zur Lobby</Link></div></div></div>;
}
