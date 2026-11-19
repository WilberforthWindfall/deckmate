// Deckmate rules engine: pure, serializable, no UI or Firebase dependencies.
// Board is a flat array of 64 squares (index = row * 8 + col); row 0 is rank 8 (officers' home row).

export type Side = 'M' | 'O';
/**
 * Internal piece keys stay stable so that stored games keep working, even though the testers renamed the pieces
 * (19.11.2026): FL = king piece, now called "Captain" · CAP = queen piece, now "First Lieutenant" ·
 * KAN = rook piece, now "Mörser" · INF = pawn piece "Fähnrich" · STW = Steward (bribed crew stone, neutral).
 */
export type PieceType = 'stone' | 'FL' | 'CAP' | 'KAN' | 'KAP' | 'MAR' | 'INF' | 'PT' | 'PL' | 'STW';
export type Coin = 'sov' | 'crown' | 'halfcrown' | 'florin' | 'shilling' | 'sixpence' | 'penny' | 'halfpenny' | 'farthing';
export interface Piece {
  t: PieceType; s: Side; shielded?: boolean;
  /** Ugur sleeps in this crew stone. Known to nobody – the UI must never show it. */
  possessed?: true;
  /** Former officer possessed by Ugur: led by the crew, painted black, no capture obligation. */
  ugur?: true;
  /** Coins lying on a Steward. */
  coins?: Coin[];
}
export type Square = Piece | null;
export type CardKey = 'grog' | 'kopf' | 'boee' | 'arzt' | 'wache' | 'blatt' | 'zora';
export type Rng = () => number;
export type Terrain = 'ebene' | 'fluss' | 'gebirge' | 'huegel';
export interface Army { house: string; size: number; spec: { CAP: number; KAP: number; KAN: number; MAR: number } }
export interface BattleInfo { province: string; terrain: Terrain; attacker: Army; defender: Army; first?: Side;
  /** Landscape of the campaign hex (A, W, S, G, F, K, H) – only changes how the board looks. */
  land?: string }

export interface Move { from: number; to: number; path: number[]; cap: number[]; retreat?: boolean;
  /** Castling (officers only): square of the Mörser that jumps to the other side of the Captain. */
  castle?: { rookFrom: number; rookTo: number } }
export interface LastMove extends Move { t: PieceType; s: Side }

export interface Options { mPflicht: boolean; sideFirst: boolean; /** Furt (Flussgelände): Fähnriche ohne Doppelschritt. */ furt?: boolean;
  /** Rule extensions of 19.11.2026. Missing (older games, campaign battles) = off. */
  zora?: boolean; ugur?: boolean; steward?: boolean }

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
    calm?: Side | null;
    /** Rota Zora was played: the crew's skipped turn still lets Ugur move. */
    zora?: boolean;
    /** The crew is confused by Rota Zora: only Ugur may move in this turn. */
    onlyUgur?: boolean;
    /** Steward actions already used this turn. */
    bribed?: boolean; stewardMoved?: boolean };
  pending: null | { kind: 'promoM' | 'promoO' | 'ugur'; at: number; options?: number[] };
  /** 2 = Captain (king piece) on d8, First Lieutenant on e8 (19.11.2026). Missing = older games with the king piece on e8. */
  layout?: number;
  /** Coins each side may still place on Stewards. */
  purse?: Record<Side, Coin[]>;
  /** Compact board after every action, for the replay library (see replay.ts). */
  replay?: string[];
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
  /** Officers' castling: which home pieces have already moved (or been captured). Missing = nothing has moved yet. */
  castleLost?: { FL?: true; a?: true; h?: true };
  /** Last card played, so the other side can be shown it prominently (beta feedback #26). */
  lastCard?: { side: Side; key: CardKey; moveNo: number; v: number } | null;
}

export const SIDE_NAME: Record<Side, string> = { M: 'Mannschaft', O: 'Offiziere' };
export const opp = (s: Side): Side => (s === 'M' ? 'O' : 'M');

