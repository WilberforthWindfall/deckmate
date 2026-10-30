import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

type Ctx = Record<string, string | number | boolean | null>;
/** Snapshot of the board game the feedback refers to (see api/feedback.ts). */
export interface GameSnapshot { record?: string[]; board?: string; state?: string }
/** 'game': asks what happened and what should have happened, for rule and bug reports during a game. */
type Variant = 'general' | 'game';
const LABELS: Record<Variant, [string, string, string]> = {
  general: ['Was hat gefallen?', 'Was hat genervt oder war unklar?', 'Was wünschst du dir?'],
  game: ['Was hat gefallen?', 'Was ist passiert?', 'Was hätte passieren sollen?'],
};

/** Feedback form; sends to /api/feedback, which files a GitHub issue. */
export function FeedbackForm({ where, context, defaultName = '', intro, onDone, game, variant = 'general' }: {
  where: string; context?: Ctx; defaultName?: string; intro?: string; onDone?: () => void;
  /** Called when sending, so the snapshot shows the position at that moment. */
  game?: () => GameSnapshot; variant?: Variant;
}) {
  const [l1, l2, l3] = LABELS[variant];
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [liked, setLiked] = useState('');
  const [disliked, setDisliked] = useState('');
  const [wish, setWish] = useState('');
  const [name, setName] = useState(defaultName);
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const empty = !rating && !liked.trim() && !disliked.trim() && !wish.trim();

  async function send(e: FormEvent) {
    e.preventDefault();
    if (empty) { setError('Gib bitte eine Bewertung oder ein paar Worte ein.'); return; }
    setState('sending'); setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating, liked, disliked, wish, name, where, website, context: { Seite: location.pathname, ...context }, game: game?.() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Das hat nicht geklappt.');
      setState('sent');
    } catch (err) {
      setState('idle');
      setError((err as Error).message === 'Failed to fetch' ? 'Keine Verbindung. Prüfe dein Internet und versuch es noch einmal.' : (err as Error).message);
    }
  }

  if (state === 'sent') {
    return (
      <div className="stack" style={{ gap: 10, alignItems: 'flex-start' }}>
        <b style={{ fontFamily: 'var(--display)', fontSize: 18 }}>Danke für dein Feedback!</b>
        <span className="rule">Es ist angekommen und fließt in die nächsten Verbesserungen ein.</span>
        {onDone && <button type="button" onClick={onDone}>Schließen</button>}
      </div>
    );
  }

  const shown = hover ?? rating ?? 0;
  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={send}>
      {intro && <span className="rule">{intro}</span>}
      <div className="stack" style={{ gap: 4 }}>
        <span className="lbl" id={`fb-rate-${where}`}>Gesamteindruck</span>
        <div role="radiogroup" aria-labelledby={`fb-rate-${where}`} className="row" style={{ gap: 2 }} onMouseLeave={() => setHover(null)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} von 5 Sternen`}
              onClick={() => setRating(rating === n ? null : n)} onMouseEnter={() => setHover(n)}
              style={{ all: 'unset', cursor: 'pointer', fontSize: 28, lineHeight: 1, padding: '0 2px', color: n <= shown ? 'var(--brass)' : 'var(--rope)' }}>★</button>
          ))}
        </div>
      </div>
      {variant === 'game' ? <>
        <Field label={l2} value={disliked} set={setDisliked} placeholder="Zum Beispiel: Der Stein durfte nach dem Achterdeck weiterschlagen." />
        <Field label={l3} value={wish} set={setWish} placeholder="Wie lautet die Regel aus deiner Sicht?" />
        <Field label={l1} value={liked} set={setLiked} />
      </> : <>
        <Field label={l1} value={liked} set={setLiked} />
        <Field label={l2} value={disliked} set={setDisliked} />
        <Field label={l3} value={wish} set={setWish} placeholder="Neue Funktionen, Regeln, Ideen …" />
      </>}
      {game && <span className="rule" style={{ fontSize: 12 }}>Die aktuelle Stellung und die komplette Zughistorie werden automatisch mitgeschickt.</span>}
      <label className="stack" style={{ gap: 4 }}>
        <span className="lbl">Name (freiwillig)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Damit wir nachfragen können" />
      </label>
      <input aria-hidden tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website"
        style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
      {error && <span role="alert" style={{ color: 'var(--coral)', fontSize: 13 }}>{error}</span>}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="primary" disabled={state === 'sending'}>{state === 'sending' ? 'Wird gesendet …' : 'Feedback senden'}</button>
        {onDone && <button type="button" className="ghost" onClick={onDone}>Abbrechen</button>}
      </div>
      <span className="rule" style={{ fontSize: 11 }}>Dein Feedback wird als Eintrag im Entwicklungsprojekt von Deckmate gespeichert.</span>
    </form>
  );
}

function Field({ label, value, set, placeholder }: { label: string; value: string; set: (v: string) => void; placeholder?: string }) {
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span className="lbl">{label}</span>
      <textarea value={value} onChange={(e) => set(e.target.value)} rows={2} maxLength={2000} placeholder={placeholder} />
    </label>
  );
}

/** Button that opens the form in a dialog. */
export function FeedbackButton({ where, context, defaultName, label = 'Feedback geben', className, style, game, variant, title = 'Feedback an die Werft', intro }: {
  where: string; context?: Ctx; defaultName?: string; label?: ReactNode; className?: string; style?: CSSProperties;
  game?: () => GameSnapshot; variant?: Variant; title?: string; intro?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div role="presentation" onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(8,12,18,.6)' }}>
          <div role="dialog" aria-label="Feedback" className="card stack" onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(480px, 100%)', maxHeight: '100%', overflowY: 'auto', gap: 12, background: 'var(--hull)', borderColor: 'var(--brass)' }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <FeedbackForm where={where} context={context} defaultName={defaultName} onDone={() => setOpen(false)} game={game} variant={variant}
              intro={intro ?? 'Was läuft gut, was nervt, was fehlt? Jede Rückmeldung hilft, Deckmate besser zu machen.'} />
          </div>
        </div>
      )}
    </>
  );
}
