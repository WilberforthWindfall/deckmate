import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authMessage, useAuth } from '../auth.tsx';

export default function Login() {
  const { login, register, resetPassword } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setInfo('');
    if (!email.trim() || !password) { setError('E-Mail und Passwort sind nötig.'); return; }
    if (mode === 'register' && name.trim().length < 2) { setError('Der Anzeigename braucht mindestens 2 Zeichen.'); return; }
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
    } catch (err) { setError(authMessage(err)); }
    setBusy(false);
  }

  async function reset() {
    setError(''); setInfo('');
    if (!email.trim()) { setError('Trage zuerst deine E-Mail-Adresse ein.'); return; }
    try { await resetPassword(email.trim()); setInfo('Wir haben dir eine E-Mail zum Zurücksetzen geschickt.'); }
    catch (err) { setError(authMessage(err)); }
  }

  return (
    <div className="page">
      <div className="page-inner">
        <div className="brand"><div><h1>Deckmate</h1><p>Mannschaft gegen Offiziere, an Bord der Heart of the Tempest.</p></div></div>
        <form className="card login stack" onSubmit={submit} noValidate>
          <h2>{mode === 'login' ? 'Anmelden' : 'Konto anlegen'}</h2>
          {mode === 'register' && (
            <label className="stack" style={{ gap: 4 }}><span className="lbl">Anzeigename</span>
              <input id="name" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Lord Windfall" autoComplete="nickname" /></label>
          )}
          <label className="stack" style={{ gap: 4 }}><span className="lbl">E-Mail</span>
            <input id="email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="name@beispiel.de" autoComplete="email" /></label>
          <label className="stack" style={{ gap: 4 }}><span className="lbl">Passwort</span>
            <input id="password" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          {error && <div className="error">{error}</div>}
          {info && <div className="rule">{info}</div>}
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>{mode === 'login' ? 'Anmelden' : 'Konto anlegen'}</button>
            <button type="button" className="ghost" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
              {mode === 'login' ? 'Neues Konto anlegen' : 'Ich habe schon ein Konto'}
            </button>
          </div>
          {mode === 'login' && <button type="button" className="ghost" style={{ alignSelf: 'flex-start', padding: 0, border: 0, color: 'var(--muted)' }} onClick={reset}>Passwort vergessen</button>}
        </form>
        <p className="rule">Ohne Konto ausprobieren: <Link to="/lokal">Partie an einem Gerät</Link></p>
      </div>
    </div>
  );
}