export const PIECES: Record<PieceType, { n: string; s: Side; r: string }> = {
  stone: { n: 'Mannschaftsstein', s: 'M', r: 'Zieht 1 Feld diagonal vorwärts auf ein freies Feld (Dame). Schlägt durch Überspringen auf ein freies Feld: vorne, seitlich, diagonal. Der erste Schlag einer Serie geht Richtung Gegner, weitere Schläge auch rückwärts. Die Serie darf nach jedem Sprung beendet werden. Erreicht der Stein das Achterdeck (Reihe 8), endet der Zug dort und er wird befördert.' },
  FL: { n: 'Captain', s: 'O', r: 'Zieht wie der König im Schach, auch die Rochade mit einem Mörser in der Ecke (beide noch nicht bewegt, Felder dazwischen frei). Wird er geschlagen, gewinnt die Mannschaft.' },
  CAP: { n: 'First Lieutenant', s: 'O', r: 'Zieht wie die Dame im Schach. Ergreift Ugur den Captain, übernimmt der First Lieutenant das Kommando.' },
  KAN: { n: 'Mörser', s: 'O', r: 'Zieht wie der Turm im Schach.' },
  KAP: { n: 'Kaplan', s: 'O', r: 'Zieht wie der Läufer im Schach.' },
  MAR: { n: 'Marine', s: 'O', r: 'Zieht wie der Springer im Schach und überspringt Figuren.' },
  INF: { n: 'Fähnrich', s: 'O', r: 'Zieht wie der Bauer im Schach: 1 Feld vorwärts, aus der Startreihe wahlweise 2. Schlägt 1 Feld diagonal vorwärts. Auf Reihe 1 wird er umgewandelt.' },
  PT: { n: 'Beförderter Stein (Turm)', s: 'M', r: 'Entsteht bei Pasch auf dem Achterdeck. Zieht und schlägt wie ein Turm. Gilt als Offizier und hat Schlagpflicht.' },
  PL: { n: 'Beförderter Stein (Läufer)', s: 'M', r: 'Entsteht ohne Pasch auf dem Achterdeck. Zieht und schlägt wie ein Läufer. Gilt als Offizier und hat Schlagpflicht.' },
  STW: { n: 'Steward', s: 'M', r: 'Bestochener Mannschaftsstein. Kann nicht geschlagen werden und schlägt nicht, er steht im Weg. Jede Seite darf ihn vor ihrem Zug 1 Feld in jede Richtung bewegen, wenn eine eigene Figur neben ihm steht oder ihn schlagen könnte – dafür legt sie eine Münze auf ihn. Für den Sieg der Offiziere muss er nicht geschlagen werden.' },
};

/** Display name of a piece on the board (Ugur and Steward included). */
export function pieceName(p: Piece): string {
  if (p.ugur) return `Ugur (${PIECES[p.t].n})`;
  return PIECES[p.t].n;
}

/** Rules text of a piece on the board. */
export function pieceRule(p: Piece): string {
  if (!p.ugur) return PIECES[p.t].r;
  const base = p.t === 'INF'
    ? 'Zieht wie ein Fähnrich, aber in Gegenrichtung (zum Achterdeck). Erreicht er das Achterdeck, springt Ugur auf einen Offizier über und der Fähnrich kehrt zu den Offizieren zurück.'
    : `Zieht und schlägt wie ${p.t === 'FL' ? 'der Captain' : p.t === 'CAP' ? 'der First Lieutenant' : `ein ${PIECES[p.t].n}`}.`;
  return `Vom Dämon Ugur besessen und von der Mannschaft geführt. ${base} Ugur hat keine Schlagpflicht – Dämonen kennen keine Ehre.`;
}

/** Steward coins (19.11.2026). Value in farthings, for the payout counter. */
export const COINS: Record<Coin, { n: string; metal: 'gold' | 'silber' | 'kupfer'; size: number; value: number; weight: number }> = {
  sov: { n: 'Sovereign', metal: 'gold', size: 1, value: 960, weight: 1 },
  crown: { n: 'Crown', metal: 'silber', size: 1, value: 240, weight: 1 },
  halfcrown: { n: 'Halfcrown', metal: 'silber', size: 0.9, value: 120, weight: 2 },
  florin: { n: 'Florin', metal: 'silber', size: 0.82, value: 96, weight: 2 },
  shilling: { n: 'Schilling', metal: 'silber', size: 0.72, value: 48, weight: 3 },
  sixpence: { n: 'Sixpence', metal: 'silber', size: 0.6, value: 24, weight: 3 },
  penny: { n: 'Penny', metal: 'kupfer', size: 0.95, value: 4, weight: 4 },
  halfpenny: { n: 'Halfpenny', metal: 'kupfer', size: 0.8, value: 2, weight: 4 },
  farthing: { n: 'Farthing', metal: 'kupfer', size: 0.65, value: 1, weight: 4 },
};
export const COIN_ORDER = Object.keys(COINS) as Coin[];

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
  // Officers only, once per game; not part of the shuffled deck (rule extension 19.11.2026).
  zora: { t: 'Die Rota Zora', sym: '❦', e: 'Die Mannschaft ist verwirrt: Die Offiziere sind ein weiteres Mal an der Reihe. Nur Ugur, wenn er schon erwacht ist, lässt sich nicht verwirren und darf ziehen. Einmal pro Partie.',
    O: 'Die Rota Zora betritt das Deck, und mit ihr ein Duft von Rosenwasser und Pulverdampf. Die Mannschaft vergisst Tau und Pflicht und starrt ihr nach, während die Offiziere in aller Ruhe ihre Stellungen beziehen.',
    M: 'Die Rota Zora betritt das Deck. Keiner an Bord weiß mehr, wohin er eigentlich wollte.' },
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
export const DEFAULT_OPTIONS: Options = { mPflicht: false, sideFirst: true, zora: true, ugur: true, steward: true };

