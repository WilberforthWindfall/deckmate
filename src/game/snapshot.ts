// Text snapshot of a board game for feedback reports: board diagram, protocol and raw state.
import { SIDE_NAME, sqName, type GameState, type PieceType } from './rules.ts';

/** Crew in lower case, officers in upper case. */
const CODE: Record<PieceType, string> = { stone: 's', PT: 't', PL: 'l', FL: 'F', CAP: 'C', KAN: 'K', KAP: 'P', MAR: 'M', INF: 'I' };
export const LEGEND = 'Mannschaft klein: s Stein, t befördert (Turm), l befördert (Läufer) · Offiziere groß: F First Leutnant, C Captain, K Kanonade, P Kaplan, M Marine, I Infanterist · * unter Ehrenwache';

export function boardText(st: GameState): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    const cells = [];
    for (let c = 0; c < 8; c++) {
      const p = st.board[r * 8 + c];
      cells.push(p ? CODE[p.t] + (p.shielded ? '*' : ' ') : '. ');
    }
    rows.push(`${8 - r}  ${cells.join('')}`);
  }
  rows.push('   a b c d e f g h');
  const extra = [
    `Zug ${st.moveNo}, ${st.phase === 'play' ? `${SIDE_NAME[st.turn]} am Zug` : st.phase === 'over' ? `beendet (${st.winner ? SIDE_NAME[st.winner] : '–'})` : 'vor dem Start'}`,
    st.pending ? `Offen: ${st.pending.kind === 'promoM' ? 'Beförderung' : 'Umwandlung'} auf ${sqName(st.pending.at)}` : '',
    st.lastMove ? `Letzter Zug: ${sqName(st.lastMove.from)} → ${sqName(st.lastMove.to)}${st.lastMove.cap.length ? ` (schlägt ${st.lastMove.cap.map(sqName).join(', ')})` : ''}` : '',
    `Karten: Mannschaft ${st.hands.M.join(', ') || '–'} · Offiziere ${st.hands.O.join(', ') || '–'}`,
    LEGEND,
  ].filter(Boolean);
  return [...rows, '', ...extra].join('\n');
}

export function gameSnapshot(st: GameState) {
  // Older games have no full record yet; the capped log (newest first) is the best we have.
  const record = st.record?.length ? st.record : [...st.log].reverse();
  return { board: boardText(st), record, state: JSON.stringify(st) };
}
