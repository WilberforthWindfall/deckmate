import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import {
  CITY_HEX, HEX, HEXES, HEX_R, HOUSES, MAP_H, MAP_W, PROV, PROVINCES, center, hexAt, hexCenter, hexPoints, hexSides, hk, inGrid, provCenter,
  type HexKey, type House,
} from './map.ts';
import { BUILDINGS, ROMAN, buildingActive, buildingOwnerOf, levelOf, rankOf, xpOn, type BuildingKey, type Campaign, type Order, type SpecKey, type Tone } from './engine.ts';
import { hasSprite, spriteBox, spriteName, spriteUrl } from './sprites.ts';

export interface MapProps {
  c: Campaign;
  /** Field the player has selected. */
  selectedHex: HexKey | null;
  /** Army or agent shown as selected. */
  selectedUnit?: string | null;
  /** Fields the selected unit can still reach, with their cost. */
  reach?: Record<HexKey, number>;
  /** Way being planned for the selected unit (without its start field). */
  plan?: { from: HexKey; path: HexKey[]; house: House } | null;
  /** Orders to draw (only the active house's own, or both after the reveal). */
  orders: Order[];
  onHex: (k: HexKey) => void;
  onArmy?: (id: string) => void;
  onAgent?: (id: string) => void;
  /** Signs on fields, e.g. the expected outcome of a move. */
  labels?: Record<HexKey, { text: string; tone: Tone }>;
  /** Fields outlined in gold, e.g. the conflict being explained. */
  focus?: HexKey[];
  /** Units drawn at another spot (map coordinates), e.g. during the reveal. */
  posOverride?: Record<string, [number, number]>;
  /** Faster token movement during the step-by-step reveal. */
  stepMs?: number;
  /** Units walking right now (they march and raise dust). */
  moving?: Set<string>;
  /** Buildings being built this round (shown as construction sites). */
  construction?: { hex: HexKey; b: BuildingKey; house: House; up?: number }[];
  svgRef?: RefObject<SVGSVGElement>;
  /** Called after zooming or panning, so overlays anchored to fields can follow. */
  onCamera?: () => void;
}

const TONE: Record<Tone, string> = { ok: '#2F6E40', risk: '#8C5A12', bad: '#7E2621', plain: '#2A3F55' };
type Mark = 'move' | 'support' | 'forage';
export const BUILDING_ICON: Record<BuildingKey, string> = { kapelle: '✝', giesserei: '⚒', kaserne: '⚔', messe: '★', markt: '⚖', mauer: '▥' };
export const AGENT_ABBR: Record<SpecKey, string> = { CAP: 'Cp', KAP: 'Kp', KAN: 'Kn', MAR: 'Ma' };

