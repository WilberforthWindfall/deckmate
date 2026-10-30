// Deckmate rules engine: pure, serializable, no UI or Firebase dependencies.
// Board is a flat array of 64 squares (index = row * 8 + col); row 0 is rank 8 (officers' home row).

export type Side = 'M' | 'O';
export type PieceType = 'stone' | 'FL' | 'CAP' | 'KAN' | 'KAP' | 'MAR' | 'INF' | 'PT' | 'PL';
export interface Piece { t: PieceType; s: Side; shielded?: boolean }
export type Square = Piece | null;
export type CardKey = 'grog' | 'kopf' | 'boee' | 'arzt' | 'wache' | 'blatt';
export type Rng = () => number;
export type Terrain = 'ebene' | 'fluss' | 'gebirge' | 'huegel';
export interface Army { house: string; size: number; spec: { CAP: number; KAP: number; KAN: number; MAR: number } }
export interface BattleInfo { province: string; terrain: Terrain; attacker: Army; defender: Army; first?: Side;
  /** Landscape of the campaign hex (A, W, S, G, F, K, H) – only changes how the board looks. */
  land?: string }

export interface Move { from: number; to: number; path: number[]; cap: number[]; retreat?: boolean }
export interface LastMove extends Move { t: PieceType; s: Side }

export interface Options { mPflicht: boolean; sideFirst: boolean; /** Furt (Flussgelände): Infanteristen ohne Doppelschritt. */ furt?: boolean }

export interface GameState {
  v: number;
  board: Square[];
  phase: 'setup' | 'play' | 'over';
  turn: Side;
  winner: Side | null;
  winReason: string | null;
  moveNo: number;
  hands: Record<Side, CardKey[]>;
  captured: Record<Side, PieceType[]>;
  fx: { skip: Record<Side, number>; noPflicht: boolean; retreat: boolean; played: boolean; shieldPick: boolean; moved?: boolean;
    /** "Ruhe vor dem Sturm": this side may not capture in its next turn. */
    calm?: Side | null };
  pending: null | { kind: 'promoM' | 'promoO'; at: number };
  options: Options;
  lastMove: LastMove | null;
  lastDice: [number, number] | null;
  /** Campaign battle: who fights where (see battle.ts). */
  battle?: BattleInfo;
  /** Before the start of a campaign battle: pieces each side still has to take off the board. */
  deploy?: Partial<Record<Side, Partial<Record<PieceType, number>>>>;
  log: string[];
  /** Complete protocol of the game (log is capped at 30 lines), used for feedback and replays. */
  record?: string[];
}

export const SIDE_NAME: Record<Side, string> = { M: 'Mannschaft', O: 'Offiziere' };
export const opp = (s: Side): Side => (s === 'M' ? 'O' : 'M');

export const PIECES: Record<PieceType, { n: string; s: Side; r: string }> = {
  stone: { n: 'Mannschaftsstein', s: 'M', r: 'Zieht 1 Feld diagonal vorwärts auf ein freies Feld (Dame). Schlägt durch Überspringen auf ein freies Feld: vorne, seitlich, diagonal. Der erste Schlag einer Serie geht Richtung Gegner, weitere Schläge auch rückwärts. Erreicht der Stein das Achterdeck (Reihe 8), endet der Zug dort und er wird befördert.' },
  FL: { n: 'First Leutnant', s: 'O', r: 'Zieht wie der König im Schach. Wird er geschlagen, gewinnt die Mannschaft.' },
  CAP: { n: 'Captain', s: 'O', r: 'Zieht wie die Dame im Schach.' },
  KAN: { n: 'Kanonade', s: 'O', r: 'Zieht wie der Turm im Schach.' },
  KAP: { n: 'Kaplan', s: 'O', r: 'Zieht wie der Läufer im Schach.' },
  MAR: { n: 'Marine', s: 'O', r: 'Zieht wie der Springer im Schach und überspringt Figuren.' },
  INF: { n: 'Infanterist', s: 'O', r: 'Zieht wie der Bauer im Schach: 1 Feld vorwärts, aus der Startreihe wahlweise 2. Schlägt 1 Feld diagonal vorwärts. Auf Reihe 1 wird er umgewandelt.' },
  PT: { n: 'Beförderter Stein (Turm)', s: 'M', r: 'Entsteht bei Pasch auf dem Achterdeck. Zieht und schlägt wie ein Turm. Gilt als Offizier und hat Schlagpflicht.' },
  PL: { n: 'Beförderter Stein (Läufer)', s: 'M', r: 'Entsteht ohne Pasch auf dem Achterdeck. Zieht und schlägt wie ein Läufer. Gilt als Offizier und hat Schlagpflicht.' },
};