/** Captain (king piece) on the wine-red d8, First Lieutenant (queen piece) on the golden e8 (19.11.2026). */
export const LAYOUT = 2;
/** Column of the Captain's home square: d8 in new games, e8 in games started before 19.11.2026. */
export const captainHome = (st: { layout?: number }) => (st.layout === LAYOUT ? 3 : 4);

export function startBoard(): Square[] {
  const b: Square[] = Array(64).fill(null);
  const put = (n: string, t: PieceType) => { b[fromName(n)] = { t, s: PIECES[t].s }; };
  ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'b2', 'd2', 'f2', 'h2', 'a3', 'c3', 'e3', 'g3'].forEach((n) => put(n, 'stone'));
  (['KAN', 'MAR', 'KAP', 'FL', 'CAP', 'KAP', 'MAR', 'KAN'] as PieceType[]).forEach((t, c) => put('abcdefgh'[c] + '8', t));
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
  const enemy = (q: Square) => !!q && q.s !== s && !q.shielded && q.t !== 'STW';
  if (p.t === 'STW') return [];

  if (p.t === 'stone') {
    const first = [[-1, 0], [-1, -1], [-1, 1], ...(options.sideFirst ? [[0, -1], [0, 1]] : [])];
    const dfs = (cr: number, cc: number, jumped: number[], path: number[], isFirst: boolean) => {
      // Reaching the Achterdeck (rank 8) ends the series at once: the stone is promoted there (beta feedback 30.10.2026).
      if (jumped.length && cr === 0) { series.push({ from, to: idx(cr, cc), cap: jumped, path }); return; }
      // A series may be stopped after any jump (rule clarification 30.10.2026): every landing square is a legal end.
      if (jumped.length) series.push({ from, to: idx(cr, cc), cap: jumped, path });
      for (const [dr, dc] of isFirst ? first : D8) {
        const mr = cr + dr, mc = cc + dc, lr = cr + 2 * dr, lc = cc + 2 * dc;
        if (!inB(lr, lc)) continue;
        const mi = idx(mr, mc), li = idx(lr, lc);
        if (!enemy(board[mi]) || jumped.includes(mi)) continue;
        if (board[li] && li !== from) continue;
        dfs(lr, lc, [...jumped, mi], [...path, li], false);
      }
    };
    const series: Move[] = [];
    dfs(r, c, [], [], true);
    // One move per target square: the one that captures most.
    const best = new Map<number, Move>();
    for (const m of series) { const b = best.get(m.to); if (!b || m.cap.length > b.cap.length) best.set(m.to, m); }
    out.push(...best.values());
    for (const dc of [-1, 1]) {
      const rr = r - 1, cc = c + dc;
      if (inB(rr, cc) && !board[idx(rr, cc)]) out.push({ from, to: idx(rr, cc), cap: [], path: [idx(rr, cc)] });
    }
    return out;
  }

  if (p.t === 'INF') {
    // A Fähnrich possessed by Ugur moves and captures the other way round, towards the Achterdeck.
    const d = p.ugur ? -1 : 1, startRow = p.ugur ? 6 : 1;
    const one = idx(r + d, c);
    if (inB(r + d, c) && !board[one]) {
      out.push({ from, to: one, cap: [], path: [one] });
      const two = idx(r + 2 * d, c);
      if (r === startRow && !board[two] && !options.furt) out.push({ from, to: two, cap: [], path: [two] });
    }
    for (const dc of [-1, 1]) {
      const rr = r + d, cc = c + dc;
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
  if (p.t === 'STW') return [];
  if (!free && st.fx.onlyUgur && !p.ugur) return [];
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
  if (p.t === 'FL' && !retreat) mv.push(...castleMoves(st, from));
  if (calmed(st, p.s)) return mv.filter((m) => !m.cap.length);
  const exempt = own && (st.fx.noPflicht || st.fx.retreat);
  if (!exempt && mustCapture(st.board, p.s, st.options)) mv = mv.filter((m) => m.cap.length);
  return mv;
}

/**
 * Castling for the officers, as in chess: Captain (d8, older games e8) and the Mörser in the corner (a8 / h8) have not moved,
 * the squares between them are empty. Deckmate has no check, so the "not through check" conditions do not apply.
 * A castling move is no capture, so the capture obligation rules it out whenever an officer can capture.
 */
export function castleMoves(st: GameState, from: number): Move[] {
  const p = st.board[from];
  const lost = st.castleLost ?? {};
  const home = captainHome(st);
  if (!p || p.t !== 'FL' || p.s !== 'O' || p.ugur || from !== idx(0, home) || lost.FL) return [];
  const out: Move[] = [];
  // The Captain moves two squares towards the Mörser, which jumps over him (works for d8 and e8 alike).
  const between = (a: number, b: number) => Array.from({ length: Math.abs(b - a) - 1 }, (_, k) => Math.min(a, b) + 1 + k);
  const sides = [
    { key: 'h' as const, rook: idx(0, 7), empty: between(home, 7), to: home + 2, rookTo: home + 1 },
    { key: 'a' as const, rook: idx(0, 0), empty: between(0, home), to: home - 2, rookTo: home - 1 },
  ];
  for (const d of sides) {
    const r = st.board[d.rook];
    if (lost[d.key] || !r || r.t !== 'KAN' || r.s !== 'O' || r.ugur) continue;
    if (d.empty.some((c) => st.board[idx(0, c)])) continue;
    out.push({ from, to: idx(0, d.to), cap: [], path: [idx(0, d.to)], castle: { rookFrom: d.rook, rookTo: idx(0, d.rookTo) } });
  }
  return out;
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
  // Stewards do not count: the officers need not take them to win.
  for (const p of board) { if (!p || p.t === 'STW') continue; if (p.s === 'O') { o++; if (p.t === 'FL') fl = true; } else m++; }
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

/** One W6 roll per side decides how many coins it gets; each coin's kind is drawn (copper often, gold rarely). */
export function rollPurse(rng: Rng): { n: number; coins: Coin[] } {
  const n = rollDie(rng);
  const total = COIN_ORDER.reduce((a, k) => a + COINS[k].weight, 0);
  const coins: Coin[] = [];
  for (let i = 0; i < n; i++) {
    let x = rng() * total;
    const k = COIN_ORDER.find((c) => (x -= COINS[c].weight) < 0) ?? 'farthing';
    coins.push(k);
  }
  return { n, coins: coins.sort((a, b) => COINS[b].value - COINS[a].value) };
}

export const coinsText = (list: Coin[]) => {
  const n = new Map<Coin, number>();
  for (const c of list) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n].map(([c, k]) => `${k}× ${COINS[c].n}`).join(', ');
};

export function newGame(rng: Rng, options: Options = DEFAULT_OPTIONS): GameState {
  const deck = shuffle((Object.keys(CARDS) as CardKey[]).filter((k) => k !== 'zora').flatMap((k) => [k, k]), rng);
  const st: GameState = {
    v: 0, board: startBoard(), phase: 'setup', turn: 'M', winner: null, winReason: null, moveNo: 1,
    hands: { M: deck.slice(0, 2), O: deck.slice(2, 4) }, captured: { M: [], O: [] },
    fx: { skip: { M: 0, O: 0 }, noPflicht: false, retreat: false, played: false, shieldPick: false, moved: false },
    pending: null, options: { ...options }, lastMove: null, lastDice: null, log: ['Neue Partie. Karten verteilt.'],
    record: ['Neue Partie. Karten verteilt.'], layout: LAYOUT,
  };
  if (options.zora) st.hands.O.push('zora');
  if (options.ugur) {
    // Nobody knows which stone in the bilge is possessed – neither side is ever shown this flag.
    const stones = st.board.flatMap((q, i) => (q?.t === 'stone' ? [i] : []));
    st.board[stones[Math.floor(rng() * stones.length)]]!.possessed = true;
    st.log.unshift('Ugur lauert in der Bilge. Niemand weiß, in welchem Stein.');
    st.record!.push('Ugur lauert in der Bilge. Niemand weiß, in welchem Stein.');
  }
  if (options.steward) {
    const m = rollPurse(rng), o = rollPurse(rng);
    st.purse = { M: m.coins, O: o.coins };
    const line = `Münzen ausgewürfelt: Mannschaft ${m.n} (${coinsText(m.coins)}), Offiziere ${o.n} (${coinsText(o.coins)})`;
    st.log.unshift(line); st.record!.push(line);
  }
  return st;
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
    st.winReason = w === 'M' ? 'Der Captain ist gefallen.' : 'Die Mannschaft ist geschlagen.';
    pushLog(st, `${SIDE_NAME[w]} gewinnen`);
    return;
  }
  const ending = st.turn;
  for (const p of st.board) if (p && p.s !== ending) delete p.shielded;
  st.fx.noPflicht = false; st.fx.retreat = false; st.fx.played = false; st.fx.moved = false;
  st.fx.bribed = false; st.fx.stewardMoved = false; st.fx.onlyUgur = false;
  if (st.fx.calm === ending) st.fx.calm = null;
  st.moveNo++;
  const other = opp(ending);
  if (st.fx.skip[other] > 0) {
    st.fx.skip[other]--;
    // Rota Zora confuses the crew, but not Ugur's mind: if he is awake (and can move), only he takes the crew's turn.
    if (other === 'M' && st.fx.zora && ugurCanMove(st)) {
      st.fx.zora = false;
      st.turn = 'M'; st.fx.onlyUgur = true;
      pushLog(st, 'Die Mannschaft ist verwirrt – nur Ugur lässt sich nicht beirren und zieht');
      return;
    }
    if (other === 'M') st.fx.zora = false;
    pushLog(st, `${SIDE_NAME[other]} setzen aus – ${SIDE_NAME[ending]} ziehen erneut`);
  } else st.turn = other;
}

