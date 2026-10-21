// Campaign bridge: turns two armies into a Deckmate starting position and reads the result back.
// Pure and serializable like rules.ts. The attacker always leads the officers, the defender the crew.
import {
  CARDS, newGame, type Army, type BattleInfo, type CardKey, type GameState, type PieceType, type Rng, type Side, type Terrain,
} from './rules.ts';

export const MAX_OFFICERS = { CAP: 1, KAP: 2, KAN: 2, MAR: 2, INF: 8 } as const;
export const MAX_STONES = 16;

export const TERRAIN: Record<Terrain, { n: string; rule: string }> = {
  ebene: { n: 'Ebene', rule: 'Keine Besonderheit.' },
  fluss: { n: 'Flussland', rule: 'Furt: Infanteristen haben keinen Doppelschritt.' },
  gebirge: { n: 'Gebirge', rule: 'Der Verteidiger erhält eine zusätzliche Karte.' },
  huegel: { n: 'Hügelland', rule: 'Wer den Hügel hält, beginnt: Die Mannschaft (Verteidiger) zieht zuerst.' },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(v)));

/** Which officer pieces an attacking army brings: the First Leutnant always leads, specialists up to their maximum, the rest infantry. */
export function officerLineup(a: Army): Record<'FL' | keyof typeof MAX_OFFICERS, number> {
  const CAP = clamp(a.spec.CAP, 0, MAX_OFFICERS.CAP), KAP = clamp(a.spec.KAP, 0, MAX_OFFICERS.KAP);
  const KAN = clamp(a.spec.KAN, 0, MAX_OFFICERS.KAN), MAR = clamp(a.spec.MAR, 0, MAX_OFFICERS.MAR);
  const INF = clamp(a.size - 1 - CAP - KAP - KAN - MAR, 0, MAX_OFFICERS.INF);
  return { FL: 1, CAP, KAP, KAN, MAR, INF };
}

/** How many crew stones a defending army brings (at least one). */
export const crewLineup = (a: Army) => clamp(a.size, 1, MAX_STONES);

export function newBattle(info: BattleInfo, rng: Rng): GameState {
  const st = newGame(rng, { mPflicht: false, sideFirst: true, furt: info.terrain === 'fluss' });
  const off = officerLineup(info.attacker);
  const removeO: Partial<Record<PieceType, number>> = {};
  for (const t of ['CAP', 'KAP', 'KAN', 'MAR', 'INF'] as const) { const n = MAX_OFFICERS[t] - off[t]; if (n > 0) removeO[t] = n; }
  const removeM: Partial<Record<PieceType, number>> = {};
  const stones = MAX_STONES - crewLineup(info.defender);
  if (stones > 0) removeM.stone = stones;
  st.battle = { ...info, first: info.terrain === 'huegel' ? 'M' : undefined };
  const deploy: GameState['deploy'] = {};
  if (Object.keys(removeO).length) deploy.O = removeO;
  if (Object.keys(removeM).length) deploy.M = removeM;
  if (deploy.O || deploy.M) st.deploy = deploy;
  if (info.terrain === 'gebirge') {
    const extra = (Object.keys(CARDS) as CardKey[])[Math.floor(rng() * Object.keys(CARDS).length)];
    st.hands.M.push(extra);
  }
  st.log = [
    `Schlacht um ${info.province} (${TERRAIN[info.terrain].n}): ${info.attacker.house} greift als Offiziere an, ${info.defender.house} verteidigt als Mannschaft.`,
    ...(st.deploy ? ['Aufstellung: Beide Seiten nehmen die Figuren vom Brett, die ihrem Heer fehlen.'] : []),
  ];
  return st;
}

