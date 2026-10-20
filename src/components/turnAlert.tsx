import { useEffect, useRef, useState } from 'react';

// "Your turn" alerts for online play: the tab title shows what is waiting, a soft chime sounds when it becomes your
// turn, and – if the player allows it – a browser notification appears while the tab is in the background.

const KEY = 'deckmate.benachrichtigen';
const BASE_TITLE = typeof document !== 'undefined' ? document.title : 'Deckmate';
const wantsNotify = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const canNotify = () => typeof Notification !== 'undefined';

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
 * chime and, in the background, send a notification. The first value after opening the page stays silent.
 */
export function useTurnAlert(need: string | null, label: string) {
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    document.title = need ? `● ${need} · ${label}` : `${label} · ${BASE_TITLE}`;
    if (prev.current !== undefined && need && need !== prev.current) {
      chime();
      if (document.hidden && wantsNotify() && canNotify() && Notification.permission === 'granted') {
        try { new Notification('Deckmate', { body: `${need} – ${label}`, tag: `deckmate-${label}` }); } catch { /* ignore */ }
      }
    }
    prev.current = need;
  }, [need, label]);
  useEffect(() => () => { document.title = BASE_TITLE; }, []);
}

/** Switch for browser notifications (asks the browser for permission once). */
export function AlertToggle() {
  const [on, setOn] = useState(() => wantsNotify() && canNotify() && Notification.permission === 'granted');
  const [hint, setHint] = useState('');
  if (!canNotify()) return null;
  async function toggle() {
    if (on) { try { localStorage.setItem(KEY, '0'); } catch { /* ignore */ } setOn(false); return; }
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (p !== 'granted') { setHint('Der Browser hat Benachrichtigungen blockiert. Du kannst sie in den Seiteneinstellungen erlauben.'); return; }
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    setOn(true); setHint(''); chime();
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <button type="button" className={on ? 'on' : 'ghost'} aria-pressed={on} onClick={toggle} style={{ alignSelf: 'flex-start' }}>
        {on ? '🔔 Benachrichtigung an' : '🔕 Benachrichtigen, wenn ich dran bin'}
      </button>
      <span className="rule" style={{ fontSize: 12 }}>{hint || 'Ein Ton und der Tab-Titel zeigen es immer an; die Benachrichtigung erscheint auch, wenn der Tab im Hintergrund liegt.'}</span>
    </div>
  );
}
