// One entry point for every player action, shared by the local and the online game
// (and later by a Cloud Function that validates moves on the server).
import {
  applyMove, bribe, chooseShield, chooseUgur, endTurn, moveSteward, playCard, resign, resolveConversion, resolvePromotionRoll,
  rollDie, startGame, type Coin, type GameState, type PieceType, type Rng, type Side,
} from './rules.ts';
import { removePiece } from './battle.ts';
import { withFrame } from './replay.ts';

export type Action =
  /** `first` is ignored: the officers always begin (PO 22.11.2026). Kept so older clients and records still parse. */
  | { type: 'start'; first?: Side | 'roll' }
  | { type: 'move'; from: number; to: number; path?: number[] }
  | { type: 'roll' }
  | { type: 'convert'; t: PieceType }
  | { type: 'card'; side: Side; index: number }
  | { type: 'shield'; at: number }
  | { type: 'endTurn' }
  | { type: 'remove'; at: number }
  | { type: 'resign'; side: Side }
  | { type: 'ugur'; at: number }
  | { type: 'bribe'; at: number; coin: Coin }
  | { type: 'steward'; from: number; to: number; coin: Coin };

/** Which side is allowed to send this action, or null if either may (start). */
export function actorOf(st: GameState, a: Action): Side | null {
  switch (a.type) {
    case 'start': return null;
    case 'roll': return 'M';
    case 'convert': return 'O';
    case 'bribe': return 'O';
    case 'ugur': return 'M';
    case 'card': return a.side;
    case 'resign': return a.side;
    case 'remove': return st.board[a.at]?.s ?? null;
    default: return st.turn;
  }
}

/** Applies the action and appends a replay frame for the game library. */
export function act(st: GameState, a: Action, rng: Rng): GameState {
  return withFrame(apply(st, a, rng));
}

function apply(st: GameState, a: Action, rng: Rng): GameState {
  switch (a.type) {
    case 'start': return startGame(st, 'O');
    case 'move': return applyMove(st, a.from, a.to, a.path);
    case 'roll': return resolvePromotionRoll(st, [rollDie(rng), rollDie(rng)]);
    case 'convert': return resolveConversion(st, a.t);
    case 'card': return playCard(st, a.side, a.index, rng);
    case 'shield': return chooseShield(st, a.at);
    case 'endTurn': return endTurn(st, st.turn);
    case 'remove': return removePiece(st, a.at);
    case 'resign': return resign(st, a.side);
    case 'ugur': return chooseUgur(st, a.at);
    case 'bribe': return bribe(st, a.at, a.coin);
    case 'steward': return moveSteward(st, a.from, a.to, a.coin);
  }
}
