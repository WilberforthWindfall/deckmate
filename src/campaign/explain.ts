import { HOUSES, LAND, PROV, type House } from './map.ts';
import { AUTO_WIN, type Conflict, type ConflictSide } from './engine.ts';

/** Plain-language explanation of one conflict, for the cards after the reveal. */
export interface Explanation {
  prov: string;
  /** Second province for a swap (both are highlighted). */
  prov2?: string;
  title: string;
  sides: { house: House; label: string; formula: string; total: number }[];
  /** "13 : 6 · 2,2-fach" */
  ratio?: string;
  result: string;
  winner: House | null;
  /** Armies that set out but turned back; shown marching part of the way and returning. */
  turnedBack: { army: string; from: string; to: string }[];
}

export const num = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
const hn = (h: House) => HOUSES[h].n;
const pn = (id: string) => PROV[id].n;

/** "10 Figuren + 3 Unterstützung aus Westmark × 1,2 Hügelland × 1,3 Mauer" */
export function formula(s: ConflictSide, prov: string): string {
  const parts = [`${s.size} Figuren`];
  for (const x of s.sup) parts.push(`+ ${num(x.add)} Unterstützung aus ${pn(x.prov)}`);
  if (s.terrain !== 1) parts.push(`× ${num(s.terrain)} ${LAND[PROV[prov].land].n}`);
  if (s.wall !== 1) parts.push(`× ${num(s.wall)} Stadtmauer`);
  return parts.join(' ');
}

const ratioText = (a: number, b: number) => {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return `${num(a)} : ${num(b)}${lo > 0 ? ` · ${num(hi / lo)}-fach` : ''}`;
};
const need = `mindestens ${num(AUTO_WIN)}-mal so stark`;

export function explain(k: Conflict): Explanation {
  if (k.kind === 'swap') {
    return {
      prov: k.a.from, prov2: k.b.from,
      title: `Zusammenstoß zwischen ${pn(k.a.from)} und ${pn(k.b.from)}`,
      sides: [k.a, k.b].map((x) => ({ house: x.house, label: `${hn(x.house)} aus ${pn(x.from)}`, formula: `${x.size} Figuren, Ziel ${pn(x.to)}`, total: x.size })),
      result: 'Beide Heere wollten die Plätze tauschen und sind sich unterwegs begegnet. Keines kommt an, beide stehen wieder an ihrem Ausgangsort.',
      winner: null,
      turnedBack: [k.a, k.b].map((x) => ({ army: x.army, from: x.from, to: x.to })),
    };
  }
  if (k.kind === 'race') {
    const sides = (['R', 'K'] as House[]).map((h) => ({ house: h, label: `${hn(h)} aus ${pn(k[h].from)}`, formula: formula(k[h], k.prov), total: k[h].total }));
    const W = k.winner;
    const L: House | null = W === 'R' ? 'K' : W === 'K' ? 'R' : null;
    return {
      prov: k.prov,
      title: k.battle ? `Feldschlacht um ${pn(k.prov)}` : `Wettlauf um ${pn(k.prov)}`,
      sides, ratio: ratioText(k.R.total, k.K.total),
      result: W && L
        ? `Beide Häuser marschierten gleichzeitig nach ${pn(k.prov)}. ${hn(W)} ist ${need} und besetzt die Provinz. ${hn(L)} kehrt nach ${pn(k[L].from)} um, ohne Verluste.`
        : k.battle
          ? `Beide Häuser marschierten gleichzeitig nach ${pn(k.prov)}, keine Seite ist ${need}. Die Heere treffen im Feld aufeinander: Es kommt zur Feldschlacht. ${hn(k.battle.attacker)} führt die Offiziere${k.battle.coin ? ' (gleich stark, der Würfel hat entschieden)' : ', weil es das stärkere Heer ist'}. Der Sieger besetzt ${pn(k.prov)}, der Verlierer kehrt um. Rechts in der Leiste wählt ihr Brett oder Auswürfeln.`
          : `Beide Häuser marschierten gleichzeitig nach ${pn(k.prov)}. Keine Seite ist ${need}, darum kehren beide um. ${pn(k.prov)} bleibt, wie es war.`,
      winner: W,
      turnedBack: W ? [{ army: k[L!].army, from: k[L!].from, to: k.prov }] : k.battle ? [] : (['R', 'K'] as House[]).map((h) => ({ army: k[h].army, from: k[h].from, to: k.prov })),
    };
  }
  const A = k.att.house, D = k.def.house;
  const sides = [
    { house: A, label: `${hn(A)} greift an aus ${pn(k.att.from)}`, formula: formula(k.att, k.prov), total: k.att.total },
    { house: D, label: `${hn(D)} verteidigt ${pn(k.prov)}`, formula: formula(k.def, k.prov), total: k.def.total },
  ];
  const lost = (n?: number) => (n ? `${n} Figur${n === 1 ? '' : 'en'}` : 'keine Figuren');
  let result: string;
  if (k.outcome === 'overrun') {
    const where = k.retreat ? `zieht sich nach ${pn(k.retreat)} zurück` : 'findet keinen Rückzugsweg, das Heer löst sich auf';
    result = `${hn(A)} ist ${need} und überrennt ${pn(k.prov)}. ${hn(D)} verliert ${lost(k.defLost)} und ${where}. ${hn(A)} verliert ${lost(k.attLost)}.`;
  } else if (k.outcome === 'repelled') {
    result = `${hn(D)} ist in der Verteidigung ${need} und hält ${pn(k.prov)}. ${hn(A)} verliert ${lost(k.attLost)} und kehrt nach ${pn(k.att.from)} zurück.`;
  } else {
    result = `Keine Seite ist ${need}. Es kommt zur Schlacht um ${pn(k.prov)}: Rechts in der Leiste wählt ihr, ob auf dem Brett gespielt oder ausgewürfelt wird.`;
  }
  return {
    prov: k.prov,
    title: `Angriff auf ${pn(k.prov)}`,
    sides, ratio: ratioText(k.att.total, k.def.total),
    result,
    winner: k.outcome === 'overrun' ? A : k.outcome === 'repelled' ? D : null,
    turnedBack: k.outcome === 'repelled' ? [{ army: k.att.army, from: k.att.from, to: k.prov }] : [],
  };
}