export const CARDS: Record<CardKey, { t: string; sym: string; e: string; M: string; O: string }> = {
  grog: { t: 'Grog-Fass', sym: '⚓', e: 'Die Gegenseite setzt ihren nächsten Zug aus.',
    O: 'Ein Fass Grog von der Dumpling ist unter Deck „verloren gegangen“. Die Mannschaft singt Shanties und ist bis zur nächsten Glocke zu nichts zu gebrauchen.',
    M: 'Captain Yorrick Wright lädt zum Dinner in die Offiziersmesse. Nach dem dritten Glas Port ist auf dem Achterdeck niemand mehr dienstfähig.' },
  // Key stays "kopf" (formerly "Kühler Kopf") so that saved and running games keep their hands.
  kopf: { t: 'Ruhe vor dem Sturm', sym: '☁', e: 'Die Gegenseite darf in ihrem nächsten Zug nicht schlagen.',
    O: 'Vor der Küste von Maltan fällt das Barometer ins Bodenlose. Captain Wright lässt alle Mann Segel reffen. Für Händel an Deck bleibt keine Hand frei.',
    M: 'Totenstille vor dem Unwetter. Die Offiziere der Heart of the Tempest stehen am Glas und starren auf den Horizont. Um die Mannschaft kümmert sich gerade keiner.' },
  boee: { t: 'Böe von Steuerbord', sym: '≈', e: 'Eine deiner Figuren darf in diesem Zug 1 Feld in jede Richtung auf ein freies Feld ziehen. Die Schlagpflicht entfällt.',
    O: 'Eine Böe vor der Küste von Maltan wirft das Schiff auf die Seite. Die Offiziere suchen sich neue Positionen.',
    M: 'Die See schlägt über die Reling. Die Leute weichen aus, wohin es eben geht.' },
  arzt: { t: 'Schiffsarzt', sym: '✚', e: 'Deine zuletzt geschlagene Figur kehrt auf ein freies Feld deiner Grundreihe zurück.',
    O: 'Der Schiffsarzt flickt den Gefallenen zusammen. Mit frischem Verband meldet er sich zurück zum Dienst.',
    M: 'Der Smutje hat mehr Wunden genäht als Hühner gerupft. Der Matrose steht wieder auf den Beinen.' },
  wache: { t: 'Ehrenwache', sym: '⛨', e: 'Wähle eine deiner Figuren. Sie kann bis zum Ende des nächsten gegnerischen Zugs nicht geschlagen werden.',
    O: 'Die Marines ziehen einen Kordon. Wer an diesen Offizier will, muss erst an den Bajonetten vorbei.',
    M: 'Die Kameraden schließen die Reihen. Aus der Back wird keiner zurückgelassen.' },
  blatt: { t: 'Maltaner Standart', sym: '✉', e: 'Die Gegenseite legt eine zufällige Karte ab.',
    O: 'Molly Hoppler berichtet im Maltaner Standart über Meuterei-Gerüchte. Der Plan der Mannschaft ist geplatzt, bevor er begonnen hat.',
    M: 'Der Maltaner Standart druckt Klatsch aus der Offiziersmesse. Die Herren sind mit Dementis beschäftigt und vergessen ihre Pläne.' },
};

export const idx = (r: number, c: number) => r * 8 + c;
export const rc = (i: number): [number, number] => [Math.floor(i / 8), i % 8];
export const sqName = (i: number) => 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8));
export const fromName = (n: string) => idx(8 - Number(n[1]), 'abcdefgh'.indexOf(n[0]));
const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

const D8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const RK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

// mPflicht is kept only so older stored games still load; it no longer has any effect.
export const DEFAULT_OPTIONS: Options = { mPflicht: false, sideFirst: true };