function ugurCanMove(st: GameState): boolean {
  return st.board.some((p, i) => p?.ugur && rawMoves(st.board, i, st.options).length > 0);
}

// ---------- Ugur (rule extension 19.11.2026) ----------

/** Rank for Ugur's jump when several officers are equally near: Captain, First Lieutenant, Mörser, Kaplan, Marine. */
const RANK: PieceType[] = ['FL', 'CAP', 'KAN', 'KAP', 'MAR'];
const dist = (a: number, b: number) => { const [ar, ac] = rc(a), [br, bc] = rc(b); return Math.max(Math.abs(ar - br), Math.abs(ac - bc)); };

/**
 * Ugur takes the officer on `at`: it turns black and is led by the crew from now on. If that is the Captain, the
 * nearest First Lieutenant takes over command and moves like a Captain; without one the officers have lost.
 */
function possess(st: GameState, at: number) {
  const q = st.board[at]!;
  st.board[at] = { t: q.t, s: 'M', ugur: true };
  pushLog(st, `Ugur ergreift ${PIECES[q.t].n} auf ${sqName(at)} – die Figur kämpft jetzt für die Mannschaft`);
  if (q.t === 'FL') {
    const heirs = st.board.flatMap((p, i) => (p && p.s === 'O' && p.t === 'CAP' ? [i] : [])).sort((a, b) => dist(a, at) - dist(b, at));
    if (!heirs.length) {
      st.phase = 'over'; st.winner = 'M';
      st.winReason = 'Ugur hat den Captain ergriffen, und kein First Lieutenant kann das Kommando übernehmen.';
      pushLog(st, 'Mannschaft gewinnen');
      return;
    }
    st.board[heirs[0]] = { ...st.board[heirs[0]]!, t: 'FL' };
    st.castleLost = { ...(st.castleLost ?? {}), FL: true };
    pushLog(st, `Der First Lieutenant auf ${sqName(heirs[0])} übernimmt als neuer Captain das Kommando`);
  }
}