/** Take one own piece off the board during deployment (the side chooses which squares stay empty). */
export function removePiece(prev: GameState, at: number): GameState {
  if (prev.phase !== 'setup' || !prev.deploy) throw new Error('Gerade wird nicht aufgestellt.');
  const p = prev.board[at];
  if (!p) throw new Error('Auf diesem Feld steht keine Figur.');
  const need = prev.deploy[p.s]?.[p.t] ?? 0;
  if (need <= 0) throw new Error(p.t === 'FL' ? 'Der First Leutnant führt das Heer und bleibt immer auf dem Brett.' : 'Von dieser Figur fehlt deinem Heer keine.');
  const st: GameState = JSON.parse(JSON.stringify(prev));
  st.board[at] = null;
  const left = need - 1;
  if (left > 0) st.deploy![p.s]![p.t] = left; else delete st.deploy![p.s]![p.t];
  if (!Object.keys(st.deploy![p.s]!).length) delete st.deploy![p.s];
  if (!st.deploy!.M && !st.deploy!.O) {
    delete st.deploy;
    st.log = ['Aufstellung abgeschlossen.', ...st.log].slice(0, 30);
  }
  st.v++;
  return st;
}

/** Remaining removals per side as readable text, e.g. "1 Kanonade, 2 Infanteristen". */
export function deployText(st: GameState, side: Side): string {
  const need = st.deploy?.[side];
  if (!need) return '';
  const NAMES: Partial<Record<PieceType, [string, string]>> = {
    CAP: ['Captain', 'Captains'], KAP: ['Kaplan', 'Kapläne'], KAN: ['Kanonade', 'Kanonaden'], MAR: ['Marine', 'Marines'],
    INF: ['Infanterist', 'Infanteristen'], stone: ['Stein', 'Steine'],
  };
  return Object.entries(need).map(([t, n]) => `${n} ${NAMES[t as PieceType]![n === 1 ? 0 : 1]}`).join(', ');
}

export interface BattleResult {
  winner: Side;
  headline: string;
  detail: string;
  attacker: Army & { lost: number };
  defender: Army & { lost: number };
}

/** Survivors go back into the armies on the campaign map. */
export function battleResult(st: GameState): BattleResult | null {
  if (!st.battle || st.phase !== 'over' || !st.winner) return null;
  const b = st.battle;
  const count = (s: Side, t?: PieceType) => st.board.filter((p) => p && p.s === s && (!t || p.t === t)).length;
  const offBefore = Object.values(officerLineup(b.attacker)).reduce((x, y) => x + y, 0);
  const offAfter = count('O');
  const crewBefore = crewLineup(b.defender);
  const crewAfter = count('M');
  const attacker = {
    house: b.attacker.house, size: offAfter, lost: Math.max(0, offBefore - offAfter),
    spec: { CAP: count('O', 'CAP'), KAP: count('O', 'KAP'), KAN: count('O', 'KAN'), MAR: count('O', 'MAR') },
  };
  const defender = { house: b.defender.house, size: crewAfter, lost: Math.max(0, crewBefore - crewAfter), spec: b.defender.spec };
  const resigned = st.winReason?.includes('ergeben') || st.winReason?.includes('Flagge');
  let headline: string, detail: string;
  if (st.winner === 'O') {
    headline = `${b.attacker.house} erobert ${b.province}`;
    detail = resigned
      ? `${b.defender.house} zieht sich zurück und rettet ${crewAfter} Steine in eine Nachbarprovinz.`
      : `Das Heer von ${b.defender.house} ist zerschlagen.`;
  } else {
    headline = `${b.defender.house} hält ${b.province}`;
    detail = resigned
      ? `${b.attacker.house} bricht den Angriff ab, ${offAfter} Figuren kehren zurück.`
      : `Der First Leutnant von ${b.attacker.house} ist gefallen, ${Math.max(0, offAfter)} Figuren fliehen in eine Nachbarprovinz.`;
  }
  return { winner: st.winner, headline, detail, attacker, defender };
}

export const sideOfHouse = (st: GameState, house: string): Side | null =>
  st.battle?.attacker.house === house ? 'O' : st.battle?.defender.house === house ? 'M' : null;
