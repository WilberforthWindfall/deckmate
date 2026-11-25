import { useEffect, useState } from 'react';
import { isStale, onStale, watchVersion } from '../version.ts';

/** Shown on every page as soon as a newer Deckmate has been published (see version.ts). */
export default function UpdateBanner() {
  const [stale, setStale] = useState(isStale());
  useEffect(() => {
    const off = onStale(setStale);
    const stop = watchVersion();
    return () => { off(); stop(); };
  }, []);
  if (!stale) return null;
  return (
    <div className="update-banner" role="status">
      <span>Eine neue Version von Deckmate ist da – mit aktuellen Regeln.</span>
      <button type="button" className="primary" onClick={() => window.location.reload()}>Jetzt neu laden</button>
    </div>
  );
}
