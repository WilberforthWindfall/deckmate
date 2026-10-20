import { HOUSES, LAND, hexLand, hexName, type HexKey, type House } from './map.ts';
import { AUTO_WIN, type Conflict, type ConflictSide } from './engine.ts';

/** Plain-language explanation of one conflict, for the cards after the reveal. */
export interface Explanation {
  /** Field the card points at. */
  hex: HexKey;
  /** Second field for a meeting on the way (both are highlighted). */
  hex2?: HexKey;
  /** Movement step in which it happened (1 = first step). */
  step: number;
  title: string;
  sides: { house: House; label: string; formula: string; total: number }[];
  /** "13 : 6 · 2,2-fach" */
  ratio?: string;
  result: string;
  winner: House | null;
  /** Armies that tried to enter `to` but were stopped; shown marching part of the way and returning. */
  turnedBack: { army: string; from: HexKey; to: HexKey }[];
}

export const num = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
const hn = (h: House) => HOUSES[h].n;

/** "10 Figuren + 3 Unterstützung von Westmark × 1,2 Hügelland × 1,3 Stadtmauer" */
export function formula(s: ConflictSide, hex: HexKey): string {
  const parts = [`${s.size} Figuren`];
  for (const x of s.sup) parts.push(`+ ${num(x.add)} Unterstützung von ${hexName(x.hex)}`);
  if (s.terrain !== 1) parts.push(`× ${num(s.terrain)} ${LAND[hexLand(hex)].n}`);
  if (s.wall !== 1) parts.push(`× ${num(s.wall)} Stadtmauer`);
  if (s.xp && s.xp !== 1) parts.push(`× ${num(s.xp)} Erfahrung`);
  return parts.join(' ');
}

const ratioText = (a: number, b: number) => {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return `${num(a)} : ${num(b)}${lo > 0 ? ` · ${num(hi / lo)}-fach` : ''}`;
};
const need = `mindestens ${num(AUTO_WIN)}-mal so stark`;
const place = (k: HexKey) => `${hexName(k)} (${LAND[hexLand(k)].n})`;

export function explain(k: Conflict): Explanation {
  const step = k.step ?? 1;
  if (k.kind === 'meet') {
    const sides = (['R', 'K'] as House[]).map((h) => ({ house: h, label: `${hn(h)} von ${hexName(k[h].from)}`, formula: formula(k[h], k.hex), total: k[h].total }));
    const W = k.winner;
    const L: House | null = W === 'R' ? 'K' : W === 'K' ? 'R' : null;
    const how = k.swap
      ? `Die Heere wollten aneinander vorbei die Felder tauschen und sind sich unterwegs begegnet (Schritt ${step}).`
      : `Beide Heere betraten im selben Schritt (${step}) das Feld ${place(k.hex)}.`;
    let result: string;
    if (W && L) {
      result = k.swap
        ? `${how} ${hn(W)} ist ${need} und drängt ${hn(L)} ${k.retreat ? `nach ${hexName(k.retreat)} ` : ''}zurück${k.retreat ? '' : ' – ohne Rückzugsweg löst sich das Heer auf'}.`
        : `${how} ${hn(W)} ist ${need} und besetzt es. ${hn(L)} bleibt bei ${hexName(k[L].from)} stehen, ohne Verluste.`;
    } else if (k.battle) {
      result = `${how} Keine Seite ist ${need}: Es kommt zur Feldschlacht. ${hn(k.battle.attacker)} führt die Offiziere${k.battle.coin ? ' (gleich stark, der Würfel hat entschieden)' : ', weil es das stärkere Heer ist'}. Der Sieger behält das Feld, der Verlierer kehrt um. Rechts in der Leiste wählt ihr Brett oder Auswürfeln.`;
    } else result = how;
    return {
      hex: k.hex, hex2: k.swap ? (k.hex === k.R.from ? k.K.from : k.R.from) : undefined, step,
      title: k.battle ? `Feldschlacht bei ${hexName(k.hex)}` : k.swap ? `Begegnung bei ${hexName(k.hex)}` : `Wettlauf um ${hexName(k.hex)}`,
      sides, ratio: ratioText(k.R.total, k.K.total), result, winner: W,
      turnedBack: W && L && !k.swap ? [{ army: k[L].army, from: k[L].from, to: k.hex }] : k.battle
        ? (['R', 'K'] as House[]).filter((h) => k[h].from !== k.hex).map((h) => ({ army: k[h].army, from: k[h].from, to: k.hex }))
        : [],
    };
  }
  const A = k.att.house, D = k.def.house;
  const sides = [
    { house: A, label: `${hn(A)} greift an von ${hexName(k.att.from)}`, formula: formula(k.att, k.hex), total: k.att.total },
    { house: D, label: `${hn(D)} verteidigt ${hexName(k.hex)}`, formula: formula(k.def, k.hex), total: k.def.total },
  ];
  const lost = (n?: number) => (n ? `${n} Figur${n === 1 ? '' : 'en'}` : 'keine Figuren');
  let result: string;
  if (k.outcome === 'overrun') {
    const where = k.retreat ? `zieht sich nach ${hexName(k.retreat)} zurück` : 'findet keinen Rückzugsweg, das Heer löst sich auf';
    result = `${hn(A)} ist ${need} und überrennt ${place(k.hex)}. ${hn(D)} verliert ${lost(k.defLost)} und ${where}. ${hn(A)} verliert ${lost(k.attLost)}.`;
  } else if (k.outcome === 'repelled') {
    result = `${hn(D)} ist in der Verteidigung ${need} und hält ${place(k.hex)}. ${hn(A)} verliert ${lost(k.attLost)} und bleibt bei ${hexName(k.att.from)} stehen.`;
  } else {
    result = `Keine Seite ist ${need}. Es kommt zur Schlacht um ${place(k.hex)}: Rechts in der Leiste wählt ihr, ob auf dem Brett gespielt oder ausgewürfelt wird.`;
  }
  return {
    hex: k.hex, step,
    title: `Angriff auf ${hexName(k.hex)}`,
    sides, ratio: ratioText(k.att.total, k.def.total), result,
    winner: k.outcome === 'overrun' ? A : k.outcome === 'repelled' ? D : null,
    turnedBack: k.outcome === 'overrun' ? [] : [{ army: k.att.army, from: k.att.from, to: k.hex }],
  };
}