/**
 * Where Ugur may jump when his Fähnrich reaches the Achterdeck: an officer on the Achterdeck (crew's choice; the
 * Captain only if he stands there alone), otherwise the nearest officer that is no Fähnrich, highest rank first.
 */
export function ugurTargets(board: Square[]): number[] {
  const officers = board.flatMap((p, i) => (p && p.s === 'O' && p.t !== 'INF' ? [i] : []));
  const deck = officers.filter((i) => rc(i)[0] === 0);
  if (deck.length) {
    const noCaptain = deck.filter((i) => board[i]!.t !== 'FL');
    return noCaptain.length ? noCaptain : deck;
  }
  return [];
}
export function ugurNearest(board: Square[], from: number): number[] {
  const officers = board.flatMap((p, i) => (p && p.s === 'O' && p.t !== 'INF' ? [i] : []));
  if (!officers.length) return [];
  const d = Math.min(...officers.map((i) => dist(i, from)));
  const near = officers.filter((i) => dist(i, from) === d);
  const best = Math.min(...near.map((i) => RANK.indexOf(board[i]!.t)));
  return near.filter((i) => RANK.indexOf(board[i]!.t) === best);
}

/** Ugur leaves the Fähnrich on `from` (who returns to the officers) and takes the officer on `to`. */
function ugurJump(st: GameState, from: number, to: number) {
  st.board[from] = { t: 'INF', s: 'O' };
  pushLog(st, `Ugur verlässt den Fähnrich auf ${sqName(from)}, er dient wieder den Offizieren`);
  possess(st, to);
}

