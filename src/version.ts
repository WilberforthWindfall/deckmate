// Stale-tab guard (tester feedback #49, 23.11.2026): new games and moves are computed in the browser, so a tab that has
// stayed open since an older deploy would still apply the old rules (e.g. Ugur hidden outside the bilge). Every build
// writes /version.json; when it no longer matches the running build, the page reloads before it touches a game.

declare const __BUILD__: string;
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

let latest: string | null = null;
let checkedAt = 0;
const listeners = new Set<(stale: boolean) => void>();

async function fetchLatest(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: unknown };
    return typeof j.build === 'string' ? j.build : null;
  } catch {
    return null; // offline or dev server: never block the game because of this check
  }
}

export const isStale = () => !!latest && latest !== BUILD;

/** Asks the server for the current build at most once per `maxAge` ms. */
export async function checkVersion(maxAge = 60_000): Promise<boolean> {
  if (import.meta.env.DEV) return false;
  if (Date.now() - checkedAt > maxAge) {
    checkedAt = Date.now();
    const l = await fetchLatest();
    if (l) latest = l;
    listeners.forEach((f) => f(isStale()));
  }
  return isStale();
}

/** Call before creating a game or sending a move: reloads an outdated tab instead of applying old rules. */
export async function ensureFresh(): Promise<void> {
  if (await checkVersion()) {
    window.location.reload();
    throw new Error('Es gibt eine neue Version von Deckmate – die Seite wird neu geladen.');
  }
}

export function onStale(f: (stale: boolean) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Background check: when the tab comes back to the front and every few minutes. */
export function watchVersion(): () => void {
  const tick = () => { void checkVersion(); };
  const vis = () => { if (document.visibilityState === 'visible') tick(); };
  document.addEventListener('visibilitychange', vis);
  const timer = window.setInterval(tick, 5 * 60_000);
  tick();
  return () => { document.removeEventListener('visibilitychange', vis); window.clearInterval(timer); };
}
