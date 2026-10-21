import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import GameView from '../components/GameView.tsx';
import { act, type Action } from '../game/actions.ts';
import { MAX_OFFICERS, MAX_STONES, TERRAIN, crewLineup, newBattle, officerLineup } from '../game/battle.ts';
import type { Army, BattleInfo, GameState } from '../game/rules.ts';
import { LAND, type Land } from '../campaign/map.ts';

// Campaign bridge, playable on one device: pick two armies and a terrain, deploy, fight, see who survives.

const PRESET: BattleInfo = {
  province: 'Mittelland', terrain: 'fluss', land: 'F',
  attacker: { house: 'Ravensmoor', size: 12, spec: { CAP: 1, KAP: 2, KAN: 1, MAR: 1 } },
  defender: { house: 'Kerrow', size: 10, spec: { CAP: 0, KAP: 0, KAN: 0, MAR: 0 } },
};

const SPEC: [keyof Army['spec'], string][] = [['CAP', 'Captain'], ['KAP', 'Kapläne'], ['KAN', 'Kanonaden'], ['MAR', 'Marines']];

export default function BattleTest() {
  const [info, setInfo] = useState<BattleInfo>(PRESET);
  const [st, setSt] = useState<GameState | null>(null);

  const setAtt = (a: Partial<Army>) => setInfo({ ...info, attacker: { ...info.attacker, ...a } });
  const setDef = (a: Partial<Army>) => setInfo({ ...info, defender: { ...info.defender, ...a } });
  const lineup = officerLineup(info.attacker);
  const officerCount = Object.values(lineup).reduce((x, y) => x + y, 0);

  function start(e: FormEvent) { e.preventDefault(); setSt(newBattle(info, Math.random)); }
  function onAction(a: Action) { if (st) setSt(act(st, a, Math.random)); }

  if (st) {
    return (
      <GameView
        state={st}
        mySide={null}
        onAction={onAction}
        header={<div className="row" style={{ justifyContent: 'space-between' }}><Link to="/">← Zur Lobby</Link><span className="rule">Kampagnen-Schlacht · ein Gerät</span></div>}
        overActions={<>
          <button type="button" className="primary" onClick={() => setSt(newBattle(info, Math.random))}>Noch einmal</button>
          <button type="button" onClick={() => setSt(null)}>Andere Heere</button>
        </>}
        footer={
          <div className="stack" style={{ gap: 8 }}>
            <div className="lbl">Schlacht</div>
            <div className="row">
              <button type="button" onClick={() => setSt(null)}>Heere ändern</button>
              {st.phase === 'play' && <button type="button" className="ghost" onClick={() => onAction({ type: 'resign', side: st.turn })}>
                {st.turn === 'M' ? 'Rückzug (Mannschaft)' : 'Angriff abbrechen (Offiziere)'}
              </button>}
            </div>
          </div>
        }
      />
    );
  }

  return (
    <div className="page"><div className="page-inner">
      <div className="row" style={{ justifyContent: 'space-between' }}><Link to="/">← Zur Lobby</Link><span className="rule">Prototyp Kampagnenmodus</span></div>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--display)', fontWeight: 600 }}>Kampagnen-Schlacht</h1>
        <p className="rule" style={{ margin: 0 }}>Zwei Heere treffen sich auf der Karte. Der Angreifer führt die Offiziere, der Verteidiger die Mannschaft. Fehlende Figuren nimmt jede Seite vor der Schlacht selbst vom Brett.</p>
      </div>
      <form className="stack" onSubmit={start}>
        <div className="card stack">
          <h2>Schauplatz</h2>
          <label className="stack" style={{ gap: 4 }}><span className="lbl">Provinz</span>
            <input value={info.province} onChange={(e) => setInfo({ ...info, province: e.target.value })} required /></label>
          <label className="stack" style={{ gap: 4 }}><span className="lbl">Landschaft</span>
            <select value={info.land ?? ''} onChange={(e) => { const l = e.target.value as Land | ''; setInfo({ ...info, land: l || undefined, terrain: l ? LAND[l].battle : 'ebene' }); }}>
              {(Object.keys(LAND) as Land[]).map((l) => <option key={l} value={l}>{LAND[l].n}</option>)}
              <option value="">Schiffsdeck (ohne Landschaft)</option>
            </select></label>
          <div className="rule">Gelände {TERRAIN[info.terrain].n}: {TERRAIN[info.terrain].rule}</div>
        </div>

        <div className="row" style={{ alignItems: 'stretch', gap: 12 }}>
          <div className="card stack" style={{ flex: '1 1 300px' }}>
            <h2>Angreifer · Offiziere</h2>
            <label className="stack" style={{ gap: 4 }}><span className="lbl">Haus</span>
              <input value={info.attacker.house} onChange={(e) => setAtt({ house: e.target.value })} required /></label>
            <label className="stack" style={{ gap: 4 }}><span className="lbl">Heeresstärke (Figuren)</span>
              <input type="number" min={1} max={16} value={info.attacker.size} onChange={(e) => setAtt({ size: Number(e.target.value) })} /></label>
            <div className="row" style={{ gap: 8 }}>
              {SPEC.map(([k, n]) => (
                <label key={k} className="stack" style={{ gap: 4, flex: '1 1 110px' }}><span className="lbl">{n} (max {MAX_OFFICERS[k]})</span>
                  <input type="number" min={0} max={MAX_OFFICERS[k]} value={info.attacker.spec[k]} onChange={(e) => setAtt({ spec: { ...info.attacker.spec, [k]: Number(e.target.value) } })} /></label>
              ))}
            </div>
            <div className="rule">Auf dem Brett: First Leutnant, {lineup.CAP} Captain, {lineup.KAP} Kapläne, {lineup.KAN} Kanonaden, {lineup.MAR} Marines, {lineup.INF} Infanteristen · {officerCount} Figuren</div>
          </div>
          <div className="card stack" style={{ flex: '1 1 300px' }}>
            <h2>Verteidiger · Mannschaft</h2>
            <label className="stack" style={{ gap: 4 }}><span className="lbl">Haus</span>
              <input value={info.defender.house} onChange={(e) => setDef({ house: e.target.value })} required /></label>
            <label className="stack" style={{ gap: 4 }}><span className="lbl">Heeresstärke (Steine, max {MAX_STONES})</span>
              <input type="number" min={1} max={MAX_STONES} value={info.defender.size} onChange={(e) => setDef({ size: Number(e.target.value) })} /></label>
            <div className="rule">Auf dem Brett: {crewLineup(info.defender)} Steine</div>
          </div>
        </div>
        <div className="row"><button type="submit" className="primary">Schlacht beginnen</button></div>
      </form>
    </div></div>
  );
}