export function chooseUgur(prev: GameState, at: number): GameState {
  if (prev.pending?.kind !== 'ugur') throw new Error('Ugur sucht gerade kein neues Opfer.');
  if (!prev.pending.options?.includes(at)) throw new Error('Auf diesen Offizier kann Ugur nicht überspringen.');
  const st = clone(prev);
  const from = st.pending!.at;
  st.pending = null;
  ugurJump(st, from, at);
  afterMove(st); st.v++;
  return st;
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

/** "kurz" when fewer squares lie between Captain and Mörser. */
export const castleKind = (m: Move) => (m.castle && Math.abs((m.castle.rookFrom % 8) - (m.from % 8)) <= 3 ? 'kurz' : 'lang');

export function applyMove(prev: GameState, from: number, to: number, path?: number[]): GameState {
  const legal = legalMoves(prev, from).filter((m) => m.to === to);
  if (!legal.length) throw new Error('Dieser Zug ist nicht erlaubt.');
  const m = (path && legal.find((x) => x.path.join() === path.join())) || legal.sort((a, b) => b.cap.length - a.cap.length)[0];
  const st = clone(prev);
  const p = st.board[from]!;
  st.board[from] = null;
  let woke = false;
  for (const ci of m.cap) {
    const q = st.board[ci];
    if (q?.possessed && p.s === 'O') woke = true;
    // A captured Ugur is banished for good; he does not join the pieces at the edge of the table.
    if (q && !q.ugur) st.captured[q.s].push(q.t);
    if (q?.ugur) pushLog(st, `Ugur ist gebannt (${PIECES[q.t].n} auf ${sqName(ci)} geschlagen)`);
    st.board[ci] = null;
  }
  st.board[to] = p;
  // Castling rights are lost as soon as a home piece moves or is captured (or anything lands there by capture).
  const lost = { ...(st.castleLost ?? {}) };
  for (const sq of [from, ...m.cap]) {
    if (sq === idx(0, captainHome(st))) lost.FL = true;
    if (sq === idx(0, 0)) lost.a = true;
    if (sq === idx(0, 7)) lost.h = true;
  }
  if (m.castle) {
    st.board[m.castle.rookTo] = st.board[m.castle.rookFrom];
    st.board[m.castle.rookFrom] = null;
    lost.FL = true;
  }
  if (lost.FL || lost.a || lost.h) st.castleLost = lost;
  st.lastMove = { ...m, t: p.t, s: p.s };
  st.lastDice = null;
  pushLog(st, m.castle
    ? `${st.moveNo}. Rochade ${castleKind(m)}: Captain ${sqName(from)} → ${sqName(to)}, Mörser ${sqName(m.castle.rookFrom)} → ${sqName(m.castle.rookTo)}`
    : `${st.moveNo}. ${pieceName(p)} ${sqName(from)} → ${sqName(to)}${m.cap.length ? ` · schlägt ${m.cap.map(sqName).join(', ')}` : ''}`);
  const [tr] = rc(to);
  if (woke) {
    pushLog(st, 'Der geschlagene Stein war besessen! Ugur erwacht.');
    possess(st, to);
    if (st.phase === 'over') { st.v++; return st; }
  }
  const moved = st.board[to]!;
  if (moved.ugur && moved.t === 'INF' && tr === 0) {
    pushLog(st, 'Ugurs Fähnrich erreicht das Achterdeck');
    const deck = ugurTargets(st.board);
    const opts = deck.length ? deck : ugurNearest(st.board, to);
    if (opts.length === 1) ugurJump(st, to, opts[0]);
    else if (opts.length > 1) { st.pending = { kind: 'ugur', at: to, options: opts }; st.v++; return st; }
    if (st.phase === 'over') { st.v++; return st; }
    afterMove(st);
  } else if (moved.t === 'stone' && tr === 0 && !winnerOf(st.board)) st.pending = { kind: 'promoM', at: to };
  else if (moved.t === 'INF' && moved.s === 'O' && tr === 7 && !winnerOf(st.board)) st.pending = { kind: 'promoO', at: to };
  else afterMove(st);
  st.v++;
  return st;
}

export function resolvePromotionRoll(prev: GameState, dice: [number, number]): GameState {
  if (prev.pending?.kind !== 'promoM') throw new Error('Keine Beförderung offen.');
  const st = clone(prev);
  const pasch = dice[0] === dice[1];
  const was = st.board[st.pending!.at];
  st.board[st.pending!.at] = { t: pasch ? 'PT' : 'PL', s: 'M', ...(was?.possessed ? { possessed: true as const } : {}) };
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
  pushLog(st, `Fähnrich wird ${PIECES[t].n}`);
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
  if (key === 'blatt' && !st.hands[opp(side)].some((k) => k !== 'zora')) return 'Die Gegenseite hat keine Karten mehr.';
  if (key === 'zora' && side !== 'O') return 'Die Rota Zora steht nur den Offizieren bei.';
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
  st.lastCard = { side, key, moveNo: prev.moveNo, v: prev.v + 1 };
  pushLog(st, `${SIDE_NAME[side]} spielen „${CARDS[key].t}“`);
  const o = opp(side);
  if (key === 'grog') st.fx.skip[o]++;
  if (key === 'zora') { st.fx.skip.M++; st.fx.zora = true; pushLog(st, 'Die Rota Zora verwirrt die Mannschaft – die Offiziere sind ein weiteres Mal an der Reihe'); }
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
    // The Rota Zora is no card of the deck and cannot be torn up by the Maltaner Standart.
    const pool = st.hands[o].flatMap((k, i) => (k === 'zora' ? [] : [i]));
    const i = pool[Math.floor(rng() * pool.length)];
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
  if (!p || p.s !== prev.turn || p.t === 'STW') throw new Error('Wähle eine eigene Figur.');
  const st = clone(prev);
  st.board[at] = { ...p, shielded: true };
  st.fx.shieldPick = false;
  pushLog(st, `Ehrenwache schützt ${pieceName(p)} auf ${sqName(at)}`);
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

/**
 * Empty-hand scene for rule testing; `put` uses square names like "c3". Without `layout` castling uses the old
 * Captain square e8. Prefix a type with "U:" for a piece possessed by Ugur, "P:" for a stone that hides him.
 */
export function scene(pieces: [string, PieceType | `U:${PieceType}` | 'P:stone'][], options: Options = DEFAULT_OPTIONS, layout?: number): GameState {
  const st = newGame(() => 0, options);
  st.board = Array(64).fill(null);
  for (const [n, raw] of pieces) {
    const [flag, t] = raw.includes(':') ? (raw.split(':') as ['U' | 'P', PieceType]) : [null, raw as PieceType];
    st.board[fromName(n)] = flag === 'U' ? { t, s: 'M', ugur: true } : flag === 'P' ? { t, s: 'M', possessed: true } : { t, s: PIECES[t].s };
  }
  st.hands = { M: [], O: [] };
  st.phase = 'play';
  st.log = [];
  st.record = [];
  st.layout = layout;
  if (st.purse) st.purse = { M: [], O: [] };
  return st;
}

// ---------- Steward (rule extension 19.11.2026) ----------

/** Crew stones the officers could bribe right now: only while they must capture, one that an officer could take. */
export function bribeTargets(st: GameState): number[] {
  if (!st.options.steward || st.phase !== 'play' || st.turn !== 'O' || st.pending || st.fx.shieldPick || st.fx.moved || st.fx.bribed) return [];
  if (!st.purse?.O.length || st.fx.noPflicht || st.fx.retreat || calmed(st, 'O') || !mustCapture(st.board, 'O', st.options)) return [];
  const hit = new Set<number>();
  st.board.forEach((p, i) => { if (p && p.s === 'O') rawMoves(st.board, i, st.options).forEach((m) => m.cap.forEach((c) => hit.add(c))); });
  return [...hit].filter((i) => st.board[i]?.t === 'stone').sort((a, b) => a - b);
}

export function bribe(prev: GameState, at: number, coin: Coin): GameState {
  if (!bribeTargets(prev).includes(at)) throw new Error('Diesen Stein können die Offiziere gerade nicht bestechen.');
  const ci = prev.purse!.O.indexOf(coin);
  if (ci < 0) throw new Error('Diese Münze haben die Offiziere nicht.');
  const st = clone(prev);
  st.purse!.O.splice(ci, 1);
  const q = st.board[at]!;
  st.board[at] = { t: 'STW', s: 'M', coins: [coin], ...(q.possessed ? { possessed: true as const } : {}) };
  st.fx.bribed = true; st.fx.noPflicht = true;
  st.lastMove = null;
  pushLog(st, `Offiziere legen einen ${COINS[coin].n} auf den Stein ${sqName(at)} – er wird Steward, die Schlagpflicht verfällt`);
  st.v++;
  return st;
}

/** Can `side` move the Steward on `at`: an own piece next to him, or one that could capture him if he were an enemy. */
export function canCommandSteward(st: GameState, side: Side, at: number): boolean {
  const [r, c] = rc(at);
  const own = (q: Square) => !!q && q.s === side && q.t !== 'STW';
  for (const [dr, dc] of D8) { const rr = r + dr, cc = c + dc; if (inB(rr, cc) && own(st.board[idx(rr, cc)])) return true; }
  const b = st.board.slice();
  b[at] = { t: 'stone', s: opp(side) };
  return b.some((q, i) => own(q) && rawMoves(b, i, st.options).some((m) => m.cap.includes(at)));
}

/** Squares the Steward on `at` may be moved to by the side to move (like a Captain: 1 square, any direction). */
export function stewardMoves(st: GameState, at: number, side: Side = st.turn): number[] {
  const p = st.board[at];
  if (!p || p.t !== 'STW' || !st.options.steward || st.phase !== 'play' || st.turn !== side) return [];
  if (st.pending || st.fx.shieldPick || st.fx.moved || st.fx.stewardMoved || st.fx.onlyUgur || !st.purse?.[side].length) return [];
  if (!canCommandSteward(st, side, at)) return [];
  const [r, c] = rc(at);
  return D8.map(([dr, dc]) => [r + dr, c + dc]).filter(([rr, cc]) => inB(rr, cc) && !st.board[idx(rr, cc)]).map(([rr, cc]) => idx(rr, cc));
}

export function moveSteward(prev: GameState, from: number, to: number, coin: Coin): GameState {
  const side = prev.turn;
  if (!stewardMoves(prev, from, side).includes(to)) throw new Error('Den Steward kannst du gerade nicht dorthin schicken.');
  const ci = prev.purse![side].indexOf(coin);
  if (ci < 0) throw new Error('Diese Münze hast du nicht.');
  const st = clone(prev);
  st.purse![side].splice(ci, 1);
  const p = st.board[from]!;
  st.board[from] = null;
  st.board[to] = { ...p, coins: [...(p.coins ?? []), coin] };
  st.fx.stewardMoved = true;
  st.lastMove = { from, to, path: [to], cap: [], t: 'STW', s: 'M' };
  pushLog(st, `${SIDE_NAME[side]} legen einen ${COINS[coin].n} auf den Steward und schicken ihn ${sqName(from)} → ${sqName(to)}`);
  st.v++;
  return st;
}

/** All coins lying on Stewards (they stay there for good: Stewards cannot be captured). */
export function stewardCoins(board: Square[]): Partial<Record<Coin, number>> {
  const n: Partial<Record<Coin, number>> = {};
  for (const p of board) if (p?.t === 'STW') for (const c of p.coins ?? []) n[c] = (n[c] ?? 0) + 1;
  return n;
}
