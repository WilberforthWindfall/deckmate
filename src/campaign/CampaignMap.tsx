import { useMemo, type MouseEvent as RMouseEvent, type RefObject } from 'react';
import {
  HEXES, HEX_R, HOUSES, LAND, MAP_H, MAP_W, PROV, PROVINCES, center, hexAt, hexPoints, hexSides, inGrid, provCenter, type House,
} from './map.ts';
import type { Campaign, Order, Tone } from './engine.ts';

interface Props {
  c: Campaign;
  /** Province the player has selected. */
  selected: string | null;
  /** Provinces that can be clicked as a target right now. */
  targets: string[];
  /** Orders to draw as arrows (only the active house's own, never the opponent's). */
  orders: Order[];
  onProvince: (id: string, at: { x: number; y: number }) => void;
  /** Click on an army's flag. */
  onArmy?: (id: string) => void;
  /** Army shown as selected (golden frame). */
  selectedArmy?: string | null;
  /** Small signs on target provinces, e.g. the expected outcome of a move. */
  labels?: Record<string, { text: string; tone: Tone }>;
  /** Provinces outlined in gold, e.g. the conflict being explained. */
  focus?: string[];
  /** Armies drawn at another spot (map coordinates), e.g. halfway on a march that turns back. */
  posOverride?: Record<string, [number, number]>;
  svgRef?: RefObject<SVGSVGElement>;
}

const TONE: Record<Tone, string> = { ok: '#2F6E40', risk: '#8C5A12', bad: '#7E2621', plain: '#2A3F55' };
type Mark = 'move' | 'support' | 'forage';

const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const TILE: Record<string, string> = { A: 'acker', W: 'wald', S: 'sumpf', G: 'gebirge', F: 'fluss', K: 'kueste', H: 'huegel' };

