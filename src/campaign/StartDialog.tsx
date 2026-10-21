import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_OPTIONS, GOAL_POINTS, RANKS, type CampaignOptions } from './engine.ts';
import { CLASSIC, HOUSES, type House, type MapDef } from './map.ts';
import {
  CHARS, CITY_LEVELS, GEN_VERSION, SIZES, capitalDistance, fairness, generateMap, parseCode, randomWord, sizeOfDef,
  type CityLevel, type GenParams, type MapChar, type MapSize,
} from './mapgen.ts';
import { runTrial, trialVerdict, type TrialResult } from './trial.ts';
import { useFavorites } from './favorites.ts';
import MapPreview, { LAND_SWATCH, landHexes, neutralCities } from './MapPreview.tsx';
import { useAuth } from '../auth.tsx';

// Start dialog for a new campaign: the map (classic, generated from a code, or a favourite), opponent, length,
// secret goals and experience. Every map gets a fairness check: measured values at once, then the computer plays
// it against itself (KI-Probelauf) and the result becomes its seal.

const TRIAL_GAMES = 30;
type Source = 'zufall' | 'klassisch' | 'favorit' | 'code';
type Trial = { id: string; t: TrialResult; running: boolean };

export default function StartDialog({ onStart, onCancel, online = false, busy = false }: {
  onStart: (o: CampaignOptions) => void; onCancel?: () => void;
  /** Online campaign from the lobby: no opponent choice, the button creates the campaign. */
  online?: boolean; busy?: boolean;
}) {
  const { user } = useAuth();
  const fav = useFavorites(user);
  const [o, setO] = useState<CampaignOptions>(DEFAULT_OPTIONS);
  const [foe, setFoe] = useState<'mensch' | 'leicht' | 'normal'>('mensch');
  const [mine, setMine] = useState<House>('R');
  const [src, setSrc] = useState<Source>('zufall');
  const [params, setParams] = useState<Omit<GenParams, 'seed'>>({ size: 'M', char: 'A', cities: 'N' });
  const [def, setDef] = useState<MapDef>(CLASSIC);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [search, setSearch] = useState<{ n: number; t: TrialResult | null } | null>(null);
  const [codeIn, setCodeIn] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [favName, setFavName] = useState('');
  const [note, setNote] = useState('');
  const [roundsTouched, setRoundsTouched] = useState(false);
  const cancelRef = useRef<() => void>(() => {});
  const searchToken = useRef(0);

  const recRounds = def.id === CLASSIC.id ? 10 : SIZES[sizeOfDef(def)].rounds;
  useEffect(() => { if (!roundsTouched) setO((x) => ({ ...x, maxRounds: recRounds })); }, [recRounds, roundsTouched]);

  // KI-Probelauf for every map that is shown (unless it already carries one, e.g. a favourite)
  useEffect(() => {
    if (search) return;
    cancelRef.current();
    if (def.fairness?.trial) { setTrial({ id: def.id, t: def.fairness.trial, running: false }); return; }
    setTrial({ id: def.id, t: { R: 0, K: 0, draws: 0, games: 0 }, running: true });
    const run = runTrial(def, TRIAL_GAMES, (t) => setTrial({ id: def.id, t, running: true }));
    cancelRef.current = run.cancel;
    run.done.then((t) => setTrial((x) => (x?.id === def.id ? { id: def.id, t, running: t.games < TRIAL_GAMES } : x)));
    return () => run.cancel();
  }, [def, search]);
  useEffect(() => { findFair(); return () => { cancelRef.current(); searchToken.current++; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const withTrial = (d: MapDef): MapDef => (trial?.id === d.id && !trial.running ? { ...d, fairness: { score: d.fairness?.score ?? fairness(d).score, trial: trial.t } } : d);

  /** Roll random codes until the measured values and the KI-Probelauf both say "fair". */
  async function findFair(p = params) {
    const token = ++searchToken.current;
    cancelRef.current();
    setNote('');
    let best: { d: MapDef; t: TrialResult; dev: number } | null = null;
    for (let n = 1; n <= 8; n++) {
      setSearch({ n, t: null });
      await new Promise((r) => setTimeout(r, 30));
      if (token !== searchToken.current) return;
      const d = generateMap({ ...p, seed: randomWord() });
      const run = runTrial(d, TRIAL_GAMES, (t) => { if (token === searchToken.current) setSearch({ n, t }); });
      cancelRef.current = run.cancel;
      const t = await run.done;
      if (token !== searchToken.current) return;
      const v = trialVerdict(t), dev = Math.abs(v.share - 0.5);
      const withT = { ...d, fairness: { score: d.fairness?.score ?? 0, trial: t } };
      if (!best || dev < best.dev) best = { d: withT, t, dev };
      if (v.fair) break;
    }
    if (!best) return;
    setSearch(null);
    setDef(best.d);
    if (!trialVerdict(best.t).fair) setNote('Nach acht Versuchen keine ganz ausgeglichene Karte gefunden – hier die beste davon.');
  }

  function pickSource(s: Source) {
    searchToken.current++; setSearch(null); setSrc(s); setNote(''); setCodeErr('');
    if (s === 'klassisch') setDef(CLASSIC);
    if (s === 'zufall' && (def.id === CLASSIC.id || !def.code)) findFair();
  }
  function loadCode() {
    const p = parseCode(codeIn);
    if (!p) { setCodeErr('Das ist kein Kartencode. Er sieht so aus: MAN1-7F3KQ'); return; }
    const ver = /^[SML][AKGSF][WNV](\d+)-/.exec(codeIn.trim().toUpperCase())?.[1];
    setCodeErr(ver && Number(ver) !== GEN_VERSION ? 'Der Code stammt aus einer anderen Version des Kartengenerators – die Karte kann etwas anders aussehen.' : '');
    setParams({ size: p.size, char: p.char, cities: p.cities });
    setDef(generateMap(p));
  }

  const f = useMemo(() => fairness(def), [def]);
  const capDist = useMemo(() => capitalDistance(def), [def]);
  const shownTrial = search ? null : trial?.id === def.id ? trial : null;
  const verdict = shownTrial && shownTrial.t.games ? trialVerdict(shownTrial.t) : null;
  const code = def.code ?? null;
  const [copied, setCopied] = useState(false);
  const copy = async () => { if (!code) return; try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { prompt('Kartencode', code); } };
  const isFav = fav.has(def);

  const start = () => onStart({ ...o, map: withTrial(def), ai: online || foe === 'mensch' ? null : { house: mine === 'R' ? 'K' : 'R', level: foe } });

  const segStyle = (i: number, n: number) => ({ flex: 1, borderRadius: i === 0 ? '6px 0 0 6px' : i === n - 1 ? '0 6px 6px 0' : 0, marginLeft: i ? -1 : 0 });
  const Seg = <T extends string>({ label, value, set, items }: { label: string; value: T; set: (v: T) => void; items: [T, ReactNode][] }) => (
    <div role="radiogroup" aria-label={label} className="row" style={{ gap: 0, flexWrap: 'nowrap' }}>
      {items.map(([k, l], i) => <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => set(k)} style={segStyle(i, items.length)}>{l}</button>)}
    </div>
  );
  const Toggle = ({ k, title, text }: { k: 'goals' | 'experience'; title: string; text: string }) => (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: `1px solid ${o[k] ? 'var(--brass)' : 'var(--rope)'}`, borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}>
      <input type="checkbox" checked={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked })} style={{ marginTop: 3, width: 18, height: 18, flex: 'none' }} />
      <span className="stack" style={{ gap: 2 }}><b>{title}</b><span className="rule" style={{ fontSize: 12.5 }}>{text}</span></span>
    </label>
  );
  const setP = (p: Partial<typeof params>) => { const next = { ...params, ...p }; setParams(next); findFair(next); };

  return (
    <div className="overlay" style={{ zIndex: 40, overflowY: 'auto', alignItems: 'flex-start', position: online ? 'fixed' : 'absolute' }}>
      <div className="dialog start-dialog" role="dialog" aria-label="Neue Kampagne">
        <div className="stack" style={{ gap: 2 }}>
          <span className="lbl">Neue Kampagne</span>
          <h2 style={{ margin: 0 }}>Ravensmoor gegen Kerrow</h2>
        </div>

        <div className="start-grid">
          {/* ---------- map ---------- */}
          <section className="stack" style={{ gap: 10 }} aria-label="Karte">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <b>Karte</b>
              <div className="seg" role="tablist" aria-label="Kartenquelle">
                {([['zufall', 'Zufallskarte'], ['klassisch', 'Klassisch'], ['favorit', `Favoriten${fav.list.length ? ` · ${fav.list.length}` : ''}`], ['code', 'Code eingeben']] as [Source, string][]).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={src === k} onClick={() => pickSource(k)}>{l}</button>
                ))}
              </div>
            </div>

            {src === 'zufall' && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <div className="stack" style={{ gap: 4, flex: '1 1 200px' }}><span className="lbl">Größe</span>
                    <Seg label="Größe" value={params.size} set={(v: MapSize) => setP({ size: v })} items={(Object.keys(SIZES) as MapSize[]).map((k) => [k, `${SIZES[k].n} · ${SIZES[k].provinces}`])} /></div>
                  <div className="stack" style={{ gap: 4, flex: '1 1 180px' }}><span className="lbl">Städte</span>
                    <Seg label="Städte" value={params.cities} set={(v: CityLevel) => setP({ cities: v })} items={(Object.keys(CITY_LEVELS) as CityLevel[]).map((k) => [k, CITY_LEVELS[k].n])} /></div>
                </div>
                <div className="stack" style={{ gap: 4 }}><span className="lbl">Charakter</span>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {(Object.keys(CHARS) as MapChar[]).map((k) => (
                      <button key={k} type="button" className="pill" aria-pressed={params.char === k} title={CHARS[k].text} onClick={() => setP({ char: k })}
                        style={{ height: 32, border: 0, boxShadow: `inset 0 0 0 1px ${params.char === k ? 'var(--brass)' : 'var(--rope)'}`, background: params.char === k ? 'var(--rope)' : 'transparent' }}>{CHARS[k].n}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {src === 'favorit' && (
              <div className="stack" style={{ gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                {!fav.list.length && <span className="rule">Noch keine Favoriten. Gefällt dir eine Karte, speichere sie mit dem Stern.</span>}
                {fav.list.map((x) => (
                  <div key={x.id} className="order-row" style={{ cursor: 'pointer', outline: x.def.id === def.id ? '1px solid var(--brass)' : undefined }} onClick={() => setDef(x.def)}>
                    <span style={{ flex: 1, minWidth: 0 }}><b>{x.name}</b><span className="cmp-meta" style={{ display: 'block' }}>{x.def.code ?? 'klassische Karte'} · {x.def.provinces.length} Provinzen{x.def.fairness?.trial ? ` · Probelauf ${trialVerdict(x.def.fairness.trial).text}` : ''}</span></span>
                    <button type="button" className="icon-btn" aria-label={`${x.name} löschen`} title="Favorit löschen" onClick={(e) => { e.stopPropagation(); fav.remove(x.id); }}>×</button>
                  </div>
                ))}
                <span className="cmp-meta" style={{ fontSize: 12 }}>{fav.synced ? 'Gespeichert in deinem Konto – auf allen Geräten.' : fav.error || 'Ohne Anmeldung nur in diesem Browser gespeichert.'}</span>
              </div>
            )}

            {src === 'code' && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <label style={{ flex: 1, display: 'flex' }}><span className="sr-only">Kartencode</span>
                    <input value={codeIn} onChange={(e) => setCodeIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCode()} placeholder="z. B. MAN1-7F3KQ" style={{ flex: 1, fontFamily: 'ui-monospace, monospace', letterSpacing: 1 }} /></label>
                  <button type="button" onClick={loadCode}>Karte laden</button>
                </div>
                {codeErr && <span className="cmp-meta" style={{ color: '#F2C4BE' }}>{codeErr}</span>}
              </div>
            )}

            <div style={{ position: 'relative' }}>
              <MapPreview def={def} height={300} />
              {search && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(14,28,36,0.72)', borderRadius: 8 }}>
                  <div className="stack" style={{ gap: 6, alignItems: 'center', textAlign: 'center' }}>
                    <b>Suche eine faire Karte …</b>
                    <span className="cmp-meta">Karte {search.n}: Der Computer spielt sie {search.t ? `${search.t.games} / ${TRIAL_GAMES}` : ''} Mal gegen sich selbst</span>
                    <div className="progress" style={{ width: 220 }}><i style={{ width: `${((search.t?.games ?? 0) / TRIAL_GAMES) * 100}%` }} /></div>
                  </div>
                </div>
              )}
            </div>

            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{def.name}</b>
                <span className="cmp-meta" style={{ display: 'block' }}>{def.provinces.length} Provinzen · {landHexes(def)} Landfelder · {neutralCities(def)} neutrale Städte · Hauptstädte {capDist} Bewegungspunkte auseinander</span>
              </span>
              {code && <button type="button" onClick={copy} title="Code kopieren und teilen" style={{ fontFamily: 'ui-monospace, monospace' }}>{copied ? 'Kopiert' : code}</button>}
              {src === 'zufall' && <button type="button" onClick={() => findFair()} disabled={!!search}>Neue Karte würfeln</button>}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(LAND_SWATCH).map(([k, c]) => <span key={k} className="cmp-meta" style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{({ A: 'Acker', W: 'Wald', S: 'Sumpf', G: 'Gebirge', F: 'Fluss', K: 'Küste', H: 'Hügel' } as Record<string, string>)[k]}</span>)}
              <span className="cmp-meta" style={{ fontSize: 11.5 }}>· Kreis mit Krone: Hauptstadt · Raute: Stadt</span>
            </div>
            {note && <span className="cmp-meta" style={{ color: '#E8C98A' }}>{note}</span>}

            {/* fairness */}
            <div className="card stack" style={{ gap: 8, padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <b>Fairness</b>
                <span className="cmp-meta" style={{ display: 'inline-flex', gap: 10 }}>
                  <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: HOUSES.R.color, marginRight: 4 }} />{HOUSES.R.n}</span>
                  <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: HOUSES.K.color, marginRight: 4 }} />{HOUSES.K.n}</span>
                </span>
              </div>
              <TrialBar trial={shownTrial} verdict={verdict} searching={!!search} />
              <details className="fold">
                <summary>Messwerte der Karte {f.ok ? '· alle im grünen Bereich' : `· ${f.rows.filter((r) => !r.ok).length} auffällig`}</summary>
                <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                  {f.rows.map((r) => <Meter key={r.label} row={r} />)}
                </div>
              </details>
            </div>

            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <label style={{ flex: 1, display: 'flex' }}><span className="sr-only">Name des Favoriten</span>
                <input value={favName} onChange={(e) => setFavName(e.target.value)} placeholder={isFav ? 'Schon unter deinen Favoriten' : 'Name für den Favoriten'} maxLength={40} style={{ flex: 1 }} /></label>
              <button type="button" disabled={!!search || (shownTrial?.running ?? false)} onClick={async () => { try { await fav.save(withTrial(def), favName || def.name); setFavName(''); setNote('Als Favorit gespeichert.'); } catch (e) { setNote((e as Error).message); } }}
                title={shownTrial?.running ? 'Erst den Probelauf abwarten' : 'Als Favorit speichern'}>{isFav ? '★ Aktualisieren' : '☆ Als Favorit'}</button>
            </div>
          </section>

          {/* ---------- rules ---------- */}
          <section className="stack" style={{ gap: 14 }} aria-label="Regeln">
            {!online && (
              <div className="stack" style={{ gap: 6 }}>
                <b>Gegner</b>
                <Seg label="Gegner" value={foe} set={setFoe} items={[['mensch', 'Mensch am Gerät'], ['leicht', 'Computer leicht'], ['normal', 'Computer normal']]} />
                {foe !== 'mensch' && (
                  <Seg label="Dein Haus" value={mine} set={setMine} items={(['R', 'K'] as House[]).map((h) => [h, <span key={h} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: HOUSES[h].color }} />Du führst {HOUSES[h].n}</span>])} />
                )}
                <span className="rule" style={{ fontSize: 12 }}>{foe === 'mensch' ? 'Zwei Häuser an einem Gerät, Befehle reihum und geheim.' : `${foe === 'leicht' ? 'Für den Einstieg: greift gierig an, denkt nicht an Verteidigung, gibt nur 2 Befehle pro Runde.' : 'Verteidigt seine Städte, baut, forscht und folgt seinem geheimen Ziel.'} Knappe Schlachten werden gegen den Computer ausgewürfelt.`}</span>
              </div>
            )}
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <b>Rundenzahl</b><span style={{ fontFamily: 'var(--display)', fontSize: 22 }}>{o.maxRounds}</span>
              </div>
              <input type="range" min={4} max={30} step={1} value={o.maxRounds} aria-label="Rundenzahl" onChange={(e) => { setRoundsTouched(true); setO({ ...o, maxRounds: Number(e.target.value) }); }} style={{ width: '100%', accentColor: 'var(--brass)' }} />
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="cmp-meta" style={{ fontSize: 12 }}>4</span>
                <button type="button" className="ghost" style={{ height: 26, padding: '0 8px', fontSize: 12 }} disabled={o.maxRounds === recRounds} onClick={() => { setRoundsTouched(false); setO({ ...o, maxRounds: recRounds }); }}>Empfohlen für diese Karte: {recRounds}</button>
                <span className="cmp-meta" style={{ fontSize: 12 }}>30</span>
              </div>
              <span className="rule" style={{ fontSize: 12 }}>Nach der letzten Runde gewinnt, wer mehr Punkte hat – falls nicht vorher eine Hauptstadt fällt.</span>
            </div>
            <Toggle k="goals" title="Geheime Ziele" text={`Jedes Haus zieht ein verdecktes Ziel, z. B. zwei bestimmte Provinzen halten oder zwei Märkte besitzen. Erfüllt am Ende: +${GOAL_POINTS} Punkte.`} />
            <Toggle k="experience" title="Erfahrung der Heere" text={`${RANKS[1].n} +${RANKS[1].bonus * 100} %, ${RANKS[2].n} +${RANKS[2].bonus * 100} % Stärke und eine Extrakarte auf dem Brett. Frische Rekruten verwässern sie.`} />
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 'auto' }}>
              {onCancel && <button type="button" className="ghost" onClick={onCancel}>Abbrechen</button>}
              <button type="button" className="primary" onClick={start} disabled={!!search || busy}>{online ? 'Kampagne anlegen' : 'Kampagne beginnen'}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function TrialBar({ trial, verdict, searching }: { trial: Trial | null; verdict: ReturnType<typeof trialVerdict> | null; searching: boolean }) {
  if (searching || !trial) return <span className="cmp-meta">Probelauf folgt, sobald die Karte steht.</span>;
  const { t } = trial;
  const dec = t.R + t.K;
  const r = dec ? (t.R / dec) * 100 : 50;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>KI-Probelauf {trial.running ? <span className="cmp-meta">· {t.games} / {TRIAL_GAMES} Partien</span> : <span className="cmp-meta">· {t.games} Partien</span>}</span>
        {!trial.running && verdict && <span style={{ color: verdict.fair ? '#9BD3A8' : '#F2C4BE', fontWeight: 600 }}>{verdict.fair ? '✓ ausgewogen' : '⚠ unausgewogen'}</span>}
      </div>
      <div style={{ position: 'relative', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--rope)' }} aria-label={`Siege ${HOUSES.R.n} ${t.R}, ${HOUSES.K.n} ${t.K}`} role="img">
        <i style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${r}%`, background: HOUSES.R.color, transition: 'width .2s' }} />
        <i style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - r}%`, background: HOUSES.K.color, transition: 'width .2s' }} />
        <i style={{ position: 'absolute', left: '35%', width: '30%', top: 0, bottom: 0, boxShadow: 'inset 0 0 0 2px rgba(244,236,216,0.55)', borderRadius: 2 }} title="Zielbereich 35–65 %" />
      </div>
      <span className="cmp-meta" style={{ fontSize: 12 }}>
        {HOUSES.R.n} {t.R} : {t.K} {HOUSES.K.n}{t.draws ? ` · ${t.draws} unentschieden` : ''} – der Computer spielt die Karte gegen sich selbst; ausgewogen heißt 35–65 % Siege je Haus (heller Rahmen).
      </span>
    </div>
  );
}

function Meter({ row }: { row: { label: string; R: number; K: number; ok: boolean; unit?: string } }) {
  const max = Math.max(row.R, row.K, 0.0001);
  const w = (v: number) => `${(v / max) * 100}%`;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px 1fr 18px', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><i style={{ height: 8, width: w(row.R), background: HOUSES.R.color, borderRadius: 4 }} /></div>
      <span className="cmp-meta" style={{ textAlign: 'center', fontSize: 11.5 }} title={row.label}>{fmt(row.R)} | {fmt(row.K)}</span>
      <div><i style={{ display: 'block', height: 8, width: w(row.K), background: HOUSES.K.color, borderRadius: 4 }} /></div>
      <span style={{ color: row.ok ? '#9BD3A8' : '#F2C4BE' }}>{row.ok ? '✓' : '!'}</span>
      <span className="cmp-meta" style={{ gridColumn: '1 / -1', fontSize: 11.5, marginTop: -2 }}>{row.label}{row.unit ? ` (${row.unit})` : ''}</span>
    </div>
  );
}
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
