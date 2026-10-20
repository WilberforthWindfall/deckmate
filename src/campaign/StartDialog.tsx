import { useState } from 'react';
import { DEFAULT_OPTIONS, GOAL_POINTS, RANKS, type CampaignOptions } from './engine.ts';
import { HOUSES, type House } from './map.ts';

// Start dialog for a new campaign: length, secret goals, experience of the armies.

const ROUNDS = [6, 10, 15];

export default function StartDialog({ onStart, onCancel }: { onStart: (o: CampaignOptions) => void; onCancel?: () => void }) {
  const [o, setO] = useState<CampaignOptions>(DEFAULT_OPTIONS);
  const [foe, setFoe] = useState<'mensch' | 'leicht' | 'normal'>('mensch');
  const [mine, setMine] = useState<House>('R');
  const start = () => onStart({ ...o, ai: foe === 'mensch' ? null : { house: mine === 'R' ? 'K' : 'R', level: foe } });
  const seg = (i: number, n: number) => ({ flex: 1, borderRadius: i === 0 ? '6px 0 0 6px' : i === n - 1 ? '0 6px 6px 0' : 0, marginLeft: i ? -1 : 0 });
  const Toggle = ({ k, title, text }: { k: 'goals' | 'experience'; title: string; text: string }) => (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: `1px solid ${o[k] ? 'var(--brass)' : 'var(--rope)'}`, borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}>
      <input type="checkbox" checked={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked })} style={{ marginTop: 3, width: 18, height: 18, flex: "none" }} />
      <span className="stack" style={{ gap: 2 }}><b>{title}</b><span className="rule" style={{ fontSize: 12.5 }}>{text}</span></span>
    </label>
  );
  return (
    <div className="overlay" style={{ zIndex: 40 }}>
      <div className="dialog stack" role="dialog" aria-label="Neue Kampagne" style={{ gap: 14, width: 'min(520px, 100%)', maxWidth: 520, textAlign: 'left' }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="lbl">Neue Kampagne</span>
          <h2 style={{ margin: 0 }}>Ravensmoor gegen Kerrow</h2>
          <span className="rule">{foe === 'mensch' ? 'Zwei Häuser an einem Gerät, Befehle reihum und geheim.' : 'Du gegen den Computer an diesem Gerät.'}</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b>Gegner</b>
          <div role="radiogroup" aria-label="Gegner" className="row" style={{ gap: 0 }}>
            {([['mensch', 'Mensch am Gerät'], ['leicht', 'Computer leicht'], ['normal', 'Computer normal']] as const).map(([k, l], i) => (
              <button key={k} type="button" role="radio" aria-checked={foe === k} className={foe === k ? 'on' : ''} onClick={() => setFoe(k)} style={seg(i, 3)}>{l}</button>
            ))}
          </div>
          {foe !== 'mensch' && (
            <div role="radiogroup" aria-label="Dein Haus" className="row" style={{ gap: 0 }}>
              {(['R', 'K'] as House[]).map((h, i) => (
                <button key={h} type="button" role="radio" aria-checked={mine === h} className={mine === h ? 'on' : ''} onClick={() => setMine(h)} style={{ ...seg(i, 2), display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: HOUSES[h].color }} />Du führst {HOUSES[h].n}
                </button>
              ))}
            </div>
          )}
          {foe !== 'mensch' && <span className="rule" style={{ fontSize: 12 }}>{foe === 'leicht' ? 'Für den Einstieg: greift gierig an, denkt nicht an Verteidigung, gibt nur 2 Befehle pro Runde.' : 'Verteidigt seine Städte, baut, forscht und folgt seinem geheimen Ziel.'} Knappe Schlachten werden gegen den Computer ausgewürfelt.</span>}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b>Rundenzahl</b>
          <div role="radiogroup" aria-label="Rundenzahl" className="row" style={{ gap: 0 }}>
            {ROUNDS.map((r, i) => (
              <button key={r} type="button" role="radio" aria-checked={o.maxRounds === r} className={o.maxRounds === r ? 'on' : ''} onClick={() => setO({ ...o, maxRounds: r })}
                style={{ flex: 1, borderRadius: i === 0 ? '6px 0 0 6px' : i === ROUNDS.length - 1 ? '0 6px 6px 0' : 0, marginLeft: i ? -1 : 0 }}>
                {r} Runden <span className="rule" style={{ fontSize: 11 }}>{r === 6 ? '· kurz' : r === 10 ? '· normal' : '· lang'}</span>
              </button>
            ))}
          </div>
          <span className="rule" style={{ fontSize: 12 }}>Nach der letzten Runde gewinnt, wer mehr Punkte hat – falls nicht vorher eine Hauptstadt fällt.</span>
        </div>
        <Toggle k="goals" title="Geheime Ziele" text={`Jedes Haus zieht ein verdecktes Ziel, z. B. zwei bestimmte Provinzen halten oder zwei Märkte besitzen. Erfüllt am Ende: +${GOAL_POINTS} Punkte. Aufgedeckt wird erst nach der letzten Runde.`} />
        <Toggle k="experience" title="Erfahrung der Heere" text={`Heere sammeln Erfahrung in Schlachten und gewonnenen Konflikten: ${RANKS[1].n} +${RANKS[1].bonus * 100} %, ${RANKS[2].n} +${RANKS[2].bonus * 100} % Stärke und eine Extrakarte auf dem Brett. Frische Rekruten verwässern sie.`} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          {onCancel && <button type="button" className="ghost" onClick={onCancel}>Abbrechen</button>}
          <button type="button" className="primary" onClick={start}>Kampagne beginnen</button>
        </div>
      </div>
    </div>
  );
}
