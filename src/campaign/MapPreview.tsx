import { useMemo } from 'react';
import { HOUSES, buildMap, hexPoints, hk, type House, type MapDef } from './map.ts';

// Small painted overview of a map for the start dialog: land colours, province borders, cities and both capitals.

const FILL: Record<string, string> = { A: '#B49A55', W: '#3E6236', S: '#56634A', G: '#8D8780', F: '#5E9783', K: '#D3C291', H: '#97834A' };
export const LAND_SWATCH = FILL;

export default function MapPreview({ def, height = 300 }: { def: MapDef; height?: number }) {
  const m = useMemo(() => buildMap(def), [def]);
  const geo = useMemo(() => {
    const at = (c: number, r: number) => (c >= 0 && r >= 0 && c < m.cols && r < m.rows ? m.hexes[r * m.cols + c] : null);
    const hexes: { d: string; fill: string }[] = [];
    let borders = '', coast = '';
    const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    for (const h of m.hexes) {
      if (!h.land) continue;
      const p = hexPoints(h.c, h.r);
      hexes.push({ d: pts(p), fill: FILL[h.land] });
      const odd = h.r % 2 === 1;
      const nb: [number, number][] = [
        [h.c + 1, h.r], odd ? [h.c + 1, h.r + 1] : [h.c, h.r + 1], odd ? [h.c, h.r + 1] : [h.c - 1, h.r + 1],
        [h.c - 1, h.r], odd ? [h.c, h.r - 1] : [h.c - 1, h.r - 1], odd ? [h.c + 1, h.r - 1] : [h.c, h.r - 1],
      ];
      nb.forEach(([c, r], i) => {
        const n = at(c, r), a = p[i], b = p[(i + 1) % 6];
        const seg = `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
        if (!n?.land) coast += seg;
        else if (n.prov !== h.prov && (h.r * m.cols + h.c) < (r * m.cols + c)) borders += seg;
      });
    }
    // crop to the land with a little sea around it
    const land = m.hexes.filter((h) => h.land).flatMap((h) => hexPoints(h.c, h.r));
    const xs = land.map((q) => q[0]), ys = land.map((q) => q[1]), pad = 30;
    const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad];
    return { hexes, borders, coast, box };
  }, [m]);
  const u = Math.max(1, geo.box[2] / 700); // markers grow with the map so they stay readable
  const second = new Set(Object.values(def.second));
  return (
    <svg viewBox={geo.box.map((v) => v.toFixed(0)).join(' ')} role="img" aria-label={`Vorschau der Karte ${def.name}`} style={{ width: '100%', height, display: 'block', background: '#16384A', borderRadius: 8 }}>
      {geo.hexes.map((h, i) => <polygon key={i} points={h.d} fill={h.fill} stroke="#241B10" strokeOpacity={0.18} strokeWidth={1} />)}
      <path d={geo.borders} stroke="#1E1A15" strokeOpacity={0.55} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <path d={geo.coast} stroke="#EAD9A8" strokeOpacity={0.55} strokeWidth={2.2} fill="none" strokeLinecap="round" />
      {m.provinces.map((p) => {
        const [x, y] = hexPoints(...p.seed).reduce(([a, b], [c, d]) => [a + c / 6, b + d / 6], [0, 0]);
        const owner = (p.start ?? null) as House | null;
        if (p.capital) {
          const col = HOUSES[p.capital].color;
          return (
            <g key={p.id} transform={`translate(${x},${y}) scale(${u})`}>
              <circle r={20} fill={col} stroke="#F4ECD8" strokeWidth={3} />
              <path d="M-10,6 l3,-12 l7,7 l7,-7 l3,12 z" fill="#F4E3A8" stroke="#3B2F22" strokeWidth={1.2} />
              <title>{`Hauptstadt ${p.n} (${HOUSES[p.capital].n})`}</title>
            </g>
          );
        }
        if (!p.city) return owner ? <circle key={p.id} cx={x} cy={y} r={6 * u} fill={HOUSES[owner].color} opacity={0.8}><title>{`${p.n} (${HOUSES[owner].n})`}</title></circle> : null;
        return (
          <g key={p.id} transform={`translate(${x},${y}) scale(${u})`}>
            <rect x={-11} y={-11} width={22} height={22} rx={4} fill={owner ? HOUSES[owner].color : '#E9DCC0'} stroke="#2A2015" strokeWidth={2.2} transform="rotate(45)" />
            {second.has(p.id) && <circle r={4} fill="#F4ECD8" />}
            <title>{`Stadt ${p.n}${owner ? ` (${HOUSES[owner].n})` : ' (neutral)'}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export const provinceCount = (def: MapDef) => def.provinces.length;
export const neutralCities = (def: MapDef) => def.provinces.filter((p) => p.city && !p.start).length;
export const landHexes = (def: MapDef) => def.rows.join('').replace(/~/g, '').length;
export const capitalKey = (def: MapDef, h: House) => hk(...def.provinces.find((p) => p.capital === h)!.seed);
