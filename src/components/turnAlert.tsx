import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.tsx';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../notify.ts';

// "Your turn" alerts for online play: the tab title shows what is waiting and a soft chime sounds when it becomes your
// turn. With the game closed or in the background, push notifications from the server take over (see notify.ts).

const BASE_TITLE = typeof document !== 'undefined' ? document.title : 'Deckmate';

let audio: AudioContext | null = null;
/** Two soft bell tones (no sound file needed). Fails silently if the browser blocks audio. */
export function chime() {
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime;
    for (const [i, f] of [[0, 660], [1, 880]] as const) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + i * 0.16);
      g.gain.linearRampToValueAtTime(0.12, t0 + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.6);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.65);
    }
  } catch { /* ignore */ }
}

/**
 * `need`: what the player has to do now (e.g. "Deine Befehle"), or null. Changes to a new non-null value ring the
 * chime. The first value after opening the page stays silent.
 */
export function useTurnAlert(need: string | null, label: string) {
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    document.title = need ? `● ${need} · ${label}` : `${label} · ${BASE_TITLE}`;
    if (prev.current !== undefined && need && need !== prev.current) chime();
    prev.current = need;
  }, [need, label]);
  useEffect(() => () => { document.title = BASE_TITLE; }, []);
}

const HINT: Record<PushState, string> = {
  on: 'Du bekommst eine Nachricht, sobald du dran bist, auch wenn Deckmate geschlossen ist.',
  off: 'Eine Nachricht, sobald du dran bist, auch wenn Deckmate geschlossen ist.',
  blocked: 'Der Browser hat Benachrichtigungen für Deckmate blockiert. Erlaube sie in den Seiteneinstellungen (Schloss-Symbol neben der Adresse) und tippe dann erneut.',
  'ios-home': 'Auf dem iPhone: erst über „Teilen → Zum Home-Bildschirm“ hinzufügen und Deckmate von dort öffnen.',
  unsupported: 'Dieser Browser kann keine Push-Nachrichten empfangen.',
  server: '',
};
const NO_PUSH_SERVICE = 'Dieser Browser findet keinen Push-Dienst. Unter GrapheneOS ohne Google: IronFox oder Fennec nutzen und ntfy (F-Droid) als Verteiler installieren.';

/** Switch for push notifications on this device. `full` adds the explanation and a test button (lobby). */
export function AlertToggle({ full = false }: { full?: boolean }) {
  const { user } = useAuth();
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { pushState().then(setSt).catch(() => setSt('unsupported')); }, []);
  if (!user || st === null) return null;
  // Not set up on the server: no hint for players, the switch simply is not there.
  if (st === 'server' || !full && st === 'unsupported') return null;

  async function toggle() {
    setBusy(true); setNote('');
    try {
      const next = st === 'on' ? await disablePush(user!) : await enablePush(user!);
      setSt(next);
      if (next === 'on') chime();
    } catch (e) {
      const err = e as Error;
      // Chromium without Google Play (e.g. Vanadium) fails here with AbortError: there is no push service.
      setNote(err.name === 'AbortError' || err.name === 'NotAllowedError' && Notification.permission === 'granted' ? NO_PUSH_SERVICE : err.message);
    }
    setBusy(false);
  }
  async function probe() {
    setBusy(true); setNote('');
    try { await testPush(user!); setNote('Probe verschickt. Kommt nichts an? Akku-Optimierung für den Browser (und ntfy) ausschalten.'); } catch (e) { setNote((e as Error).message); }
    setBusy(false);
  }
  const canToggle = st === 'on' || st === 'off' || st === 'blocked';
  const body = (
    <div className="stack" style={{ gap: 6 }}>
      {canToggle && (
        <div className="row">
          <button type="button" className={st === 'on' ? 'on' : 'ghost'} aria-pressed={st === 'on'} disabled={busy} onClick={toggle} style={{ alignSelf: 'flex-start' }}>
            {st === 'on' ? '🔔 Benachrichtigung an' : '🔕 Benachrichtigen, wenn ich dran bin'}
          </button>
          {full && st === 'on' && <button type="button" className="ghost" disabled={busy} onClick={probe}>Probe schicken</button>}
        </div>
      )}
      <span className="rule" style={{ fontSize: 12 }} role={note ? 'status' : undefined}>{note || HINT[st]}</span>
      {full && <span className="rule" style={{ fontSize: 12 }}>Gilt für dieses Gerät; auf jedem Handy oder Rechner einmal einschalten. GrapheneOS ohne Google: IronFox oder Fennec mit der App ntfy als Verteiler.</span>}
    </div>
  );
  return full ? <div className="card stack"><h2>Benachrichtigungen aufs Handy</h2>{body}</div> : body;
}