const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const TILE: Record<string, string> = { A: 'acker', W: 'wald', S: 'sumpf', G: 'gebirge', F: 'fluss', K: 'kueste', H: 'huegel' };
const seg = (a: [number, number], b: [number, number], x: number, y: number, k: number) => {
  const p = [x + (a[0] - x) * k, y + (a[1] - y) * k], q = [x + (b[0] - x) * k, y + (b[1] - y) * k];
  return `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
};
const line = (from: HexKey, path: HexKey[]) => [from, ...path].map((k, i) => { const [x, y] = hexCenter(k); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('');

export default function CampaignMap(p: MapProps) {
  const { c, selectedHex, selectedUnit, reach, plan, orders, onHex, onArmy, onAgent, labels, focus, posOverride, stepMs = 900, svgRef, moving, construction, onCamera } = p;
  const view = useZoom(svgRef, onCamera);
  const marks: Record<string, Mark> = {};
  for (const o of orders) if (o.kind === 'move' || o.kind === 'support' || o.kind === 'forage') marks[o.army] = o.kind;
  const geo = useMemo(() => {
    const coast: string[] = [], prov: string[] = [];
    for (const h of HEXES) {
      if (!h.prov) continue;
      for (const s of hexSides(h.c, h.r)) {
        const n = inGrid(...s.n) ? hexAt(...s.n) : null;
        const d = `M${s.a[0].toFixed(1)} ${s.a[1].toFixed(1)}L${s.b[0].toFixed(1)} ${s.b[1].toFixed(1)}`;
        if (!n || !n.prov) coast.push(d);
        else if (n.prov !== h.prov && (h.c < n.c || (h.c === n.c && h.r < n.r))) prov.push(d);
      }
    }
    return { coast: coast.join(''), prov: prov.join('') };
  }, []);
  // realm borders follow the owned fields
  const borders = useMemo(() => {
    const out: Record<House, string[]> = { R: [], K: [] };
    for (const k of Object.keys(HEX)) {
      const o = c.hexOwner[k];
      if (!o) continue;
      const h = HEX[k];
      const [x, y] = center(h.c, h.r);
      for (const s of hexSides(h.c, h.r)) {
        const n = inGrid(...s.n) ? hk(...s.n) : null;
        if (n && HEX[n] && c.hexOwner[n] === o) continue;
        out[o].push(seg(s.a, s.b, x, y, (HEX_R - 4) / HEX_R));
      }
    }
    return { R: out.R.join(''), K: out.K.join('') };
  }, [c.hexOwner]);
  const focusPath = useMemo(() => (focus ?? []).flatMap((k) => {
    const h = HEX[k]; if (!h) return [];
    const [x, y] = center(h.c, h.r);
    return hexSides(h.c, h.r).map((s) => seg(s.a, s.b, x, y, 0.96));
  }).join(''), [focus]);

  const unitPos = (id: string, hex: HexKey) => posOverride?.[id] ?? hexCenter(hex);

  return (
    <>
    <svg ref={view.ref} viewBox={view.box} role="img" aria-label="Kampagnenkarte von Angelonia" style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', cursor: view.dragging ? 'grabbing' : undefined }}
      onPointerDown={view.down} onPointerMove={view.move} onPointerUp={view.up} onPointerCancel={view.up} onClickCapture={view.click}>
      <defs>
        {Object.values(TILE).concat(['stadt']).map((t) => (
          <pattern key={t} id={`t-${t}`} patternContentUnits="objectBoundingBox" width="1" height="1">
            <image href={`/tiles/${t}.jpg`} x="-0.08" y="-0.02" width="1.16" height="1.04" preserveAspectRatio="xMidYMid slice" />
          </pattern>
        ))}
        <pattern id="t-meer" patternUnits="userSpaceOnUse" width="240" height="240"><image href="/tiles/meer.jpg" width="240" height="240" /></pattern>
        {(['R', 'K'] as House[]).map((h) => (
          <marker key={h} id={`arrow-${h}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.4" markerHeight="3.4" orient="auto"><path d="M0 0L10 5L0 10z" fill={HOUSES[h].color} /></marker>
        ))}
 <filter id="dm-rest"><feColorMatrix type="saturate" values="0.15" /><feComponentTransfer><feFuncA type="linear" slope="0.75" /></feComponentTransfer></filter>
        <filter id="dm-pop" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.3" result="d" /><feFlood floodColor="#160F08" floodOpacity="0.85" /><feComposite in2="d" operator="in" result="o" /><feDropShadow in="o" dx="0" dy="1.5" stdDeviation="1.2" floodOpacity="0.5" result="os" /><feMerge><feMergeNode in="os" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <radialGradient id="dm-shadow"><stop offset="0" stopColor="#000" stopOpacity="0.45" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
        <marker id="arrow-plan" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.4" markerHeight="3.4" orient="auto"><path d="M0 0L10 5L0 10z" fill="#F3D27A" /></marker>
      </defs>
      <rect width={MAP_W} height={MAP_H} fill="url(#t-meer)" />
      <rect width={MAP_W} height={MAP_H} fill="#0E3A44" opacity={0.15} />

      {Object.keys(HEX).map((k) => {
        const h = HEX[k];
        return (
          <polygon key={k} data-hex={k} data-prov={h.prov!} points={pts(hexPoints(h.c, h.r))} fill={`url(#t-${CITY_HEX[k] ? 'stadt' : TILE[h.land!]})`}
            stroke="#241B10" strokeOpacity={0.45} strokeWidth={1} style={{ cursor: 'pointer' }} onClick={() => onHex(k)} />
        );
      })}
      {Object.keys(HEX).filter((k) => c.hexOwner[k]).map((k) => (
        <polygon key={`o${k}`} points={pts(hexPoints(...center2(k)))} fill={HOUSES[c.hexOwner[k]!].color} fillOpacity={0.22} stroke="none" pointerEvents="none" />
      ))}
      {reach && Object.keys(reach).filter((k) => k !== plan?.from).map((k) => (
        <polygon key={`r${k}`} points={pts(hexPoints(...center2(k), 3))} fill="#7FE3FF" fillOpacity={0.2} stroke="#7FE3FF" strokeOpacity={0.55} strokeWidth={1.2} pointerEvents="none" />
      ))}
      {selectedHex && HEX[selectedHex] && (
        <polygon points={pts(hexPoints(...center2(selectedHex), 2))} fill="#E2C27F" fillOpacity={0.2} stroke="#E2C27F" strokeWidth={2.5} pointerEvents="none" />
      )}

      <path d={geo.prov} fill="none" stroke="#3B2F22" strokeWidth={1.4} strokeDasharray="4 3" strokeOpacity={0.7} pointerEvents="none" />
      {(['R', 'K'] as House[]).map((hs) => borders[hs] && (
        <g key={hs} pointerEvents="none">
          <path d={borders[hs]} fill="none" stroke="#120E0A" strokeOpacity={0.6} strokeWidth={6} strokeLinecap="round" />
          <path d={borders[hs]} fill="none" stroke={HOUSES[hs].color} strokeWidth={3.5} strokeLinecap="round" />
        </g>
      ))}
      <path d={geo.coast} fill="none" stroke="#3B2F22" strokeWidth={2.8} strokeLinecap="round" pointerEvents="none" />
      {focusPath && (
        <g pointerEvents="none" className="focus-ring">
          <path d={focusPath} fill="none" stroke="#120E0A" strokeOpacity={0.8} strokeWidth={8} strokeLinecap="round" />
          <path d={focusPath} fill="none" stroke="#F3D27A" strokeWidth={4} strokeLinecap="round" />
        </g>
      )}

      {/* buildings and construction sites */}
      {Object.entries(c.buildings).map(([k, b]) => {
        const [x, y] = hexCenter(k);
        const active = buildingActive(c, k), o = buildingOwnerOf(c, k);
        const city = !!CITY_HEX[k];
        const name = spriteName.building(b);
        if (hasSprite(name)) {
          const [w, h] = spriteBox(name, city ? 38 : 48);
          const bx = x + (city ? 20 : 0), by = y + (city ? 4 : 8);
          return (
            <g key={`b${k}`} pointerEvents="none">
              <title>{BUILDINGS[b].n}{active ? '' : ' (ruht)'}</title>
              <ellipse cx={bx} cy={by} rx={w * 0.42} ry={7} fill={o ? HOUSES[o].color : '#6E6A60'} opacity={0.55} />
              <g filter="url(#dm-pop)"><image href={spriteUrl(name)} x={bx - w / 2} y={by - h + 4} width={w} height={h} filter={active ? undefined : 'url(#dm-rest)'} /></g>
              {levelOf(c, k) > 1 && <g transform={`translate(${bx - w / 2 + 4},${by - h + 10})`}><rect x={-9} y={-7} width={18} height={14} rx={4} fill="#E2C27F" stroke="#1E1A15" strokeWidth={1} /><text y={3.6} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#1E1A15" fontFamily="Georgia, serif">{ROMAN[levelOf(c, k)]}</text></g>}
              {!active && <g transform={`translate(${bx + w / 2 - 6},${by - h + 8})`}><circle r={7} fill="#7E2621" stroke="#F1E8D2" strokeWidth={1.2} /><path d="M-3,-3 L3,3 M3,-3 L-3,3" stroke="#F1E8D2" strokeWidth={1.6} /></g>}
            </g>
          );
        }
        return (
          <g key={`b${k}`} transform={`translate(${x + (city ? 18 : 0)},${y + (city ? -14 : -12)})`} pointerEvents="none" opacity={active ? 1 : 0.6}>
            <title>{BUILDINGS[b].n}{active ? '' : ' (ruht)'}</title>
            <circle r={10} fill="#F3EAD4" stroke={o ? HOUSES[o].color : '#6E6A60'} strokeWidth={2.4} />
            <text y={4.2} textAnchor="middle" fontSize={12} fontWeight={700} fill="#2A2118">{BUILDING_ICON[b]}</text>
            {!active && <path d="M-8,8 L8,-8" stroke="#A8322D" strokeWidth={2.4} strokeLinecap="round" />}
            {levelOf(c, k) > 1 && <text x={11} y={-7} fontSize={9} fontWeight={800} fill="#E2C27F" stroke="#1E1A15" strokeWidth={2.4} paintOrder="stroke">{ROMAN[levelOf(c, k)]}</text>}
          </g>
        );
      })}
      {(construction ?? []).map((s, i) => {
        const [x, y] = hexCenter(s.hex);
        const city = !!CITY_HEX[s.hex];
        const bx = x + (city ? 20 : 0), by = y + (city ? 4 : 14);
        const name = spriteName.construction();
        if (s.up) return (
          <g key={`c${i}`} pointerEvents="none" className="dm-build">
            <title>Ausbau: {BUILDINGS[s.b].n} {ROMAN[s.up]}</title>
            <ellipse cx={x + (city ? 20 : 0)} cy={y + (city ? 4 : 8)} rx={20} ry={8} fill="none" stroke={HOUSES[s.house].color} strokeWidth={2.2} strokeDasharray="4 3" />
            <g transform={`translate(${x + (city ? 20 : 0) + 16},${y + (city ? 4 : 8) - 34})`}>
              <rect x={-14} y={-8} width={28} height={16} rx={8} fill="#F3EAD4" stroke={HOUSES[s.house].color} strokeWidth={2} />
              <text y={4} textAnchor="middle" fontSize={10} fontWeight={800} fill="#2A2118">↑{ROMAN[s.up]}</text>
            </g>
          </g>
        );
        return (
          <g key={`c${i}`} pointerEvents="none" className="dm-build">
            <title>Im Bau: {BUILDINGS[s.b].n}</title>
            <ellipse cx={bx} cy={by} rx={17} ry={7} fill="none" stroke={HOUSES[s.house].color} strokeWidth={2} strokeDasharray="4 3" />
            {hasSprite(name)
              ? (() => { const [w, h] = spriteBox(name, 46); return <image href={spriteUrl(name)} x={bx - w / 2} y={by - h + 4} width={w} height={h} filter="url(#dm-pop)" />; })()
              : <g transform={`translate(${bx},${by - 9})`}>
                  <rect x={-16} y={-12} width={32} height={22} rx={5} fill="#F3EAD4" fillOpacity={0.92} stroke={HOUSES[s.house].color} strokeWidth={2} strokeDasharray="4 2.5" />
                  <path d="M-10,8 L-6,-9 M6,-9 L10,8 M-9,2 H9 M-7,-4 H7" stroke="#7A5A2E" strokeWidth={2.2} strokeLinecap="round" />
                  <circle r={7.5} cx={15} cy={-12} fill="#F3EAD4" stroke={HOUSES[s.house].color} strokeWidth={2} />
                  <text x={15} y={-8.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#2A2118">{BUILDING_ICON[s.b]}</text>
                </g>}
          </g>
        );
      })}

      {/* order paths */}
      {orders.map((o, i) => {
        if (o.kind === 'move' || o.kind === 'agent') {
          const u = o.kind === 'move' ? c.armies.find((x) => x.id === o.army) : c.agents.find((x) => x.id === o.agent);
          if (!u) return null;
          return <path key={i} d={line(u.hex, o.path)} fill="none" stroke={HOUSES[u.house].color} strokeWidth={o.kind === 'move' ? 5 : 3}
            strokeDasharray={o.kind === 'agent' ? '5 5' : undefined} strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#arrow-${u.house})`} opacity={0.9} pointerEvents="none" />;
        }
        if (o.kind === 'support') {
          const a = c.armies.find((x) => x.id === o.army);
          if (!a) return null;
          const [x1, y1] = hexCenter(a.hex), [x2, y2] = hexCenter(o.target);
          return <path key={i} d={`M${x1} ${y1}L${x1 + (x2 - x1) * 0.7} ${y1 + (y2 - y1) * 0.7}`} fill="none" stroke={HOUSES[a.house].color} strokeWidth={3}
            strokeDasharray="2 5" strokeLinecap="round" markerEnd={`url(#arrow-${a.house})`} pointerEvents="none" />;
        }
        return null;
      })}
      {plan && plan.path.length > 0 && (
        <g pointerEvents="none">
          <path d={line(plan.from, plan.path)} fill="none" stroke="#120E0A" strokeOpacity={0.6} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
          <path d={line(plan.from, plan.path)} fill="none" stroke="#F3D27A" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#arrow-plan)" />
          {plan.path.map((k, i) => { const [x, y] = hexCenter(k); return <circle key={i} cx={x} cy={y} r={3.5} fill="#F3D27A" stroke="#120E0A" strokeWidth={1} />; })}
        </g>
      )}

      {/* province names and city shields */}
      {PROVINCES.map((pv) => {
        const [x, y] = provCenter(pv.id);
        const o = c.owner[pv.id];
        return (
          <g key={pv.id} pointerEvents="none">
            {pv.city && <path transform={`translate(${x - 20},${y - 16})`} d="M-6,-5 h12 v6 q0,6 -6,8 q-6,-2 -6,-8 z" fill={o ? HOUSES[o].color : '#6E6A60'} stroke="#F1E8D2" strokeWidth={1.5} />}
            {pv.capital && <path transform={`translate(${x - 20},${y - 26})`} d="M-5,2 l2,-6 l3,4 l3,-4 l2,6 z" fill="#E2C27F" stroke="#3B2F22" strokeWidth={0.8} />}
            <text x={x} y={y + 31} textAnchor="middle" fontFamily="Spectral SC, Georgia, serif" fontWeight={700} fontSize={13}
              fill="#2A2118" stroke="#F3EAD4" strokeWidth={4.5} strokeLinejoin="round" paintOrder="stroke" letterSpacing={0.5}>{PROV[pv.id].n.toUpperCase()}</text>
          </g>
        );
      })}

      {/* traders, agents, armies */}
      {c.traders.map((t) => {
        const [x, y] = unitPos(t.id, t.hex);
        const walk = moving?.has(t.id);
        const name = spriteName.wagon();
        return (
          <g key={t.id} data-trader={t.id} pointerEvents="none" style={{ transform: `translate(${x - 17}px, ${y + 16}px)`, transition: `transform ${stepMs}ms ease-in-out` }}>
            <title>Händler von {HOUSES[t.house].n}, bringt {t.gold} Gold</title>
            <ellipse cx={0} cy={4} rx={13} ry={4} fill="url(#dm-shadow)" />
            {walk && <Dust />}
            <g className={walk ? 'dm-march' : undefined}>
              {hasSprite(name)
                ? (() => { const [w, h] = spriteBox(name, 28); return <image href={spriteUrl(name)} x={-w / 2} y={4 - h} width={w} height={h} filter="url(#dm-pop)" />; })()
                : <><rect x={-9} y={-6} width={18} height={9} rx={2} fill="#C9A15A" stroke={HOUSES[t.house].color} strokeWidth={2} /><circle cx={-5} cy={5} r={3} fill="#3B2F22" /><circle cx={5} cy={5} r={3} fill="#3B2F22" /></>}
              <path d="M-11,-14 v-9 l7,3 l-7,3" fill={HOUSES[t.house].color} stroke="#F1E8D2" strokeWidth={0.8} className="dm-flag" />
            </g>
            <text x={13} y={2} fontSize={9} fontWeight={700} fill="#F3EAD4" stroke="#1E1A15" strokeWidth={2.5} paintOrder="stroke">{t.gold}</text>
          </g>
        );
      })}
      {c.agents.map((g) => {
        const [x, y] = unitPos(g.id, g.hex);
        return (
          <g key={g.id} data-agent-id={g.id} onClick={(e) => { e.stopPropagation(); onAgent?.(g.id); }}
            style={{ cursor: onAgent ? 'pointer' : undefined, transform: `translate(${x + 17}px, ${y + 13}px)`, transition: `transform ${stepMs}ms ease-in-out` }}>
            {selectedUnit === g.id && <circle r={13} fill="none" stroke="#E2C27F" strokeWidth={2.5} />}
            {hasSprite(spriteName.agent(g.spec)) ? (() => {
              const name = spriteName.agent(g.spec), [w, h] = spriteBox(name, 38);
              return <>
                <ellipse cy={7} rx={9} ry={3.5} fill={HOUSES[g.house].color} stroke="#F1E8D2" strokeWidth={1} />
                {moving?.has(g.id) && <Dust />}
                <g className={moving?.has(g.id) ? 'dm-march' : 'dm-idle'}><image href={spriteUrl(name)} x={-w / 2} y={8 - h} width={w} height={h} filter="url(#dm-pop)" /></g>
              </>;
            })() : <>
              <circle r={10} fill="#F1E8D2" stroke={HOUSES[g.house].color} strokeWidth={3} />
              <text y={3.6} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#1E1A15">{AGENT_ABBR[g.spec]}</text>
            </>}
          </g>
        );
      })}
      {c.armies.map((a) => {
        const [x, y] = unitPos(a.id, a.hex);
        return <Token key={a.id} x={x} y={y} house={a.house} size={a.size} spec={a.spec.CAP + a.spec.KAP + a.spec.KAN + a.spec.MAR}
          selected={selectedUnit === a.id} mark={marks[a.id]} id={a.id} ms={stepMs} moving={!!moving?.has(a.id)} rank={xpOn(c) ? rankOf(a) : 0}
          onClick={(e) => { e.stopPropagation(); if (onArmy) onArmy(a.id); else onHex(a.hex); }} />;
      })}
      {c.battles.map((b) => {
        const [x1, y1] = hexCenter(b.from), [x2, y2] = hexCenter(b.hex);
        const x = b.from === b.hex ? x2 : (x1 + x2) / 2, y = b.from === b.hex ? y2 - 22 : (y1 + y2) / 2;
        return (
          <g key={b.id} pointerEvents="none" transform={`translate(${x},${y})`}>
            <circle r={12} fill="#1E1A15" stroke="#E2C27F" strokeWidth={2} />
            <path d="M-6,-6 L6,6 M6,-6 L-6,6" stroke="#F1E3BE" strokeWidth={2} strokeLinecap="round" />
          </g>
        );
      })}
      {labels && Object.entries(labels).map(([k, l]) => {
        if (!l.text) return null;
        const [x, y] = hexCenter(k);
        const w = l.text.length * 6 + 14;
        return (
          <g key={`l${k}`} transform={`translate(${x},${y - 26})`} pointerEvents="none">
            <rect x={-w / 2} y={-9} width={w} height={18} rx={9} fill={TONE[l.tone]} stroke="#F1E8D2" strokeWidth={1.2} />
            <text y={3.6} textAnchor="middle" fontFamily="Figtree, sans-serif" fontWeight={700} fontSize={10.5} fill="#FFF8EC">{l.text}</text>
          </g>
        );
      })}
    </svg>
    <div className="map-zoom" role="group" aria-label="Kartenausschnitt">
      <button type="button" className="icon-btn" aria-label="Näher heran" title="Näher heran (Mausrad)" onClick={() => view.zoomBy(0.75)}>+</button>
      <button type="button" className="icon-btn" aria-label="Weiter weg" title="Weiter weg (Mausrad)" onClick={() => view.zoomBy(1 / 0.75)}>−</button>
      <button type="button" className="icon-btn" aria-label="Ganze Karte" title="Ganze Karte" onClick={view.fit} disabled={view.full}>⤢</button>
    </div>
    </>
  );
}