export function startBoard(): Square[] {
  const b: Square[] = Array(64).fill(null);
  const put = (n: string, t: PieceType) => { b[fromName(n)] = { t, s: PIECES[t].s }; };
  ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'b2', 'd2', 'f2', 'h2', 'a3', 'c3', 'e3', 'g3'].forEach((n) => put(n, 'stone'));
  (['KAN', 'MAR', 'KAP', 'CAP', 'FL', 'KAP', 'MAR', 'KAN'] as PieceType[]).forEach((t, c) => put('abcdefgh'[c] + '8', t));
  'abcdefgh'.split('').forEach((f) => put(f + '7', 'INF'));
  return b;
}

/** Moves of one piece by its movement rules alone (no turn, no capture obligation). */
export function rawMoves(board: Square[], from: number, options: Options = DEFAULT_OPTIONS): Move[] {
  const p = board[from];
  if (!p) return [];
  const [r, c] = rc(from);
  const s = p.s;
  const out: Move[] = [];
  const enemy = (q: Square) => !!q && q.s !== s && !q.shielded;

  if (p.t === 'stone') {
    const first = [[-1, 0], [-1, -1], [-1, 1], ...(options.sideFirst ? [[0, -1], [0, 1]] : [])];
    const dfs = (cr: number, cc: number, jumped: number[], path: number[], isFirst: boolean) => {
      // Reaching the Achterdeck (rank 8) ends the series at once: the stone is promoted there (beta feedback 30.10.2026).
      if (jumped.length && cr === 0) { out.push({ from, to: idx(cr, cc), cap: jumped, path }); return; }
      let ext = false;
      for (const [dr, dc] of isFirst ? first : D8) {
        const mr = cr + dr, mc = cc + dc, lr = cr + 2 * dr, lc = cc + 2 * dc;
        if (!inB(lr, lc)) continue;
        const mi = idx(mr, mc), li = idx(lr, lc);
        if (!enemy(board[mi]) || jumped.includes(mi)) continue;
        if (board[li] && li !== from) continue;
        ext = true;
        dfs(lr, lc, [...jumped, mi], [...path, li], false);
      }
      if (!ext && jumped.length) out.push({ from, to: idx(cr, cc), cap: jumped, path });
    };
    dfs(r, c, [], [], true);
    for (const dc of [-1, 1]) {
      const rr = r - 1, cc = c + dc;
      if (inB(rr, cc) && !board[idx(rr, cc)]) out.push({ from, to: idx(rr, cc), cap: [], path: [idx(rr, cc)] });
    }
    return out;
  }

  if (p.t === 'INF') {
    const one = idx(r + 1, c);
    if (inB(r + 1, c) && !board[one]) {
      out.push({ from, to: one, cap: [], path: [one] });
      const two = idx(r + 2, c);
      if (r === 1 && !board[two] && !options.furt) out.push({ from, to: two, cap: [], path: [two] });
    }
    for (const dc of [-1, 1]) {
      const rr = r + 1, cc = c + dc;
      if (inB(rr, cc) && enemy(board[idx(rr, cc)])) out.push({ from, to: idx(rr, cc), cap: [idx(rr, cc)], path: [idx(rr, cc)] });
    }
    return out;
  }

  let dirs = KN, slide = false;
  if (p.t === 'FL') dirs = D8;
  else if (p.t === 'CAP') { dirs = D8; slide = true; }
  else if (p.t === 'KAN' || p.t === 'PT') { dirs = RK; slide = true; }
  else if (p.t === 'KAP' || p.t === 'PL') { dirs = BS; slide = true; }
  for (const [dr, dc] of dirs) {
    let rr = r + dr, cc = c + dc;
    while (inB(rr, cc)) {
      const i = idx(rr, cc), q = board[i];
      if (!q) out.push({ from, to: i, cap: [], path: [i] });
      else { if (enemy(q)) out.push({ from, to: i, cap: [i], path: [i] }); break; }
      if (!slide) break;
      rr += dr; cc += dc;
    }
  }
  return out;
}

/** Promoted crew pieces count as officers (rule clarification 30.10.2026). */
export const PROMOTED: PieceType[] = ['PT', 'PL'];

/**
 * Officers are obliged to capture. Plain crew stones are not (fixed rule since 19.10.2026), but a stone promoted on the
 * Achterdeck becomes an officer and from then on must capture: if it can capture, the crew's move must be a capture.
 */
export function mustCapture(board: Square[], side: Side, options: Options): boolean {
  return board.some((p, i) => p && p.s === side && (side === 'O' || PROMOTED.includes(p.t))
    && rawMoves(board, i, options).some((m) => m.cap.length));
}