export default function CampaignMap({ c, selected, targets, orders, onProvince, onArmy, selectedArmy, labels, focus, posOverride, svgRef }: Props) {
  const marks: Record<string, Mark> = {};
  for (const o of orders) if (o.kind === 'move' || o.kind === 'support' || o.kind === 'forage') marks[o.army] = o.kind;
  const geo = useMemo(() => {
    const coast: string[] = [], prov: string[] = [];
    const house: { prov: string; other: string | null; d: string }[] = [];
    for (const h of HEXES) {
      if (!h.prov) continue;
      for (const s of hexSides(h.c, h.r)) {
        const n = inGrid(...s.n) ? hexAt(...s.n) : null;
        const seg = `M${s.a[0].toFixed(1)} ${s.a[1].toFixed(1)}L${s.b[0].toFixed(1)} ${s.b[1].toFixed(1)}`;
        if (!n || !n.prov) coast.push(seg);
        else if (n.prov !== h.prov && (h.c < n.c || (h.c === n.c && h.r < n.r))) prov.push(seg);
        if (n?.prov !== h.prov) {
          const [x, y] = center(h.c, h.r), k = (HEX_R - 5) / HEX_R;
          const a = [x + (s.a[0] - x) * k, y + (s.a[1] - y) * k], b = [x + (s.b[0] - x) * k, y + (s.b[1] - y) * k];
          house.push({ prov: h.prov, other: n?.prov ?? null, d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}` });
        }
      }
    }
    return { coast: coast.join(''), prov: prov.join(''), house };
  }, []);


  return (
    <svg ref={svgRef} viewBox={`0 0 ${MAP_W.toFixed(0)} ${MAP_H.toFixed(0)}`} role="img" aria-label="Kampagnenkarte von Eridanos" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        {Object.values(TILE).concat(['stadt']).map((t) => (
          <pattern key={t} id={`t-${t}`} patternContentUnits="objectBoundingBox" width="1" height="1">
            <image href={`/tiles/${t}.jpg`} x="-0.08" y="-0.02" width="1.16" height="1.04" preserveAspectRatio="xMidYMid slice" />
          </pattern>
        ))}
        <pattern id="t-meer" patternUnits="userSpaceOnUse" width="240" height="240"><image href="/tiles/meer.jpg" width="240" height="240" /></pattern>
        <marker id="arrow-R" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill={HOUSES.R.color} /></marker>
        <marker id="arrow-K" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill={HOUSES.K.color} /></marker>
      </defs>
      <rect width={MAP_W} height={MAP_H} fill="url(#t-meer)" />
      <rect width={MAP_W} height={MAP_H} fill="#0E3A44" opacity={0.15} />

      {HEXES.filter((h) => h.prov).map((h) => {
        const p = PROV[h.prov!];
        const isSeedCity = p.city && p.seed[0] === h.c && p.seed[1] === h.r;
        return (
          <polygon key={`${h.c},${h.r}`} data-prov={h.prov!} points={pts(hexPoints(h.c, h.r))} fill={`url(#t-${isSeedCity ? 'stadt' : TILE[h.land!]})`}
            stroke="#241B10" strokeOpacity={0.45} strokeWidth={1}
            style={{ cursor: 'pointer' }} onClick={(e) => onProvince(h.prov!, { x: e.clientX, y: e.clientY })} />
        );
      })}

      {HEXES.filter((h) => h.prov && c.owner[h.prov]).map((h) => (
        <polygon key={`o${h.c},${h.r}`} points={pts(hexPoints(h.c, h.r))} fill={HOUSES[c.owner[h.prov!]!].color} fillOpacity={0.2} stroke="none" pointerEvents="none" />
      ))}
      {targets.length > 0 && HEXES.filter((h) => h.prov && targets.includes(h.prov)).map((h) => (
        <polygon key={`t${h.c},${h.r}`} points={pts(hexPoints(h.c, h.r))} fill="#7FE3FF" fillOpacity={0.22} stroke="none" pointerEvents="none" />
      ))}
      {selected && HEXES.filter((h) => h.prov === selected).map((h) => (
        <polygon key={`s${h.c},${h.r}`} points={pts(hexPoints(h.c, h.r))} fill="#E2C27F" fillOpacity={0.22} stroke="none" pointerEvents="none" />
      ))}

      <path d={geo.prov} fill="none" stroke="#3B2F22" strokeWidth={1.6} strokeDasharray="4 3" strokeOpacity={0.8} pointerEvents="none" />
      {(['R', 'K'] as House[]).map((hs) => {
        const d = geo.house.filter((e) => c.owner[e.prov] === hs && (!e.other || c.owner[e.other] !== hs)).map((e) => e.d).join('');
        if (!d) return null;
        return (
          <g key={hs} pointerEvents="none">
            <path d={d} fill="none" stroke="#120E0A" strokeOpacity={0.7} strokeWidth={8} strokeLinecap="round" />
            <path d={d} fill="none" stroke={HOUSES[hs].color} strokeWidth={5} strokeLinecap="round" />
            <path d={d} fill="none" stroke="#FFF6E8" strokeOpacity={0.55} strokeWidth={1.2} strokeLinecap="round" />
          </g>
        );
      })}
      <path d={geo.coast} fill="none" stroke="#3B2F22" strokeWidth={2.8} strokeLinecap="round" pointerEvents="none" />
      {focus && focus.length > 0 && (() => {
        const d = geo.house.filter((e) => focus.includes(e.prov)).map((e) => e.d).join('');
        return (
          <g pointerEvents="none" className="focus-ring">
            <path d={d} fill="none" stroke="#120E0A" strokeOpacity={0.8} strokeWidth={10} strokeLinecap="round" />
            <path d={d} fill="none" stroke="#F3D27A" strokeWidth={5} strokeLinecap="round" />
          </g>
        );
      })()}

      {orders.map((o, i) => {
        if (o.kind !== 'move' && o.kind !== 'support') return null;
        const a = c.armies.find((x) => x.id === o.army);
        if (!a || a.prov.startsWith('@')) return null;
        const [x1, y1] = provCenter(a.prov), [x2, y2] = provCenter(o.kind === 'move' ? o.to : o.target);
        const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12;
        const t = 0.82, ex = x1 + (x2 - x1) * t, ey = y1 + (y2 - y1) * t;
        return (
          <path key={i} d={`M${x1} ${y1} Q${mx} ${my} ${ex} ${ey}`} fill="none" stroke={HOUSES[a.house].color}
            strokeWidth={o.kind === 'move' ? 7 : 3} strokeDasharray={o.kind === 'support' ? '2 6' : undefined}
            strokeLinecap="round" markerEnd={`url(#arrow-${a.house})`} opacity={0.92} pointerEvents="none" />
        );
      })}

      {PROVINCES.map((p) => {
        const [x, y] = provCenter(p.id);
        const o = c.owner[p.id];
        return (
          <g key={p.id} pointerEvents="none">
            {p.city && (
              <path transform={`translate(${x},${y - 30})`} d="M-7,-6 h14 v7 q0,7 -7,9 q-7,-2 -7,-9 z"
                fill={o ? HOUSES[o].color : '#6E6A60'} stroke="#F1E8D2" strokeWidth={1.6} />
            )}
            {p.capital && <path transform={`translate(${x},${y - 41})`} d="M-5,2 l2,-6 l3,4 l3,-4 l2,6 z" fill="#E2C27F" stroke="#3B2F22" strokeWidth={0.8} />}
            <text x={x} y={y + 30} textAnchor="middle" fontFamily="Spectral SC, Georgia, serif" fontWeight={700} fontSize={14}
              fill="#2A2118" stroke="#F3EAD4" strokeWidth={4.5} strokeLinejoin="round" paintOrder="stroke" letterSpacing={0.5}>{p.n.toUpperCase()}</text>
          </g>
        );
      })}

      {c.armies.filter((a) => !a.prov.startsWith('@')).map((a) => {
        const [x, y] = posOverride?.[a.id] ?? provCenter(a.prov);
        return <Token key={a.id} x={x} y={y} house={a.house} size={a.size} spec={a.spec.CAP + a.spec.KAP + a.spec.KAN + a.spec.MAR}
          selected={selectedArmy === a.id} mark={marks[a.id]} id={a.id}
          onClick={(e) => { e.stopPropagation(); if (onArmy) onArmy(a.id); else onProvince(a.prov, { x: e.clientX, y: e.clientY }); }} />;
      })}
      {c.battles.map((b) => {
        const att = c.armies.find((x) => x.id === b.attacker)!;
        const [x, y] = provCenter(b.prov);
        return (
          <g key={b.id} pointerEvents="none">
            <Token x={x - 56} y={y} house={att.house} size={att.size} spec={att.spec.CAP + att.spec.KAP + att.spec.KAN + att.spec.MAR} />
            {b.field && (() => { const def = c.armies.find((x) => x.id === b.defender)!; return <Token x={x} y={y} house={def.house} size={def.size} spec={def.spec.CAP + def.spec.KAP + def.spec.KAN + def.spec.MAR} />; })()}
            <circle cx={x - 28} cy={y - 24} r={13} fill="#1E1A15" stroke="#E2C27F" strokeWidth={2} />
            <path transform={`translate(${x - 28},${y - 24})`} d="M-6,-6 L6,6 M6,-6 L-6,6" stroke="#F1E3BE" strokeWidth={2} strokeLinecap="round" />
          </g>
        );
      })}
      {labels && Object.entries(labels).map(([id, l]) => {
        if (!l.text) return null;
        const [x, y] = provCenter(id);
        const w = l.text.length * 6.4 + 16;
        return (
          <g key={`l${id}`} transform={`translate(${x},${y + 50})`} pointerEvents="none">
            <rect x={-w / 2} y={-10} width={w} height={20} rx={10} fill={TONE[l.tone]} stroke="#F1E8D2" strokeWidth={1.2} />
            <text y={4} textAnchor="middle" fontFamily="Figtree, sans-serif" fontWeight={700} fontSize={11} fill="#FFF8EC">{l.text}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Token({ x, y, house, size, spec, selected, mark, id, onClick }: {
  x: number; y: number; house: House; size: number; spec: number; selected?: boolean; mark?: Mark; id?: string; onClick?: (e: RMouseEvent) => void;
}) {
  return (
    <g data-army={house} data-army-id={id} onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined, transform: `translate(${x}px, ${y}px)`, transition: 'transform .9s ease-in-out' }}>
      {selected && <rect x={-29} y={-20} width={58} height={40} rx={10} fill="none" stroke="#E2C27F" strokeWidth={3} />}
      <rect x={-24} y={-15} width={48} height={30} rx={7} fill={HOUSES[house].color} stroke="#F1E8D2" strokeWidth={2} />
      <path d="M-15,-8 v16 M-15,-8 l9,4 l-9,4" fill="none" stroke="#FFF6F2" strokeWidth={1.5} strokeLinejoin="round" />
      <text x={6} y={5} textAnchor="middle" fontFamily="Figtree, sans-serif" fontWeight={700} fontSize={15} fill="#FFF8F2">{size}</text>
      {mark && (
        <g transform="translate(-22,13)" aria-label={mark === 'move' ? 'zieht' : mark === 'support' ? 'unterstützt' : 'fouragiert'}>
          <circle r={8.5} fill="#F1E8D2" stroke="#1E1A15" strokeWidth={1} />
          {mark === 'move' && <path d="M-4.5,0 H3 M0,-3.5 L4,0 L0,3.5" fill="none" stroke="#1E1A15" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
          {mark === 'support' && <path d="M-4,-4.5 H4 V0 Q4,3.5 0,5 Q-4,3.5 -4,0 Z" fill="#1E1A15" />}
          {mark === 'forage' && <path d="M0,5 V-4.5 M0,-1.5 L-3.5,-4.5 M0,-1.5 L3.5,-4.5 M0,1.5 L-3.5,-1.5 M0,1.5 L3.5,-1.5" fill="none" stroke="#1E1A15" strokeWidth={1.5} strokeLinecap="round" />}
        </g>
      )}
      {spec > 0 && <g transform="translate(20,-14)"><circle r={8} fill="#E2C27F" stroke="#1E1A15" strokeWidth={1} /><text y={4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#1E1A15">{spec}</text></g>}
    </g>
  );
}

export const landInfo = (id: string) => LAND[PROV[id].land];
