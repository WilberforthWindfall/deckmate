import { useState } from 'react';
import { DEFAULT_OPTIONS, GOAL_POINTS, RANKS, type CampaignOptions } from './engine.ts';

// Start dialog for a new campaign: length, secret goals, experience of the armies.

const ROUNDS = [6, 10, 15];

export default function StartDialog({ onStart, onCancel }: { onStart: (o: CampaignOptions) => void; onCancel?: () => void }) {
  const [o, setO] = useState<CampaignOptions>(DEFAULT_OPTIONS);
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
          <span className="rule">Zwei Häuser an einem Gerät, Befehle reihum und geheim.</span>
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
          <button type="button" className="primary" onClick={() => onStart(o)}>Kampagne beginnen</button>
        </div>
      </div>
    </div>
  );
}