/** Legal moves for a piece. With `free` the turn is ignored (test scenes); card effects still apply to the side to move. */
export function legalMoves(st: GameState, from: number, free = false): Move[] {
  const p = st.board[from];
  if (!p) return [];
  if (!free && (st.phase !== 'play' || p.s !== st.turn || st.pending || st.fx.shieldPick || st.fx.moved)) return [];
  let mv = rawMoves(st.board, from, st.options);
  const own = p.s === st.turn;
  const retreat = own && st.fx.retreat;
  if (retreat) {
    const [r, c] = rc(from);
    for (const [dr, dc] of D8) {
      const rr = r + dr, cc = c + dc, i = idx(rr, cc);
      if (inB(rr, cc) && !st.board[i] && !mv.some((m) => m.to === i)) mv.push({ from, to: i, cap: [], path: [i], retreat: true });
    }
  }
  if (calmed(st, p.s)) return mv.filter((m) => !m.cap.length);
  const exempt = own && (st.fx.noPflicht || st.fx.retreat);
  if (!exempt && mustCapture(st.board, p.s, st.options)) mv = mv.filter((m) => m.cap.length);
  return mv;
}

/**
 * "Ruhe vor dem Sturm" holds for `side` – unless that side has no quiet move at all, then the card fizzles
 * (nobody may be left without a legal move).
 */
export function calmed(st: GameState, side: Side): boolean {
  if (st.fx.calm !== side || st.turn !== side) return false;
  return st.board.some((p, i) => p && p.s === side && rawMoves(st.board, i, st.options).some((m) => !m.cap.length));
}

export function winnerOf(board: Square[]): Side | null {
  let o = 0, m = 0, fl = false;
  for (const p of board) { if (!p) continue; if (p.s === 'O') { o++; if (p.t === 'FL') fl = true; } else m++; }
  if (o && !fl) return 'M';
  if (o && m === 0) return 'O';
  return null;
}

const clone = (st: GameState): GameState => JSON.parse(JSON.stringify(st));
const pushLog = (st: GameState, line: string) => {
  st.log = [line, ...st.log].slice(0, 30);
  st.record = [...(st.record ?? []), line].slice(-600);
};

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const rollDie = (rng: Rng) => 1 + Math.floor(rng() * 6);

export function newGame(rng: Rng, options: Options = DEFAULT_OPTIONS): GameState {
  const deck = shuffle((Object.keys(CARDS) as CardKey[]).flatMap((k) => [k, k]), rng);
  return {
    v: 0, board: startBoard(), phase: 'setup', turn: 'M', winner: null, winReason: null, moveNo: 1,
    hands: { M: deck.slice(0, 2), O: deck.slice(2, 4) }, captured: { M: [], O: [] },
    fx: { skip: { M: 0, O: 0 }, noPflicht: false, retreat: false, played: false, shieldPick: false, moved: false },
    pending: null, options: { ...options }, lastMove: null, lastDice: null, log: ['Neue Partie. Karten verteilt.'],
    record: ['Neue Partie. Karten verteilt.'],
  };
}

export function startGame(prev: GameState, side: Side, note?: string): GameState {
  if (prev.phase !== 'setup') throw new Error('Die Partie läuft bereits.');
  if (prev.deploy) throw new Error('Erst aufstellen: Beide Seiten müssen ihre fehlenden Figuren vom Brett nehmen.');
  if (prev.battle?.first && prev.battle.first !== side) throw new Error(`Hier beginnen die ${SIDE_NAME[prev.battle.first]}.`);
  const st = clone(prev);
  st.phase = 'play'; st.turn = side; st.v++;
  if (note) pushLog(st, note);
  pushLog(st, `${SIDE_NAME[side]} beginnen`);
  return st;
}

function finishTurn(st: GameState) {
  const w = winnerOf(st.board);
  if (w) {
    st.phase = 'over'; st.winner = w;
    st.winReason = w === 'M' ? 'Der First Leutnant ist gefallen.' : 'Die Mannschaft ist geschlagen.';
    pushLog(st, `${SIDE_NAME[w]} gewinnen`);
    return;
  }
  const ending = st.turn;
  for (const p of st.board) if (p && p.s !== ending) delete p.shielded;
  st.fx.noPflicht = false; st.fx.retreat = false; st.fx.played = false; st.fx.moved = false;
  if (st.fx.calm === ending) st.fx.calm = null;
  st.moveNo++;
  const other = opp(ending);
  if (st.fx.skip[other] > 0) { st.fx.skip[other]--; pushLog(st, `${SIDE_NAME[other]} setzen aus – ${SIDE_NAME[ending]} ziehen erneut`); }
  else st.turn = other;
}

