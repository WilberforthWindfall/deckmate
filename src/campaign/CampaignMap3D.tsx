import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Campaign3D, MOODS, type CameraPose } from '../three/Campaign3D.ts';
import type { MapProps } from './CampaignMap.tsx';
import type { HexKey, House } from './map.ts';

type Props = Omit<MapProps, 'svgRef' | 'stepMs'> & {
  /** House whose view the camera poses use. */
  house: House;
  /** Filled with a function that gives a field's position on screen (client coordinates). */
  projector: MutableRefObject<((hex: HexKey) => [number, number] | null) | null>;
  onCamera?: () => void;
};

const POSES: { k: CameraPose; n: string; t: string }[] = [
  { k: 'uebersicht', n: 'Übersicht', t: 'Die ganze Karte von oben' },
  { k: 'feldherr', n: 'Feldherr', t: 'Schräger Blick von der eigenen Seite' },
  { k: 'nah', n: 'Hauptstadt', t: 'Nah an die eigene Hauptstadt' },
];

export default function CampaignMap3D(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<Campaign3D | null>(null);
  const handlers = useRef(p);
  handlers.current = p;
  const [pose, setPose] = useState<CameraPose>('feldherr');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    let m: Campaign3D;
    try {
      m = new Campaign3D(host.current, {
        onHex: (k) => handlers.current.onHex(k),
        onArmy: (id) => handlers.current.onArmy?.(id),
        onAgent: (id) => handlers.current.onAgent?.(id),
        onCamera: () => handlers.current.onCamera?.(),
      });
    } catch (e) { console.error('[Deckmate] 3D-Karte', e); setFailed(true); return; }
    map.current = m;
    if (import.meta.env.DEV) (window as unknown as { __map3d?: Campaign3D }).__map3d = m;
    m.pose('feldherr', handlers.current.house);
    p.projector.current = (hex) => {
      const xy = m.project(hex);
      const r = host.current?.getBoundingClientRect();
      return xy && r ? [xy[0] + r.left, xy[1] + r.top] : null;
    };
    return () => { p.projector.current = null; m.dispose(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    map.current?.update({ c: p.c, selectedHex: p.selectedHex, selectedUnit: p.selectedUnit, reach: p.reach, plan: p.plan, orders: p.orders, labels: p.labels, focus: p.focus, posOverride: p.posOverride, moving: p.moving, construction: p.construction });
  });

  const focus = p.focus?.[0];
  const hadFocus = useRef(false);
  useEffect(() => {
    if (focus) { hadFocus.current = true; map.current?.flyTo(focus); }
    else if (hadFocus.current) { hadFocus.current = false; map.current?.pose(pose, p.house); }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  // a new house at the device: look from its side
  useEffect(() => { map.current?.pose(pose, p.house); }, [p.house]); // eslint-disable-line react-hooks/exhaustive-deps

  const mood = MOODS[(p.c.round - 1) % MOODS.length];
  if (failed) return <div className="empty" style={{ padding: 24 }}>Die 3D-Ansicht lässt sich auf diesem Gerät nicht starten. Bitte die 2D-Karte verwenden.</div>;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} aria-label="Kampagnenkarte in 3D" role="img" />
      <div className="row" style={{ position: 'absolute', right: 12, top: 12, gap: 6, zIndex: 3 }}>
        {POSES.map((x) => (
          <button key={x.k} type="button" title={x.t} className={pose === x.k ? 'on' : ''} onClick={() => { setPose(x.k); map.current?.pose(x.k, p.house); }}>{x.n}</button>
        ))}
      </div>
      <div style={{ position: 'absolute', right: 12, top: 54, zIndex: 3, textAlign: 'right', fontSize: 12, padding: '4px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--hull) 80%, transparent)', color: 'var(--parchment)' }}>
        <b style={{ color: 'var(--brass)' }}>{mood.n}</b> · Ziehen dreht · rechte Maustaste oder Umschalt verschiebt · Mausrad zoomt
      </div>
    </div>
  );
}
