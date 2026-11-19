// Development only: all pieces in a row, to look at the models (not part of the production build).
import { useEffect, useRef } from 'react';
import { Table3D } from '../three/Table3D.ts';
import { fromName, scene } from '../game/rules.ts';

export default function DevPieces() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const t = new Table3D(host.current, { onSquare: () => {}, onCard: () => {} });
    const st = scene([['a5', 'KAN'], ['b5', 'MAR'], ['c5', 'KAP'], ['d5', 'FL'], ['e5', 'CAP'], ['f5', 'INF'], ['g5', 'stone'], ['h5', 'STW'],
      ['b3', 'U:KAP'], ['d3', 'U:FL'], ['f3', 'U:INF'], ['h3', 'PT']]);
    st.board[fromName('h5')]!.coins = ['sov', 'crown', 'penny', 'farthing', 'florin'];
    t.update({ state: st, selected: null, moves: [], shieldPick: false, selectedCard: null });
    const q = new URLSearchParams(location.search);
    t.face(q.get('side') === 'O' ? 'O' : 'M');
    setTimeout(() => { for (let i = 0; i < Number(q.get('zoom') ?? 3); i++) t.zoom(-1.5); }, 300);
    return () => t.dispose();
  }, []);
  return <div className="app"><div className="stage" ref={host} style={{ gridColumn: '1 / -1' }} /></div>;
}