/** Cards that change how a piece moves only make sense before the move. */
export const BEFORE_MOVE_ONLY: CardKey[] = ['boee'];

/** True if `side` still holds a card it could play right now. */
export function hasPlayableCard(st: GameState, side: Side): boolean {
  return st.hands[side].some((k) => !cardBlocker(st, side, k));
}

/**
 * After a move the mover may still play one card (if none was played this turn).
 * The turn then waits for a card or an explicit "end turn"; otherwise it passes at once.
 */
function afterMove(st: GameState) {
  if (winnerOf(st.board)) { finishTurn(st); return; }
  st.fx.moved = true;
  if (!hasPlayableCard(st, st.turn)) finishTurn(st);
}

export function endTurn(prev: GameState, side: Side): GameState {
  if (prev.phase !== 'play' || prev.turn !== side) throw new Error('Du bist gerade nicht am Zug.');
  if (!prev.fx.moved) throw new Error('Erst ziehen, dann den Zug beenden.');
  if (prev.fx.shieldPick) throw new Error('Erst eine Figur für die Ehrenwache wählen.');
  const st = clone(prev);
  finishTurn(st); st.v++;
  return st;
}

export function applyMove(prev: GameState, from: number, to: number, path?: number[]): GameState {
  const legal = legalMoves(prev, from).filter((m) => m.to === to);
  if (!legal.length) throw new Error('Dieser Zug ist nicht erlaubt.');
  const m = (path && legal.find((x) => x.path.join() === path.join())) || legal.sort((a, b) => b.cap.length - a.cap.length)[0];
  const st = clone(prev);
  const p = st.board[from]!;
  st.board[from] = null;
  for (const ci of m.cap) { const q = st.board[ci]; if (q) st.captured[q.s].push(q.t); st.board[ci] = null; }
  st.board[to] = p;
  st.lastMove = { ...m, t: p.t, s: p.s };
  st.lastDice = null;
  pushLog(st, `${st.moveNo}. ${PIECES[p.t].n} ${sqName(from)} → ${sqName(to)}${m.cap.length ? ` · schlägt ${m.cap.map(sqName).join(', ')}` : ''}`);
  const [tr] = rc(to);
  if (p.t === 'stone' && tr === 0 && !winnerOf(st.board)) st.pending = { kind: 'promoM', at: to };
  else if (p.t === 'INF' && tr === 7 && !winnerOf(st.board)) st.pending = { kind: 'promoO', at: to };
  else afterMove(st);
  st.v++;
  return st;
}

export function resolvePromotionRoll(prev: GameState, dice: [number, number]): GameState {
  if (prev.pending?.kind !== 'promoM') throw new Error('Keine Beförderung offen.');
  const st = clone(prev);
  const pasch = dice[0] === dice[1];
  st.board[st.pending!.at] = { t: pasch ? 'PT' : 'PL', s: 'M' };
  st.lastDice = dice;
  pushLog(st, `Würfel ${dice[0]} + ${dice[1]}: ${pasch ? 'Pasch → Turm' : 'kein Pasch → Läufer'}`);
  st.pending = null; st.lastMove = null;
  afterMove(st); st.v++;
  return st;
}

export function resolveConversion(prev: GameState, t: PieceType): GameState {
  if (prev.pending?.kind !== 'promoO') throw new Error('Keine Umwandlung offen.');
  if (!['CAP', 'KAN', 'KAP', 'MAR'].includes(t)) throw new Error('Ungültige Figur.');
  const st = clone(prev);
  st.board[st.pending!.at] = { t, s: 'O' };
  pushLog(st, `Infanterist wird ${PIECES[t].n}`);
  st.pending = null; st.lastMove = null;
  afterMove(st); st.v++;
  return st;
}

export function reviveSquare(board: Square[], side: Side, t: PieceType): number | null {
  const order = [3, 4, 2, 5, 1, 6, 0, 7];
  if (side === 'M') {
    for (const r of [7, 6]) for (const c of order) if (!board[idx(r, c)]) return idx(r, c);
    return null;
  }
  for (const r of t === 'INF' ? [1, 0] : [0, 1]) for (const c of order) if (!board[idx(r, c)]) return idx(r, c);
  return null;
}

