// One entry point for every player action, shared by the local and the online game
// (and later by a Cloud Function that validates moves on the server).
import {
  applyMove, chooseShield, endTurn, playCard, resign, resolveConversion, resolvePromotionRoll, rollDie, startGame,
  SIDE_NAME, type GameState, type PieceType, type Rng, type Side,
} from './rules.ts';
import { removePiece } from './battle.ts';

export type Action =
  | { type: 'start'; first: Side | 'roll' }
  | { type: 'move'; from: number; to: number; path?: number[] }
  | { type: 'roll' }
  | { type: 'convert'; t: PieceType }
  | { type: 'card'; side: Side; index: number }
  | { type: 'shield'; at: number }
  | { type: 'endTurn' }
  | { type: 'remove'; at: number }
  | { type: 'resign'; side: Side };

/** Which side is allowed to send this action, or null if either may (start). */
export function actorOf(st: GameState, a: Action): Side | null {
  switch (a.type) {
    case 'start': return null;
    case 'roll': return 'M';
    case 'convert': return 'O';
    case 'card': return a.side;
    case 'resign': return a.side;
    case 'remove': return st.board[a.at]?.s ?? null;
    default: return st.turn;
  }
}

export function act(st: GameState, a: Action, rng: Rng): GameState {
  switch (a.type) {
    case 'start': {
      if (a.first !== 'roll') return startGame(st, a.first);
      let m = rollDie(rng), o = rollDie(rng);
      while (m === o) { m = rollDie(rng); o = rollDie(rng); }
      const first: Side = m > o ? 'M' : 'O';
      return startGame(st, first, `Würfel: ${SIDE_NAME.M} ${m}, ${SIDE_NAME.O} ${o}`);
    }
    case 'move': return applyMove(st, a.from, a.to, a.path);
    case 'roll': return resolvePromotionRoll(st, [rollDie(rng), rollDie(rng)]);
    case 'convert': return resolveConversion(st, a.t);
    case 'card': return playCard(st, a.side, a.index, rng);
    case 'shield': return chooseShield(st, a.at);
    case 'endTurn': return endTurn(st, st.turn);
    case 'remove': return removePiece(st, a.at);
    case 'resign': return resign(st, a.side);
  }
}
