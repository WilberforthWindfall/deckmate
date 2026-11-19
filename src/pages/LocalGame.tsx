import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import GameView from '../components/GameView.tsx';
import { act, type Action } from '../game/actions.ts';
import { LAYOUT, newGame, scene, type CardKey, type Coin, type GameState, type PieceType, type Side } from '../game/rules.ts';
import { entryOf, saveLocal } from '../library.ts';
import { addToKasse, newCoins } from '../stewardkasse.ts';

type Put = [string, PieceType | `U:${PieceType}` | 'P:stone'];
interface Scene {
  label: string; pieces: Put[]; hint: string;
  /** Scenes for the rule extensions are played by the normal turn order (cards and coins included). */
  play?: { turn: Side; hands?: Partial<Record<Side, CardKey[]>>; purse?: Record<Side, Coin[]>; coins?: Record<string, Coin[]> };
}

const SCENES: Record<string, Scene> = {
  serie: { label: 'Schlagserie', hint: 'Wähle den Stein auf c3: a5 schlägt die ganze Serie, e5 oder c7 brechen sie vorher ab.', pieces: [['c3', 'stone'], ['g2', 'stone'], ['d4', 'MAR'], ['d6', 'KAP'], ['b6', 'KAN'], ['d8', 'FL'], ['h8', 'CAP']] },
  achterdeck: { label: 'Achterdeck', hint: 'Stein a6 schlägt b7 und landet auf c8: Der Zug endet dort, es wird befördert. Weiterschlagen über c7 ist nicht erlaubt.', pieces: [['a6', 'stone'], ['b7', 'INF'], ['c7', 'INF'], ['e8', 'FL'], ['h1', 'stone']] },
  rochade: { label: 'Rochade', hint: 'Wähle den Captain auf d8 und klicke einen markierten Mörser an: a8 ist die kurze Rochade (Captain b8, Mörser c8), h8 die lange (Captain f8, Mörser e8). Kann ein Offizier schlagen, ist sie nicht erlaubt.', pieces: [['d8', 'FL'], ['a8', 'KAN'], ['h8', 'KAN'], ['c7', 'INF'], ['d7', 'INF'], ['e7', 'INF'], ['e1', 'stone'], ['c1', 'stone']] },
  pflicht: { label: 'Schlagpflicht', hint: 'Wähle die Marine auf g8: Der Mörser muss schlagen.', pieces: [['a8', 'KAN'], ['a3', 'stone'], ['e3', 'stone'], ['f2', 'stone'], ['d8', 'FL'], ['g8', 'MAR']] },
  befoerderung: { label: 'Beförderung', hint: 'Ziehe den Stein von b7 auf die Grundreihe.', pieces: [['b7', 'stone'], ['g8', 'FL'], ['h6', 'KAP'], ['e2', 'stone']] },
  umwandlung: { label: 'Fähnrich-Umwandlung', hint: 'Fähnrich d2 muss e1 schlagen und wird umgewandelt.', pieces: [['d2', 'INF'], ['e1', 'stone'], ['a1', 'stone'], ['e8', 'FL']] },
  ugur: {
    label: 'Ugur erwacht', hint: 'Testszene: Der Stein d5 ist besessen. Die Offiziere müssen ihn mit dem Kaplan b3 schlagen – danach kämpft der Kaplan schwarz für die Mannschaft.',
    pieces: [['d8', 'FL'], ['e8', 'CAP'], ['b3', 'KAP'], ['d5', 'P:stone'], ['h1', 'stone'], ['c1', 'stone']], play: { turn: 'O' },
  },
  ugurSprung: {
    label: 'Ugurs Fähnrich', hint: 'Ugur steckt im Fähnrich f7 und zieht Richtung Achterdeck. Ziehe ihn nach f8: Die Mannschaft wählt, ob Ugur den Mörser a8 oder den Kaplan h8 ergreift. Der Fähnrich kehrt zu den Offizieren zurück.',
    pieces: [['d8', 'FL'], ['a8', 'KAN'], ['h8', 'KAP'], ['f7', 'U:INF'], ['h1', 'stone'], ['c1', 'stone']], play: { turn: 'M' },
  },
  zora: {
    label: 'Rota Zora', hint: 'Die Offiziere spielen die Rota Zora und ziehen. Weil Ugur (schwarzer Kaplan e4) schon erwacht ist, darf er allein für die Mannschaft ziehen, danach sind die Offiziere wieder dran.',
    pieces: [['d8', 'FL'], ['a8', 'KAN'], ['e4', 'U:KAP'], ['h1', 'stone'], ['c1', 'stone']], play: { turn: 'O', hands: { O: ['zora'] } },
  },
  steward: {
    label: 'Steward', hint: 'Der Mörser a8 müsste a3 schlagen. Die Offiziere können den Stein stattdessen mit einer Münze bestechen („Steward bestechen“). Der Steward b5 lässt sich von beiden Seiten gegen eine Münze 1 Feld bewegen.',
    pieces: [['d8', 'FL'], ['a8', 'KAN'], ['a3', 'stone'], ['c4', 'stone'], ['b5', 'STW'], ['g1', 'stone']],
    play: { turn: 'O', purse: { M: ['penny', 'halfpenny', 'farthing'], O: ['sov', 'crown', 'shilling'] }, coins: { b5: ['florin'] } },
  },
};

