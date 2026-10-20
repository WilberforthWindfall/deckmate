// Painted sprites for buildings and units (cut from two SpriteCook sheets, see public/sprites/spritecook-assets.json).
// Until the files exist, the maps fall back to the drawn icons and tokens.
import type { BuildingKey, SpecKey } from './engine.ts';
import type { House } from './map.ts';
import SIZES from './sprite-sizes.json';

/** Width/height of each sprite file; empty until the sheets are cut. */
export const SPRITE_SIZE = SIZES as Record<string, [number, number]>;
export const spritesReady = () => Object.keys(SPRITE_SIZE).length > 0;

export const spriteName = {
  building: (b: BuildingKey) => b,
  construction: () => 'baustelle',
  wagon: () => 'wagen',
  army: (h: House, moving: boolean) => `heer-${h}-${moving ? 'marsch' : 'rast'}`,
  agent: (s: SpecKey) => `agent-${s.toLowerCase()}`,
};
export const spriteUrl = (name: string) => `/sprites/${name}.png`;
export const hasSprite = (name: string) => name in SPRITE_SIZE;
/** Box for a sprite scaled to a given height. */
export const spriteBox = (name: string, h: number): [number, number] => {
  const s = SPRITE_SIZE[name];
  return s ? [h * (s[0] / s[1]), h] : [h, h];
};