export function cardBlocker(st: GameState, side: Side, key: CardKey): string {
  if (st.phase === 'setup') return 'Die Partie hat noch nicht begonnen.';
  if (st.phase === 'over') return 'Die Partie ist beendet.';
  if (st.turn !== side) return `Spielbar, wenn die ${SIDE_NAME[side]} am Zug sind.`;
  if (st.fx.played) return 'Pro Zug ist nur eine Karte erlaubt.';
  if (st.pending || st.fx.shieldPick) return 'Erst die laufende Aktion abschließen.';
  if (st.fx.moved && BEFORE_MOVE_ONLY.includes(key)) return 'Diese Karte wirkt nur vor dem Ziehen.';
  if (key === 'arzt') {
    const t = st.captured[side][st.captured[side].length - 1];
    if (!t) return 'Bisher wurde keine eigene Figur geschlagen.';
    if (reviveSquare(st.board, side, t) === null) return 'Auf der Grundreihe ist kein Feld frei.';
  }
  if (key === 'blatt' && !st.hands[opp(side)].length) return 'Die Gegenseite hat keine Karten mehr.';
  return '';
}

export function playCard(prev: GameState, side: Side, handIndex: number, rng: Rng): GameState {
  const key = prev.hands[side][handIndex];
  if (!key) throw new Error('Diese Karte gibt es nicht.');
  const why = cardBlocker(prev, side, key);
  if (why) throw new Error(why);
  const st = clone(prev);
  st.hands[side].splice(handIndex, 1);
  st.fx.played = true;
  st.lastMove = null;
  pushLog(st, `${SIDE_NAME[side]} spielen „${CARDS[key].t}“`);
  const o = opp(side);
  if (key === 'grog') st.fx.skip[o]++;
  if (key === 'kopf') { st.fx.calm = o; pushLog(st, `${SIDE_NAME[o]} dürfen im nächsten Zug nicht schlagen`); }
  if (key === 'boee') st.fx.retreat = true;
  if (key === 'arzt') {
    const t = st.captured[side].pop()!;
    const at = reviveSquare(st.board, side, t)!;
    st.board[at] = { t, s: side };
    pushLog(st, `${PIECES[t].n} kehrt auf ${sqName(at)} zurück`);
  }
  if (key === 'wache') st.fx.shieldPick = true;
  if (key === 'blatt') {
    const i = Math.floor(rng() * st.hands[o].length);
    const lost = st.hands[o].splice(i, 1)[0];
    pushLog(st, `${SIDE_NAME[o]} verlieren „${CARDS[lost].t}“`);
  }
  if (st.fx.moved && !st.fx.shieldPick) finishTurn(st);
  st.v++;
  return st;
}

export function chooseShield(prev: GameState, at: number): GameState {
  if (!prev.fx.shieldPick) throw new Error('Keine Ehrenwache offen.');
  const p = prev.board[at];
  if (!p || p.s !== prev.turn) throw new Error('Wähle eine eigene Figur.');
  const st = clone(prev);
  st.board[at] = { ...p, shielded: true };
  st.fx.shieldPick = false;
  pushLog(st, `Ehrenwache schützt ${PIECES[p.t].n} auf ${sqName(at)}`);
  if (st.fx.moved) finishTurn(st);
  st.v++;
  return st;
}

export function resign(prev: GameState, side: Side): GameState {
  if (prev.phase === 'over') throw new Error('Die Partie ist beendet.');
  const st = clone(prev);
  st.phase = 'over'; st.winner = opp(side);
  st.winReason = side === 'M' ? 'Die Mannschaft hat sich ergeben.' : 'Die Offiziere haben die Flagge gestrichen.';
  pushLog(st, `${SIDE_NAME[side]} geben auf`);
  st.v++;
  return st;
}

/** Empty-hand scene for rule testing; `put` uses square names like "c3". */
export function scene(pieces: [string, PieceType][], options: Options = DEFAULT_OPTIONS): GameState {
  const st = newGame(() => 0, options);
  st.board = Array(64).fill(null);
  for (const [n, t] of pieces) st.board[fromName(n)] = { t, s: PIECES[t].s };
  st.hands = { M: [], O: [] };
  st.phase = 'play';
  st.log = [];
  return st;
}
