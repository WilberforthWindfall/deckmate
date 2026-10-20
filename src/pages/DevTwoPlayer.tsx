import { useEffect, useState } from 'react';
import { newCampaign, type Campaign as CampaignState } from '../campaign/engine.ts';
import type { House } from '../campaign/map.ts';
import Campaign from './Campaign.tsx';

// Development only: plays the online campaign between two browser tabs of the same browser (shared localStorage),
// so the two-player flow can be tested without Firebase. /dev/kampagne-zwei?haus=R and ?haus=K

const KEY = 'deckmate.dev.online';
const read = (): CampaignState => {
  try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch { /* ignore */ }
  const c = newCampaign({ maxRounds: 6, goals: true, experience: true });
  localStorage.setItem(KEY, JSON.stringify(c));
  return c;
};

export default function DevTwoPlayer() {
  const me = (new URLSearchParams(location.search).get('haus') === 'K' ? 'K' : 'R') as House;
  const [c, setC] = useState<CampaignState>(read);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === KEY && e.newValue) setC(JSON.parse(e.newValue)); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  return (
    <Campaign online={{
      id: `dev-${me}`, me, c, names: { R: 'Spieler Rot', K: 'Spieler Blau' }, name: 'Testkampagne',
      commit: async (fn) => { const next = fn(read(), me); localStorage.setItem(KEY, JSON.stringify(next)); setC(next); },
      startBattle: async () => { throw new Error('Brett-Schlachten gehen im Testmodus nicht – bitte auswürfeln.'); },
    }} />
  );
}
