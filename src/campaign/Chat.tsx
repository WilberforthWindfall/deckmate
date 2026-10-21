import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { addDoc, collection, onSnapshot, query, serverTimestamp, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase.ts';
import { HOUSES, type House } from './map.ts';

// Diplomacy chat of an online campaign: a channel for everyone and a private one with every other house.
// Messages live in games/{id}/chat. Firestore only lets a player read public messages, their own and those sent
// to their house – so three queries cover everything this player may see.

export interface ChatMsg { id: string; from: House; to: House | 'all'; text: string; uid: string; name: string; at: Timestamp | null }
type Channel = 'all' | House;
const time = (m: ChatMsg) => m.at?.toMillis?.() ?? Date.now();

export function useChat(gameId: string, me: House, uid: string) {
  const [msgs, setMsgs] = useState<Record<string, ChatMsg>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    const col = collection(db, 'games', gameId, 'chat');
    const qs = [query(col, where('to', '==', 'all')), query(col, where('uid', '==', uid)), query(col, where('to', '==', me))];
    const stops = qs.map((q) => onSnapshot(q, (snap) => {
      setMsgs((old) => {
        const next = { ...old };
        for (const d of snap.docs) next[d.id] = { id: d.id, ...(d.data() as Omit<ChatMsg, 'id'>) };
        return next;
      });
      setError('');
    }, (e) => setError((e as { code?: string }).code === 'permission-denied'
      ? 'Der Chat braucht noch die neuen Firestore-Regeln. Sobald sie veröffentlicht sind, geht es hier los.'
      : 'Der Chat ist gerade nicht erreichbar.')));
    return () => stops.forEach((s) => s());
  }, [gameId, me, uid]);
  const list = useMemo(() => Object.values(msgs).sort((a, b) => time(a) - time(b)), [msgs]);
  return { list, error };
}

const inChannel = (m: ChatMsg, ch: Channel, me: House) =>
  ch === 'all' ? m.to === 'all' : (m.from === me && m.to === ch) || (m.from === ch && m.to === me);

export default function Chat({ gameId, me, uid, name, others, collapsed, onExpand }: {
  gameId: string; me: House; uid: string; name: string; others: House[];
  /** One line only (while an army or the build bar needs the room). */
  collapsed: boolean; onExpand: () => void;
}) {
  const { list, error } = useChat(gameId, me, uid);
  const channels: Channel[] = ['all', ...others];
  const [ch, setCh] = useState<Channel>(others[0] ?? 'all');
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState('');
  const seenKey = `deckmate.chat.gelesen.${gameId}`;
  const [seen, setSeen] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem(seenKey) ?? '{}'); } catch { return {}; } });
  const box = useRef<HTMLDivElement>(null);
  const shown = list.filter((m) => inChannel(m, ch, me));
  const unread = (c: Channel) => list.filter((m) => inChannel(m, c, me) && m.from !== me && time(m) > (seen[c] ?? 0)).length;
  const totalUnread = channels.reduce((n, c) => n + unread(c), 0);

  // reading a channel marks it as read
  useEffect(() => {
    if (collapsed) return;
    const last = shown.length ? time(shown[shown.length - 1]) : 0;
    if (last > (seen[ch] ?? 0)) {
      const next = { ...seen, [ch]: last };
      setSeen(next);
      try { localStorage.setItem(seenKey, JSON.stringify(next)); } catch { /* ignore */ }
    }
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [ch, shown.length, collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim().slice(0, 500);
    if (!t) return;
    setText(''); setSendError('');
    try { await addDoc(collection(db, 'games', gameId, 'chat'), { from: me, to: ch, text: t, uid, name, at: serverTimestamp() }); }
    catch (err) { setText(t); setSendError((err as { code?: string }).code === 'permission-denied' ? 'Senden ging nicht: Die Firestore-Regeln für den Chat fehlen noch.' : 'Senden ging nicht. Prüfe die Verbindung.'); }
  }

  const label = (c: Channel) => (c === 'all' ? 'Alle' : HOUSES[c].n);
  const last = list.filter((m) => m.from !== me).slice(-1)[0];

  if (collapsed) {
    return (
      <button type="button" aria-expanded="false" onClick={onExpand} style={{ width: '100%', minHeight: 56, padding: '0 18px', border: 0, borderTop: '1px solid var(--rope)', borderRadius: 0, background: 'transparent', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
        <span style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 17 }}>Diplomatie</span>
        <span className="cmp-meta" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{last ? `${HOUSES[last.from].n}: „${last.text}“` : 'Noch keine Nachrichten'}</span>
        {totalUnread > 0 && <Badge n={totalUnread} />}
      </button>
    );
  }

  return (
    <section aria-label="Diplomatie" style={{ flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--rope)' }}>
      <div className="cmp-sec" style={{ paddingBottom: 6 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="cmp-h" style={{ fontSize: 18 }}>Diplomatie</h2>
          {totalUnread > 0 && <span className="cmp-meta">{totalUnread} ungelesen</span>}
        </div>
        <div role="tablist" aria-label="Gesprächskanal" className="row" style={{ gap: 6 }}>
          {channels.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={ch === c} onClick={() => setCh(c)} className="pill"
              style={{ height: 30, display: 'flex', alignItems: 'center', gap: 6, background: ch === c ? 'var(--rope)' : 'transparent', boxShadow: `inset 0 0 0 1px ${ch === c ? 'var(--brass)' : 'var(--rope)'}`, border: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c === 'all' ? 'var(--muted)' : HOUSES[c].color }} />{label(c)}
              {unread(c) > 0 && <Badge n={unread(c)} />}
            </button>
          ))}
        </div>
        <span className="cmp-meta" style={{ fontSize: 12 }}>{ch === 'all' ? 'Alle Häuser lesen mit.' : `Nur du und ${HOUSES[ch].n} lesen hier mit.`}</span>
      </div>
      <div ref={box} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {error ? <span className="cmp-meta">{error}</span>
          : !shown.length ? <span className="cmp-meta">{ch === 'all' ? 'Hier verhandeln alle Häuser offen.' : `Schreib ${HOUSES[ch].n} – Absprachen sind nicht bindend.`}</span>
          : shown.map((m) => (
            <div key={m.id} className={`chat-msg${m.from === me ? ' mine' : ''}`}>
              {m.from !== me && <span className="who" style={{ color: HOUSES[m.from].light }}>{HOUSES[m.from].n}{m.name ? ` · ${m.name}` : ''}</span>}
              <span className="b">{m.text}</span>
            </div>
          ))}
      </div>
      <form onSubmit={send} style={{ padding: '10px 18px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <label style={{ flex: 1, display: 'flex' }}>
            <span className="sr-only">Nachricht an {label(ch)}</span>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={`Nachricht an ${label(ch)}`} style={{ flex: 1, height: 40 }} />
          </label>
          <button type="submit" aria-label="Senden" style={{ width: 44, height: 40, padding: 0, display: 'grid', placeItems: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7z" /></svg>
          </button>
        </div>
        {sendError && <span className="cmp-meta" style={{ color: '#F2C4BE' }}>{sendError}</span>}
      </form>
    </section>
  );
}

function Badge({ n }: { n: number }) {
  return <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--brass)', color: '#1E1A15', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{n}</span>;
}