const center2 = (k: HexKey) => { const h = HEX[k]; return [h.c, h.r] as [number, number]; };

function Dust() {
  return (
    <g className="dm-dust" pointerEvents="none">
      <circle cx={-10} cy={6} r={3} /><circle cx={-16} cy={4} r={2.2} /><circle cx={-6} cy={8} r={2} />
    </g>
  );
}

function Token({ x, y, house, size, spec, selected, mark, id, ms, moving, rank = 0, onClick }: {
  x: number; y: number; house: House; size: number; spec: number; selected?: boolean; mark?: Mark; id?: string; ms: number; moving?: boolean; rank?: number; onClick?: (e: RMouseEvent) => void;
}) {
  const chevrons = (dx: number, dy: number) => rank > 0 && (
    <g transform={`translate(${dx},${dy})`} aria-label={rank >= 2 ? 'Veteran' : 'Erprobt'}>
      {Array.from({ length: rank }, (_, i) => <path key={i} d={`M-6,${i * 5} L0,${i * 5 - 4} L6,${i * 5}`} fill="none" stroke="#1E1A15" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />)}
      {Array.from({ length: rank }, (_, i) => <path key={`g${i}`} d={`M-6,${i * 5} L0,${i * 5 - 4} L6,${i * 5}`} fill="none" stroke="#E2C27F" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />)}
    </g>
  );
  const name = spriteName.army(house, !!moving);
  const painted = hasSprite(name);
  const markIcon = mark && (
    <g transform={painted ? 'translate(-26,13)' : 'translate(-22,13)'} aria-label={mark === 'move' ? 'zieht' : mark === 'support' ? 'unterstützt' : 'fouragiert'}>
      <circle r={8.5} fill="#F1E8D2" stroke="#1E1A15" strokeWidth={1} />
      {mark === 'move' && <path d="M-4.5,0 H3 M0,-3.5 L4,0 L0,3.5" fill="none" stroke="#1E1A15" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
      {mark === 'support' && <path d="M-4,-4.5 H4 V0 Q4,3.5 0,5 Q-4,3.5 -4,0 Z" fill="#1E1A15" />}
      {mark === 'forage' && <path d="M0,5 V-4.5 M0,-1.5 L-3.5,-4.5 M0,-1.5 L3.5,-4.5 M0,1.5 L-3.5,-1.5 M0,1.5 L3.5,-1.5" fill="none" stroke="#1E1A15" strokeWidth={1.5} strokeLinecap="round" />}
    </g>
  );
  if (painted) {
    const [w, h] = spriteBox(name, 72);
    return (
      <g data-army={house} data-army-id={id} onClick={onClick}
        style={{ cursor: onClick ? 'pointer' : undefined, transform: `translate(${x}px, ${y}px)`, transition: `transform ${ms}ms ease-in-out` }}>
        <ellipse cy={12} rx={22} ry={7} fill="url(#dm-shadow)" />
        {selected && <ellipse cy={12} rx={25} ry={9} fill="none" stroke="#E2C27F" strokeWidth={3} />}
        {moving && <Dust />}
        <g className={moving ? 'dm-march' : 'dm-idle'}>
          <image href={spriteUrl(name)} x={-w / 2} y={14 - h} width={w} height={h} filter="url(#dm-pop)" />
        </g>
        <g transform="translate(-26,-6)">
          <rect x={-15} y={-8} width={30} height={16} rx={8} fill={HOUSES[house].color} stroke="#F1E8D2" strokeWidth={1.5} />
          <text y={4.5} textAnchor="middle" fontFamily="Figtree, sans-serif" fontWeight={800} fontSize={12} fill="#FFF8F2">{size}</text>
        </g>
        {chevrons(-26, 8)}
        {spec > 0 && <g transform="translate(-15,-15)"><circle r={7} fill="#E2C27F" stroke="#1E1A15" strokeWidth={1} /><text y={3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#1E1A15">{spec}</text></g>}
        {markIcon}
      </g>
    );
  }
  return (
    <g data-army={house} data-army-id={id} onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined, transform: `translate(${x}px, ${y}px) scale(0.8)`, transition: `transform ${ms}ms ease-in-out` }}>
      {moving && <Dust />}
      <g className={moving ? 'dm-march' : undefined}>
        {selected && <rect x={-29} y={-20} width={58} height={40} rx={10} fill="none" stroke="#E2C27F" strokeWidth={3.5} />}
        <rect x={-24} y={-15} width={48} height={30} rx={7} fill={HOUSES[house].color} stroke="#F1E8D2" strokeWidth={2} />
        <path d="M-15,-8 v16 M-15,-8 l9,4 l-9,4" fill="none" stroke="#FFF6F2" strokeWidth={1.5} strokeLinejoin="round" className="dm-flag" />
        <text x={6} y={5} textAnchor="middle" fontFamily="Figtree, sans-serif" fontWeight={700} fontSize={15} fill="#FFF8F2">{size}</text>
      </g>
      {markIcon}
      {chevrons(0, -24)}
      {spec > 0 && <g transform="translate(20,-14)"><circle r={8} fill="#E2C27F" stroke="#1E1A15" strokeWidth={1} /><text y={4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#1E1A15">{spec}</text></g>}
    </g>
  );
}

/**
 * Zoom with the mouse wheel or the buttons, pan by dragging. Works on the SVG viewBox, so clicks, tokens and the
 * screen positions of overlays (getScreenCTM) stay right. A drag never counts as a click.
 */
function useZoom(outer: RefObject<SVGSVGElement> | undefined, onCamera?: () => void) {
  const own = useRef<SVGSVGElement>(null);
  const ref = (outer ?? own) as RefObject<SVGSVGElement>;
  const [vb, setVb] = useState<[number, number, number, number]>([0, 0, MAP_W, MAP_H]);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const swallow = useRef(false);
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onCamera); cb.current = onCamera;
  const clamp = (b: [number, number, number, number]): [number, number, number, number] => {
    const w = Math.min(MAP_W, Math.max(Math.min(MAP_W, 480), b[2])), h = w * (MAP_H / MAP_W);
    return [Math.max(0, Math.min(MAP_W - w, b[0])), Math.max(0, Math.min(MAP_H - h, b[1])), w, h];
  };
  useEffect(() => { requestAnimationFrame(() => cb.current?.()); }, [vb]);
  const zoomAt = (f: number, sx?: number, sy?: number) => setVb((b) => {
    const cx = sx ?? b[0] + b[2] / 2, cy = sy ?? b[1] + b[3] / 2;
    return clamp([cx - (cx - b[0]) * f, cy - (cy - b[1]) * f, b[2] * f, b[3] * f]);
  });
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const m = ref.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y] as const;
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = toSvg(e); zoomAt(Math.exp(e.deltaY * 0.0015), p?.[0], p?.[1]); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    ref, dragging,
    box: vb.map((v) => v.toFixed(1)).join(' '),
    full: vb[2] >= MAP_W - 0.5,
    zoomBy: (f: number) => zoomAt(f),
    fit: () => setVb([0, 0, MAP_W, MAP_H]),
    down: (e: RPointerEvent) => { swallow.current = false; if (e.button === 0) drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; },
    move: (e: RPointerEvent) => {
      const d = drag.current;
      if (!d || vb[2] >= MAP_W - 0.5) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      if (!d.moved) { d.moved = true; setDragging(true); ref.current?.setPointerCapture(d.id); }
      const m = ref.current?.getScreenCTM();
      const k = m ? 1 / m.a : 1;
      d.x = e.clientX; d.y = e.clientY;
      setVb((b) => clamp([b[0] - dx * k, b[1] - dy * k, b[2], b[3]]));
    },
    up: () => { if (drag.current?.moved) swallow.current = true; drag.current = null; setDragging(false); },
    click: (e: RMouseEvent) => { if (swallow.current) { e.stopPropagation(); e.preventDefault(); swallow.current = false; } },
  };
}
