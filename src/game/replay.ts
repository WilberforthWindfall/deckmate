// Compact replay frames for the game library: one short text per action, enough to show the board move by move.
// The hidden Ugur stone is never written here.
import { PIECES, type GameState, type PieceType, type Side, type Square } from './rules.ts';

const CODE: Record<PieceType, string> = { stone: 's', PT: 't', PL: 'l', STW: 'w', FL: 'F', CAP: 'C', KAN: 'K', KAP: 'P', MAR: 'M', INF: 'I' };
const TYPE = Object.fromEntries(Object.entries(CODE).map(([t, c]) => [c, t])) as Record<string, PieceType>;

export interface Frame { board: Square[]; turn: Side; moveNo: number; recordLen: number; last: [number, number] | null }

/** Board as 128 characters (type + flag per square), then turn, move number, protocol length and last move. */
export function frame(st: GameState): string {
  let b = '';
  for (const p of st.board) {
    if (!p) { b += '..'; continue; }
    const flag = p.ugur ? 'u' : p.t === 'STW' ? String(Math.min(9, p.coins?.length ?? 0)) : p.shielded ? '*' : '.';
    b += CODE[p.t] + flag;
  }
  const lm = st.lastMove ? `${st.lastMove.from},${st.lastMove.to}` : '';
  return `${b}|${st.phase === 'over' ? 'X' : st.turn}|${st.moveNo}|${st.record?.length ?? 0}|${lm}`;
}

export function readFrame(f: string): Frame {
  const [b, turn, moveNo, rec, lm] = f.split('|');
  const board: Square[] = [];
  for (let i = 0; i < 64; i++) {
    const c = b[i * 2], flag = b[i * 2 + 1];
    if (c === '.') { board.push(null); continue; }
    const t = TYPE[c];
    if (flag === 'u') board.push({ t, s: 'M', ugur: true });
    else if (t === 'STW') board.push({ t, s: 'M', coins: Array(Number(flag) || 0).fill('penny') });
    else board.push({ t, s: PIECES[t].s, ...(flag === '*' ? { shielded: true } : {}) });
  }
  const last = lm ? (lm.split(',').map(Number) as [number, number]) : null;
  return { board, turn: (turn === 'X' ? 'M' : turn) as Side, moveNo: Number(moveNo), recordLen: Number(rec), last };
}

export function withFrame(st: GameState): GameState {
  return { ...st, replay: [...(st.replay ?? []), frame(st)].slice(-1200) };
}