const newId = () => `lokal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export default function LocalGame() {
  const [st, setSt] = useState<GameState>(() => newGame(Math.random));
  const [free, setFree] = useState(false);
  const [isScene, setIsScene] = useState(false);
  const gameId = useRef(newId());
  const saved = useRef('');

  // Finished games go into the library (not the test scenes).
  useEffect(() => {
    if (st.phase !== 'over' || isScene || saved.current === gameId.current) return;
    saved.current = gameId.current;
    const d = new Date();
    saveLocal(entryOf(gameId.current, `Partie an einem Gerät, ${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`, st, { M: 'Mannschaft', O: 'Offiziere' }, 'lokal'));
  }, [st.phase, isScene, st]);

  function onAction(a: Action) {
    let base = st;
    if (free && a.type === 'move') {
      const p = st.board[a.from];
      if (p) base = { ...st, turn: p.s, fx: { ...st.fx, noPflicht: false, retreat: false } };
    }
    const next = act(base, a, Math.random);
    if (!isScene) void addToKasse(newCoins(base, next));
    setSt(next);
  }

  function fresh(options = st.options) {
    setFree(false); setIsScene(false); gameId.current = newId();
    setSt(newGame(Math.random, options));
  }

  function loadScene(key: string) {
    const s = SCENES[key];
    const next = scene(s.pieces, st.options, LAYOUT);
    next.log = [s.hint];
    next.record = [s.hint];
    if (s.play) {
      next.turn = s.play.turn;
      next.hands = { M: s.play.hands?.M ?? [], O: s.play.hands?.O ?? [] };
      next.purse = s.play.purse;
      for (const [sq, coins] of Object.entries(s.play.coins ?? {})) {
        const i = next.board.findIndex((_, k) => 'abcdefgh'[k % 8] + (8 - Math.floor(k / 8)) === sq);
        if (next.board[i]) next.board[i] = { ...next.board[i]!, coins };
      }
    }
    setFree(!s.play); setIsScene(true); setSt(next);
  }

  return (
    <GameView
      state={st}
      mySide={null}
      freeMode={free}
      onAction={onAction}
      onOptions={(options) => setSt({ ...st, options })}
      onExtensions={(o) => fresh(o)}
      header={<div className="row" style={{ justifyContent: 'space-between' }}><Link to="/">← Zur Lobby</Link><span className="rule">Partie an einem Gerät</span></div>}
      overActions={<>
        <button type="button" className="primary" onClick={() => fresh()}>Neue Partie</button>
        {!isScene && <Link to="/bibliothek"><button type="button">In der Bibliothek ansehen</button></Link>}
      </>}
      footer={
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <button type="button" className="primary" onClick={() => fresh()}>Neue Partie</button>
            {!free && st.phase === 'play' && <button type="button" className="ghost" onClick={() => onAction({ type: 'resign', side: st.turn })}>Aufgeben ({st.turn === 'M' ? 'Mannschaft' : 'Offiziere'})</button>}
          </div>
          <details className="fold">
            <summary>Testszenen für Regeln</summary>
            <div className="row">{Object.entries(SCENES).map(([k, s]) => <button key={k} type="button" onClick={() => loadScene(k)}>{s.label}</button>)}</div>
            <div className="rule">Die ersten Szenen ohne Zugreihenfolge und ohne Karten; Ugur, Rota Zora und Steward mit normaler Zugfolge.</div>
          </details>
        </div>
      }
    />
  );
}
