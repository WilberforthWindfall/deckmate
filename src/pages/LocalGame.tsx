import { useState } from 'react';
import { Link } from 'react-router-dom';
import GameView from '../components/GameView.tsx';
import { act, type Action } from '../game/actions.ts';
import { newGame, scene, type GameState, type PieceType } from '../game/rules.ts';

const SCENES: Record<string, { label: string; pieces: [string, PieceType][]; hint: string }> = {
  serie: { label: 'Schlagserie', hint: 'Wähle den Stein auf c3 und fahre über das Ziel.', pieces: [['c3', 'stone'], ['g2', 'stone'], ['d4', 'MAR'], ['d6', 'KAP'], ['b6', 'KAN'], ['e8', 'FL'], ['h8', 'CAP']] },
  pflicht: { label: 'Schlagpflicht', hint: 'Wähle die Marine auf g8: Die Kanonade muss schlagen.', pieces: [['a8', 'KAN'], ['a3', 'stone'], ['e3', 'stone'], ['f2', 'stone'], ['e8', 'FL'], ['g8', 'MAR']] },
  befoerderung: { label: 'Beförderung', hint: 'Ziehe den Stein von b7 auf die Grundreihe.', pieces: [['b7', 'stone'], ['g8', 'FL'], ['h6', 'KAP'], ['e2', 'stone']] },
  umwandlung: { label: 'Infanterist-Umwandlung', hint: 'Infanterist d2 muss e1 schlagen und wird umgewandelt.', pieces: [['d2', 'INF'], ['e1', 'stone'], ['a1', 'stone'], ['e8', 'FL']] },
};

export default function LocalGame() {
  const [st, setSt] = useState<GameState>(() => newGame(Math.random));
  const [free, setFree] = useState(false);

  function onAction(a: Action) {
    let base = st;
    if (free && a.type === 'move') {
      const p = st.board[a.from];
      if (p) base = { ...st, turn: p.s, fx: { ...st.fx, noPflicht: false, retreat: false } };
    }
    setSt(act(base, a, Math.random));
  }

  function loadScene(key: string) {
    const s = SCENES[key];
    const next = scene(s.pieces, st.options);
    next.log = [s.hint];
    setFree(true); setSt(next);
  }

  return (
    <GameView
      state={st}
      mySide={null}
      freeMode={free}
      onAction={onAction}
      onOptions={(options) => setSt({ ...st, options })}
      header={<div className="row" style={{ justifyContent: 'space-between' }}><Link to="/">← Zur Lobby</Link><span className="rule">Partie an einem Gerät</span></div>}
      overActions={<button type="button" className="primary" onClick={() => { setFree(false); setSt(newGame(Math.random, st.options)); }}>Neue Partie</button>}
      footer={
        <div className="stack" style={{ gap: 8 }}>
          <div className="lbl">Partie und Testszenen</div>
          <div className="row">
            <button type="button" className="primary" onClick={() => { setFree(false); setSt(newGame(Math.random, st.options)); }}>Neue Partie</button>
            {Object.entries(SCENES).map(([k, s]) => <button key={k} type="button" onClick={() => loadScene(k)}>{s.label}</button>)}
          </div>
          {!free && st.phase === 'play' && <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onAction({ type: 'resign', side: st.turn })}>Aufgeben ({st.turn === 'M' ? 'Mannschaft' : 'Offiziere'})</button>}
          <div className="rule">Testszenen laufen ohne Zugreihenfolge und ohne Karten.</div>
        </div>
      }
    />
  );
}
