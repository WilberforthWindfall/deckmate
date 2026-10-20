import * as THREE from 'three';
import {
  CITY_HEX, HEX, HEXES, HEX_R, HOUSES, MAP_H, MAP_W, PROV, PROVINCES, center, hexAt, hexCenter, hexLand, hexSides, hk, inGrid, provCenter,
  type HexKey, type House, type Land,
} from '../campaign/map.ts';
import { buildingActive, buildingOwnerOf, type Campaign, type Order, type SpecKey, type Tone } from '../campaign/engine.ts';
import { AGENT_ABBR, BUILDING_ICON } from '../campaign/CampaignMap.tsx';
import { BUILDINGS, type BuildingKey } from '../campaign/engine.ts';
import { SPRITE_SIZE, hasSprite, spriteName, spriteUrl } from '../campaign/sprites.ts';

// 3D view of the campaign map. Same inputs as the SVG map; the rules engine is untouched.

export interface MapView {
  c: Campaign;
  selectedHex: HexKey | null;
  selectedUnit?: string | null;
  reach?: Record<HexKey, number>;
  plan?: { from: HexKey; path: HexKey[]; house: House } | null;
  orders: Order[];
  labels?: Record<HexKey, { text: string; tone: Tone }>;
  focus?: HexKey[];
  posOverride?: Record<string, [number, number]>;
  moving?: Set<string>;
  construction?: { hex: HexKey; b: BuildingKey; house: House }[];
}
export interface MapHandlers {
  onHex: (k: HexKey) => void;
  onArmy: (id: string) => void;
  onAgent: (id: string) => void;
  /** Called while the camera moves, so overlays anchored to fields can follow. */
  onCamera?: () => void;
}
export type CameraPose = 'uebersicht' | 'feldherr' | 'nah';
export interface Mood { n: string; sun: number; sky: number; fog: [number, number]; sunPos: [number, number, number]; hemi: number; sunI: number }

/** Light per round so the same map looks different over a campaign. */
export const MOODS: Mood[] = [
  { n: 'Morgennebel', sun: 0xffd9b0, sky: 0x9fb4c4, fog: [28, 62], sunPos: [-14, 7, 6], hemi: 0.55, sunI: 1.0 },
  { n: 'Mittagssonne', sun: 0xfff4e0, sky: 0x7fa6c8, fog: [40, 90], sunPos: [-4, 18, 8], hemi: 0.7, sunI: 1.25 },
  { n: 'Abendrot', sun: 0xff9a5a, sky: 0x5a4a5e, fog: [34, 80], sunPos: [14, 6, -4], hemi: 0.45, sunI: 1.1 },
  { n: 'Regenwolken', sun: 0xcfd6dc, sky: 0x55606a, fog: [26, 58], sunPos: [-6, 14, 10], hemi: 0.75, sunI: 0.6 },
];

const S = 1 / HEX_R;
const toW = (x: number, y: number): [number, number] => [(x - MAP_W / 2) * S, (y - MAP_H / 2) * S];
const HEIGHT: Record<Land, number> = { A: 0.32, W: 0.4, S: 0.2, G: 0.95, F: 0.24, K: 0.28, H: 0.58 };
const TILE: Record<Land, string> = { A: 'acker', W: 'wald', S: 'sumpf', G: 'gebirge', F: 'fluss', K: 'kueste', H: 'huegel' };
const SIDE: Record<House | 'N', number> = { R: 0x6e2723, K: 0x24457c, N: 0x56452f };
const TONE: Record<Tone, string> = { ok: '#2F6E40', risk: '#8C5A12', bad: '#7E2621', plain: '#2A3F55' };

const provHeight = (id: string) => HEIGHT[hexAt(...PROV[id].seed).land!];
const hexHeight = (k: HexKey) => HEIGHT[hexLand(k)];

function canvasSprite(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, worldH: number) {
  const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = h * 2;
  const g = cv.getContext('2d')!; g.scale(2, 2); draw(g);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
  m.scale.set(worldH * (w / h), worldH, 1);
  return m;
}
const rr = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
};

function flagSprite(house: House, size: number, spec: number, mark: string | undefined, selected: boolean) {
  return canvasSprite(84, 56, (g) => {
    if (selected) { g.strokeStyle = '#E2C27F'; g.lineWidth = 3; rr(g, 3, 3, 78, 44, 11); g.stroke(); }
    g.fillStyle = HOUSES[house].color; g.strokeStyle = '#F1E8D2'; g.lineWidth = 2; rr(g, 9, 9, 66, 32, 8); g.fill(); g.stroke();
    g.strokeStyle = '#FFF6F2'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(19, 17); g.lineTo(19, 33); g.moveTo(19, 17); g.lineTo(28, 21); g.lineTo(19, 25); g.stroke();
    g.fillStyle = '#FFF8F2'; g.font = '700 17px Figtree, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(size), 47, 26);
    if (spec > 0) { g.fillStyle = '#E2C27F'; g.beginPath(); g.arc(72, 10, 8, 0, Math.PI * 2); g.fill(); g.fillStyle = '#1E1A15'; g.font = '700 10px Figtree, sans-serif'; g.fillText(String(spec), 72, 11); }
    if (mark) {
      g.fillStyle = '#F1E8D2'; g.strokeStyle = '#1E1A15'; g.lineWidth = 1; g.beginPath(); g.arc(11, 44, 8.5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = '#1E1A15'; g.fillStyle = '#1E1A15'; g.lineWidth = 1.8; g.beginPath();
      if (mark === 'move') { g.moveTo(6.5, 44); g.lineTo(14, 44); g.moveTo(11, 40.5); g.lineTo(15, 44); g.lineTo(11, 47.5); g.stroke(); }
      else if (mark === 'support') { g.moveTo(7, 39.5); g.lineTo(15, 39.5); g.lineTo(15, 44); g.quadraticCurveTo(15, 47.5, 11, 49); g.quadraticCurveTo(7, 47.5, 7, 44); g.closePath(); g.fill(); }
      else { g.moveTo(11, 49); g.lineTo(11, 39.5); g.moveTo(11, 42.5); g.lineTo(7.5, 39.5); g.moveTo(11, 42.5); g.lineTo(14.5, 39.5); g.moveTo(11, 45.5); g.lineTo(7.5, 42.5); g.moveTo(11, 45.5); g.lineTo(14.5, 42.5); g.stroke(); }
    }
  }, 0.95);
}

function agentSprite(house: House, spec: SpecKey, selected: boolean) {
  return canvasSprite(30, 30, (g) => {
    if (selected) { g.strokeStyle = '#E2C27F'; g.lineWidth = 2.5; g.beginPath(); g.arc(15, 15, 14, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#F1E8D2'; g.strokeStyle = HOUSES[house].color; g.lineWidth = 3.5; g.beginPath(); g.arc(15, 15, 10.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#1E1A15'; g.font = '800 10px Figtree, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(AGENT_ABBR[spec], 15, 16);
  }, 0.5);
}
function traderSprite(house: House, gold: number) {
  return canvasSprite(44, 26, (g) => {
    g.fillStyle = '#C9A15A'; g.strokeStyle = HOUSES[house].color; g.lineWidth = 2.5; rr(g, 4, 5, 22, 11, 2); g.fill(); g.stroke();
    g.fillStyle = '#3B2F22'; g.beginPath(); g.arc(9, 19, 3.5, 0, Math.PI * 2); g.arc(21, 19, 3.5, 0, Math.PI * 2); g.fill();
    g.font = '800 11px Figtree, sans-serif'; g.lineWidth = 3; g.strokeStyle = '#1E1A15'; g.strokeText(String(gold), 32, 14); g.fillStyle = '#F3EAD4'; g.fillText(String(gold), 32, 14);
  }, 0.4);
}

function textSprite(text: string, opts: { font: string; fill: string; stroke?: string; bg?: string; pad?: number }, worldH: number) {
  const probe = document.createElement('canvas').getContext('2d')!; probe.font = opts.font;
  const pad = opts.pad ?? 6;
  const w = Math.ceil(probe.measureText(text).width) + pad * 2 + 8, h = 30;
  return canvasSprite(w, h, (g) => {
    g.font = opts.font; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (opts.bg) { g.fillStyle = opts.bg; g.strokeStyle = '#F1E8D2'; g.lineWidth = 1.2; rr(g, 2, 4, w - 4, h - 8, (h - 8) / 2); g.fill(); g.stroke(); }
    if (opts.stroke) { g.strokeStyle = opts.stroke; g.lineWidth = 5; g.lineJoin = 'round'; g.strokeText(text, w / 2, h / 2 + 1); }
    g.fillStyle = opts.fill; g.fillText(text, w / 2, h / 2 + 1);
  }, worldH);
}

export class Campaign3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private sea: THREE.Mesh;
  private cols: { mesh: THREE.Mesh; prov: string; hex: HexKey }[] = [];
  private sideMat: Record<House | 'N', THREE.MeshStandardMaterial>;
  private dyn = new THREE.Group();
  private units = new Map<string, { obj: THREE.Group; to: THREE.Vector3; key: string; moving: boolean; body?: THREE.Object3D }>();
  private textures = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  /** A painted sprite standing on the ground (bottom centre at y = 0). */
  private painted(name: string, height: number) {
    let t = this.textures.get(name);
    if (!t) { t = this.loader.load(spriteUrl(name)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.textures.set(name, t); }
    const [w, h] = SPRITE_SIZE[name] ?? [1, 1];
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, alphaTest: 0.05 }));
    sp.center.set(0.5, 0);
    sp.scale.set(height * (w / h), height, 1);
    sp.userData.keepMap = true;
    return sp;
  }
  private armyGroup = new THREE.Group();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private view: MapView | null = null;
  private ownerKey = '';
  private dynKey = '';
  private orbit = { theta: 0, phi: 0.5, rad: 30, tTheta: 0, tPhi: 0.5, tRad: 30, look: new THREE.Vector3(0, 0, 0.6), tLook: new THREE.Vector3(0, 0, 0.6) };
  private down: { x: number; y: number; moved: boolean; button: number } | null = null;
  private raf = 0;
  private ro: ResizeObserver;
  private moodIndex = -1;
  private t0 = performance.now();

  constructor(private host: HTMLElement, private handlers: MapHandlers) {
    const mobile = matchMedia('(max-width: 860px)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    const s = this.scene;
    s.background = new THREE.Color(0x0d2a33);
    s.fog = new THREE.Fog(0x0d2a33, 30, 70);
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x1a1208, 0.6 * Math.PI); s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.2 * Math.PI);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0008;
    s.add(this.sun, this.sun.target);

    const loader = new THREE.TextureLoader();
    const tex = (n: string) => { const t = loader.load(`/tiles/${n}.jpg`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    const seaTex = tex('meer'); seaTex.wrapS = seaTex.wrapT = THREE.RepeatWrapping; seaTex.repeat.set(9, 9);
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ map: seaTex, color: 0x9fc4cc, roughness: 0.35, metalness: 0.1 }));
    this.sea.rotation.x = -Math.PI / 2; this.sea.position.y = 0.04; this.sea.receiveShadow = true; s.add(this.sea);

    const top: Record<string, THREE.MeshStandardMaterial> = {};
    for (const n of [...Object.values(TILE), 'stadt']) top[n] = new THREE.MeshStandardMaterial({ map: tex(n), roughness: 0.85 });
    this.sideMat = { R: new THREE.MeshStandardMaterial({ color: SIDE.R, roughness: 0.8 }), K: new THREE.MeshStandardMaterial({ color: SIDE.K, roughness: 0.8 }), N: new THREE.MeshStandardMaterial({ color: SIDE.N, roughness: 0.9 }) };
    const bottom = new THREE.MeshStandardMaterial({ color: 0x2a2015 });

    const peakMat = new THREE.MeshStandardMaterial({ color: 0x8b8a86, roughness: 0.9, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7, flatShading: true });
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2f4a26, roughness: 0.9, flatShading: true });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a3b26, roughness: 0.7, flatShading: true });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.8 });
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    for (const h of HEXES) {
      if (!h.prov || !h.land) continue;
      const height = HEIGHT[h.land];
      const p = PROV[h.prov];
      const isCity = !!p.city && p.seed[0] === h.c && p.seed[1] === h.r;
      const geo = new THREE.CylinderGeometry(0.985, 0.985, height, 6, 1);
      const m = new THREE.Mesh(geo, [this.sideMat.N, isCity ? top.stadt : top[TILE[h.land]], bottom]);
      const [x, z] = toW(...center(h.c, h.r));
      m.position.set(x, height / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.hex = hk(h.c, h.r);
      s.add(m); this.cols.push({ mesh: m, prov: h.prov, hex: hk(h.c, h.r) });
      // a little scenery
      if (h.land === 'G' && !isCity) {
        for (let i = 0; i < 2; i++) {
          const k = 0.35 + rnd() * 0.25;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(k, k * 1.6, 5), peakMat);
          cone.position.set(x + (rnd() - 0.5) * 0.9, height + k * 0.8, z + (rnd() - 0.5) * 0.9); cone.castShadow = true; s.add(cone);
          const cap = new THREE.Mesh(new THREE.ConeGeometry(k * 0.38, k * 0.6, 5), snowMat);
          cap.position.set(cone.position.x, height + k * 1.6 - k * 0.3 + 0.01, cone.position.z); s.add(cap);
        }
      }
      if (h.land === 'W' && !isCity) {
        for (let i = 0; i < 4; i++) {
          const k = 0.13 + rnd() * 0.08;
          const tree = new THREE.Mesh(new THREE.ConeGeometry(k, k * 3.2, 6), treeMat);
          tree.position.set(x + (rnd() - 0.5) * 1.1, height + k * 1.6, z + (rnd() - 0.5) * 1.1); tree.castShadow = true; s.add(tree);
        }
      }
      if (isCity) {
        const n = p.capital ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + 0.4, d = i === 0 && p.capital ? 0 : 0.42;
          const w = p.capital && i === 0 ? 0.32 : 0.22, hh = p.capital && i === 0 ? 0.5 : 0.24;
          const house = new THREE.Mesh(new THREE.BoxGeometry(w, hh, w), wallMat);
          house.position.set(x + Math.cos(a) * d, height + hh / 2, z + Math.sin(a) * d); house.castShadow = true; s.add(house);
          const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.82, w * 0.8, 4), roofMat);
          roof.position.set(house.position.x, height + hh + w * 0.4, house.position.z); roof.rotation.y = Math.PI / 4; roof.castShadow = true; s.add(roof);
        }
      }
    }
    // province names and city shields (static)
    for (const p of PROVINCES) {
      const [x, z] = toW(...provCenter(p.id));
      const y = provHeight(p.id);
      const name = textSprite(p.n.toUpperCase(), { font: '700 14px "Spectral SC", Georgia, serif', fill: '#2A2118', stroke: '#F3EAD4' }, 0.66);
      name.position.set(x, y + 0.25, z + 0.95); name.renderOrder = 2; s.add(name);
    }
    // thin dark lines along all province borders (static)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x241b10, transparent: true, opacity: 0.55 });
    for (const h of HEXES) {
      if (!h.prov) continue;
      for (const sd of hexSides(h.c, h.r)) {
        const n = inGrid(...sd.n) ? hexAt(...sd.n) : null;
        if (!n?.prov || n.prov === h.prov || h.c > n.c || (h.c === n.c && h.r > n.r)) continue;
        s.add(this.ribbon(sd.a, sd.b, Math.max(HEIGHT[h.land!], HEIGHT[n.land!]) + 0.012, 0.05, lineMat));
      }
    }
    s.add(this.dyn, this.armyGroup);

    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.noMenu);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
    document.fonts?.ready.then(() => { this.dynKey = ''; this.units.forEach((a) => (a.key = '')); if (this.view) this.update(this.view); });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.noMenu);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const x of mats) { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); }
    });
    this.renderer.dispose();
    el.remove();
  }

  /** A flat strip along a hex edge, lifted to height y. */
  private ribbon(a: [number, number], b: [number, number], y: number, width: number, mat: THREE.Material, inset = 0, cx?: number, cz?: number) {
    let [ax, az] = toW(...a), [bx, bz] = toW(...b);
    if (inset && cx !== undefined && cz !== undefined) {
      ax = cx + (ax - cx) * (1 - inset); az = cz + (az - cz) * (1 - inset);
      bx = cx + (bx - cx) * (1 - inset); bz = cz + (bz - cz) * (1 - inset);
    }
    const len = Math.hypot(bx - ax, bz - az);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len + width * 0.9, 0.03, width), mat);
    m.position.set((ax + bx) / 2, y, (az + bz) / 2);
    m.rotation.y = -Math.atan2(bz - az, bx - ax);
    return m;
  }

  setMood(round: number) {
    const i = (round - 1) % MOODS.length;
    if (i === this.moodIndex) return;
    this.moodIndex = i;
    const m = MOODS[i];
    this.sun.color.setHex(m.sun); this.sun.intensity = m.sunI * Math.PI;
    this.sun.position.set(...m.sunPos); this.sun.target.position.set(0, 0, 0);
    this.hemi.intensity = m.hemi * Math.PI;
    (this.scene.background as THREE.Color).setHex(m.sky);
    const fog = this.scene.fog as THREE.Fog; fog.color.setHex(m.sky); fog.near = m.fog[0]; fog.far = m.fog[1];
  }
  get mood() { return MOODS[Math.max(0, this.moodIndex)]; }

  pose(p: CameraPose, house?: House) {
    const o = this.orbit;
    if (p === 'uebersicht') { o.tTheta = 0; o.tPhi = 0.16; o.tRad = 31; o.tLook.set(0, 0, 0.3); }
    if (p === 'feldherr') { o.tTheta = house === 'K' ? 0.75 : -0.75; o.tPhi = 0.92; o.tRad = 28; o.tLook.set(0, 0, 0.8); }
    if (p === 'nah') {
      const cap = PROVINCES.find((x) => x.capital === (house ?? 'R'))!;
      const [x, z] = toW(...provCenter(cap.id));
      o.tTheta = house === 'K' ? 0.5 : -0.5; o.tPhi = 0.95; o.tRad = 11; o.tLook.set(x, provHeight(cap.id), z);
    }
  }
  /** Fly the camera to a field (e.g. the conflict being explained). */
  flyTo(hex: HexKey) {
    const [x, z] = toW(...hexCenter(hex));
    const o = this.orbit;
    // look a little to the right of the field so it sits left of centre and the card fits beside it
    const k = 2.6, rx = Math.cos(o.tTheta), rz = -Math.sin(o.tTheta);
    o.tLook.set(x + rx * k, hexHeight(hex), z + rz * k); o.tRad = Math.min(o.tRad, 21); if (o.tPhi < 0.6) o.tPhi = 0.85;
  }

  /** Screen position of a field relative to the host element. */
  project(hex: HexKey): [number, number] | null {
    const [x, z] = toW(...hexCenter(hex));
    const v = new THREE.Vector3(x, hexHeight(hex) + 0.4, z).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * this.host.clientWidth, (1 - v.y) / 2 * this.host.clientHeight];
  }

  update(v: MapView) {
    this.view = v;
    this.setMood(v.c.round);
    // owner colours on the column sides
    const ok = JSON.stringify(v.c.hexOwner);
    if (ok !== this.ownerKey) {
      this.ownerKey = ok;
      for (const col of this.cols) (col.mesh.material as THREE.Material[])[0] = this.sideMat[v.c.hexOwner[col.hex] ?? 'N'];
    }
    this.updateDyn(v);
    this.updateUnits(v);
  }

  private updateDyn(v: MapView) {
    const key = JSON.stringify([v.c.hexOwner, v.c.owner, v.c.buildings, v.c.buildingOwner, v.construction, Object.keys(SPRITE_SIZE).length, v.selectedHex, v.reach, v.plan, v.orders, v.labels, v.focus,
      v.c.battles.map((b) => [b.hex, b.from]), v.c.armies.map((a) => [a.id, a.hex]), v.c.agents.map((a) => [a.id, a.hex])]);
    if (key === this.dynKey) return;
    this.dynKey = key;
    for (const o of [...this.dyn.children]) {
      this.dyn.remove(o);
      o.traverse((x) => { const m = x as THREE.Mesh; m.geometry?.dispose?.(); const mat = m.material as THREE.SpriteMaterial | undefined; if (!x.userData.keepMap) mat?.map?.dispose(); mat?.dispose?.(); });
    }
    const add = (o: THREE.Object3D) => this.dyn.add(o);
    const capMat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const cap = (k: HexKey, mat: THREE.Material, r = 0.97) => {
      const [x, z] = toW(...hexCenter(k));
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 6), mat);
      m.position.set(x, hexHeight(k) + 0.015, z); m.userData.hex = k; add(m);
    };
    if (v.reach) { const mat = capMat(0x7fe3ff, 0.3); for (const k of Object.keys(v.reach)) if (k !== v.plan?.from) cap(k, mat, 0.9); }
    if (v.selectedHex && HEX[v.selectedHex]) cap(v.selectedHex, capMat(0xe2c27f, 0.3));
    // realm borders follow the owned fields
    for (const hs of ['R', 'K'] as House[]) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(HOUSES[hs].color) });
      for (const k of Object.keys(HEX)) {
        if (v.c.hexOwner[k] !== hs) continue;
        const h = HEX[k];
        const [cx, cz] = toW(...center(h.c, h.r));
        for (const sd of hexSides(h.c, h.r)) {
          const n = inGrid(...sd.n) ? hk(...sd.n) : null;
          if (n && HEX[n] && v.c.hexOwner[n] === hs) continue;
          add(this.ribbon(sd.a, sd.b, HEIGHT[h.land!] + 0.03, 0.09, mat, 0.07, cx, cz));
        }
      }
    }
    // focus outline (gold, pulsing in the loop)
    if (v.focus?.length) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xf3d27a, transparent: true, opacity: 1 });
      const g = new THREE.Group(); g.userData.pulse = true;
      for (const k of v.focus) {
        const h = HEX[k]; if (!h) continue;
        for (const sd of hexSides(h.c, h.r)) g.add(this.ribbon(sd.a, sd.b, HEIGHT[h.land!] + 0.1, 0.16, mat));
      }
      add(g);
    }
    // city shields and capital crowns, coloured by owner
    for (const p of PROVINCES) {
      if (!p.city) continue;
      const o = v.c.owner[p.id];
      const [x, z] = toW(...provCenter(p.id));
      const sh = canvasSprite(28, 34, (g) => {
        if (p.capital) { g.fillStyle = '#E2C27F'; g.strokeStyle = '#3B2F22'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(8, 9); g.lineTo(10, 2); g.lineTo(14, 6); g.lineTo(18, 2); g.lineTo(20, 9); g.closePath(); g.fill(); g.stroke(); }
        g.fillStyle = o ? HOUSES[o].color : '#6E6A60'; g.strokeStyle = '#F1E8D2'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(6, 12); g.lineTo(22, 12); g.lineTo(22, 20); g.quadraticCurveTo(22, 28, 14, 31); g.quadraticCurveTo(6, 28, 6, 20); g.closePath(); g.fill(); g.stroke();
      }, 0.5);
      sh.position.set(x - 0.6, provHeight(p.id) + 1.0, z - 0.45); add(sh);
    }
    // buildings: painted sprite if available, otherwise a small round sign
    for (const [k, b] of Object.entries(v.c.buildings)) {
      const active = buildingActive(v.c, k), o = buildingOwnerOf(v.c, k);
      const [x, z] = toW(...hexCenter(k));
      const name = spriteName.building(b);
      const px = x + (CITY_HEX[k] ? 0.55 : 0), pz = z - (CITY_HEX[k] ? 0.4 : 0.1);
      if (hasSprite(name)) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.04, 20), new THREE.MeshStandardMaterial({ color: o ? new THREE.Color(HOUSES[o].color) : 0x6e6a60, roughness: 0.7 }));
        plate.position.set(px, hexHeight(k) + 0.03, pz); add(plate);
        const sp = this.painted(name, CITY_HEX[k] ? 1.05 : 1.25);
        sp.position.set(px, hexHeight(k) + 0.04, pz);
        if (!active) (sp.material as THREE.SpriteMaterial).color.setRGB(0.55, 0.55, 0.55);
        add(sp);
        continue;
      }
      const sp = canvasSprite(30, 30, (g) => {
        g.globalAlpha = active ? 1 : 0.65;
        g.fillStyle = '#F3EAD4'; g.strokeStyle = o ? HOUSES[o].color : '#6E6A60'; g.lineWidth = 3; g.beginPath(); g.arc(15, 15, 12, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#2A2118'; g.font = '700 14px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(BUILDING_ICON[b], 15, 16);
        if (!active) { g.strokeStyle = '#A8322D'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(6, 24); g.lineTo(24, 6); g.stroke(); }
      }, 0.45);
      sp.position.set(px, hexHeight(k) + 0.45, pz - 0.25); add(sp);
    }
    // construction sites: scaffolding with a dashed ring in the builder's colour
    for (const site of v.construction ?? []) {
      const [x, z] = toW(...hexCenter(site.hex));
      const px = x + (CITY_HEX[site.hex] ? 0.55 : 0), pz = z - (CITY_HEX[site.hex] ? 0.4 : 0.1), y0 = hexHeight(site.hex);
      const g = new THREE.Group(); g.userData.pulse = true; g.position.set(px, y0, pz);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.03, 6, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(HOUSES[site.house].color), transparent: true }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.04; g.add(ring);
      if (hasSprite(spriteName.construction())) { const sp = this.painted(spriteName.construction(), 1.15); g.add(sp); }
      else {
        const wood = new THREE.MeshStandardMaterial({ color: 0x8c6a3a, roughness: 0.9 });
        for (const [dx, dz] of [[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.2], [0.25, 0.2]]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), wood); pole.position.set(dx, 0.35, dz); pole.castShadow = true; g.add(pole); }
        for (const y of [0.3, 0.6]) { const plank = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.5), wood); plank.position.y = y; plank.castShadow = true; g.add(plank); }
        const stone = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), new THREE.MeshStandardMaterial({ color: 0x9a948a })); stone.position.set(0.32, 0.08, 0.28); g.add(stone);
      }
      const tag = canvasSprite(30, 30, (cx) => {
        cx.fillStyle = '#F3EAD4'; cx.strokeStyle = HOUSES[site.house].color; cx.lineWidth = 3; cx.beginPath(); cx.arc(15, 15, 12, 0, Math.PI * 2); cx.fill(); cx.stroke();
        cx.fillStyle = '#2A2118'; cx.font = '700 14px Georgia, serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(BUILDING_ICON[site.b], 15, 16);
      }, 0.36);
      tag.position.y = 1.05; tag.userData.title = BUILDINGS[site.b].n; g.add(tag);
      add(g);
    }
    // ways as raised ribbons along the fields
    const way = (from: HexKey, path: HexKey[], color: THREE.Color | number, radius: number, opacity = 1) => {
      const ptsW = [from, ...path].map((k) => { const [x, z] = toW(...hexCenter(k)); return new THREE.Vector3(x, hexHeight(k) + 0.35, z); });
      if (ptsW.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(ptsW, false, 'centripetal', 0.3);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, transparent: opacity < 1, opacity });
      add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, ptsW.length * 8), radius, 8), mat));
      const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, radius * 5.5, 10), mat);
      head.position.copy(ptsW[ptsW.length - 1]);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
      add(head);
    };
    for (const o of v.orders) {
      if (o.kind === 'move') { const a = v.c.armies.find((x) => x.id === o.army); if (a) way(a.hex, o.path, new THREE.Color(HOUSES[a.house].color), 0.07); }
      if (o.kind === 'agent') { const g = v.c.agents.find((x) => x.id === o.agent); if (g) way(g.hex, o.path, new THREE.Color(HOUSES[g.house].color), 0.04, 0.75); }
      if (o.kind === 'support') { const a = v.c.armies.find((x) => x.id === o.army); if (a) way(a.hex, [o.target], new THREE.Color(HOUSES[a.house].color), 0.035, 0.6); }
    }
    if (v.plan && v.plan.path.length) way(v.plan.from, v.plan.path, 0xf3d27a, 0.08);
    // signs on fields
    for (const [k, l] of Object.entries(v.labels ?? {})) {
      if (!l.text) continue;
      const [x, z] = toW(...hexCenter(k));
      const sp = textSprite(l.text, { font: '700 12px Figtree, sans-serif', fill: '#FFF8EC', bg: TONE[l.tone], pad: 8 }, 0.5);
      sp.position.set(x, hexHeight(k) + 1.55, z); sp.renderOrder = 5; add(sp);
    }
    // battle markers between the two sides
    for (const b of v.c.battles) {
      const [x1, z1] = toW(...hexCenter(b.from)), [x2, z2] = toW(...hexCenter(b.hex));
      const sw = canvasSprite(30, 30, (g) => {
        g.fillStyle = '#1E1A15'; g.strokeStyle = '#E2C27F'; g.lineWidth = 2; g.beginPath(); g.arc(15, 15, 12, 0, Math.PI * 2); g.fill(); g.stroke();
        g.strokeStyle = '#F1E3BE'; g.lineCap = 'round'; g.beginPath(); g.moveTo(9, 9); g.lineTo(21, 21); g.moveTo(21, 9); g.lineTo(9, 21); g.stroke();
      }, 0.5);
      sw.position.set((x1 + x2) / 2, Math.max(hexHeight(b.from), hexHeight(b.hex)) + 1.4, (z1 + z2) / 2); add(sw);
    }
  }

  private unitPos(id: string, hex: HexKey, v: MapView, dx = 0, dz = 0, lift = 0.75): THREE.Vector3 {
    const o = v.posOverride?.[id];
    const [x, z] = toW(...(o ?? hexCenter(hex)));
    return new THREE.Vector3(x + dx, (o ? 0.55 : hexHeight(hex)) + lift, z + dz);
  }

  private updateUnits(v: MapView) {
    const marks: Record<string, string> = {};
    for (const o of v.orders) if (o.kind === 'move' || o.kind === 'support' || o.kind === 'forage') marks[o.army] = o.kind;
    const seen = new Set<string>();
    const place = (id: string, key: string, to: THREE.Vector3, build: (g: THREE.Group) => THREE.Object3D | void) => {
      seen.add(id);
      let e = this.units.get(id);
      if (!e) { const obj = new THREE.Group(); obj.position.copy(to); this.armyGroup.add(obj); e = { obj, to, key: '', moving: false }; this.units.set(id, e); }
      e.to = to;
      e.moving = !!v.moving?.has(id);
      if (e.key !== key) {
        e.key = key;
        for (const ch of [...e.obj.children]) { e.obj.remove(ch); ch.traverse((x) => { const m = x as THREE.Sprite; if (!x.userData.keepMap) m.material?.map?.dispose(); m.material?.dispose?.(); }); }
        e.body = build(e.obj) ?? undefined;
      }
    };
    for (const a of v.c.armies) {
      const spec = a.spec.CAP + a.spec.KAP + a.spec.KAN + a.spec.MAR;
      const sprite = spriteName.army(a.house, !!v.moving?.has(a.id));
      if (hasSprite(sprite)) {
        place(a.id, ['P', sprite, a.size, spec, marks[a.id] ?? '', v.selectedUnit === a.id].join('|'), this.unitPos(a.id, a.hex, v, CITY_HEX[a.hex] ? 0.22 : 0, CITY_HEX[a.hex] ? 0.42 : 0, 0.02), (g) => {
          const body = this.painted(sprite, 1.5); body.userData.army = a.id; body.renderOrder = 4; g.add(body);
          if (v.selectedUnit === a.id) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 30), new THREE.MeshBasicMaterial({ color: 0xe2c27f })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.03; g.add(ring); }
          const badge = canvasSprite(56, 26, (cx) => {
            cx.fillStyle = HOUSES[a.house].color; cx.strokeStyle = '#F1E8D2'; cx.lineWidth = 2; rr(cx, 4, 4, 34, 18, 9); cx.fill(); cx.stroke();
            cx.fillStyle = '#FFF8F2'; cx.font = '800 13px Figtree, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(String(a.size), 21, 14);
            if (spec) { cx.fillStyle = '#E2C27F'; cx.beginPath(); cx.arc(46, 13, 8, 0, Math.PI * 2); cx.fill(); cx.fillStyle = '#1E1A15'; cx.font = '700 10px Figtree, sans-serif'; cx.fillText(String(spec), 46, 14); }
          }, 0.44);
          badge.position.y = 1.7; badge.userData.army = a.id; badge.renderOrder = 5; g.add(badge);
          g.userData.army = a.id;
          return body;
        });
        continue;
      }
      place(a.id, ['A', a.house, a.size, spec, marks[a.id] ?? '', v.selectedUnit === a.id].join('|'), this.unitPos(a.id, a.hex, v), (g) => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), new THREE.MeshStandardMaterial({ color: 0x3b2a1a }));
        pole.position.y = -0.38; pole.castShadow = true; g.add(pole);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.06, 12), new THREE.MeshStandardMaterial({ color: new THREE.Color(HOUSES[a.house].color) }));
        base.position.y = -0.74; base.castShadow = true; g.add(base);
        const f = flagSprite(a.house, a.size, spec, marks[a.id], v.selectedUnit === a.id);
        f.userData.army = a.id; f.renderOrder = 4; g.add(f);
        g.userData.army = a.id;
        return f;
      });
    }
    for (const ag of v.c.agents) {
      const painted = hasSprite(spriteName.agent(ag.spec));
      place(ag.id, ['G', ag.house, ag.spec, v.selectedUnit === ag.id, painted].join('|'), this.unitPos(ag.id, ag.hex, v, 0.45, 0.4, painted ? 0.02 : 0.35), (g) => {
        if (painted) {
          const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.04, 16), new THREE.MeshStandardMaterial({ color: new THREE.Color(HOUSES[ag.house].color) }));
          base.position.y = 0.02; g.add(base);
          const sp = this.painted(spriteName.agent(ag.spec), 0.82); sp.userData.agent = ag.id; sp.renderOrder = 4; g.add(sp);
          g.userData.agent = ag.id;
          return sp;
        }
        const sp = agentSprite(ag.house, ag.spec, v.selectedUnit === ag.id);
        sp.userData.agent = ag.id; sp.renderOrder = 4; g.add(sp);
        g.userData.agent = ag.id;
        return sp;
      });
    }
    for (const t of v.c.traders) {
      const wagon = hasSprite(spriteName.wagon());
      place(t.id, ['T', t.house, t.gold, wagon].join('|'), this.unitPos(t.id, t.hex, v, -0.45, 0.45, wagon ? 0.02 : 0.3), (g) => {
        if (wagon) {
          const sp = this.painted(spriteName.wagon(), 0.72); sp.renderOrder = 3; g.add(sp);
          const tag = traderSprite(t.house, t.gold); tag.position.y = 0.7; tag.scale.multiplyScalar(0.7); g.add(tag);
          return sp;
        }
        const sp = traderSprite(t.house, t.gold); sp.renderOrder = 3; g.add(sp);
        return sp;
      });
    }
    for (const [id, e] of this.units) if (!seen.has(id)) { this.armyGroup.remove(e.obj); this.units.delete(id); }
  }

  private hit(e: PointerEvent): { hex?: HexKey; army?: string; agent?: string } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hits = this.ray.intersectObjects([this.armyGroup, ...this.cols.map((c) => c.mesh)], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.army && !o.userData.agent && !o.userData.hex) o = o.parent;
      if (o?.userData.army) return { army: o.userData.army };
      if (o?.userData.agent) return { agent: o.userData.agent };
      if (o?.userData.hex) return { hex: o.userData.hex };
    }
    return null;
  }
  private noMenu = (e: Event) => e.preventDefault();
  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, moved: false, button: e.button }; this.renderer.domElement.setPointerCapture(e.pointerId); };
  private onMove = (e: PointerEvent) => {
    const d = this.down;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) {
        const o = this.orbit;
        if (d.button === 2 || e.shiftKey) {
          // pan along the ground
          const k = o.rad * 0.0016, c = Math.cos(o.theta), s = Math.sin(o.theta);
          o.tLook.x -= (dx * c + dy * s) * k; o.tLook.z -= (-dx * s + dy * c) * k;
          o.tLook.x = Math.max(-12, Math.min(12, o.tLook.x)); o.tLook.z = Math.max(-11, Math.min(11, o.tLook.z));
        } else {
          o.tTheta -= dx * 0.006; o.tPhi = Math.max(0.12, Math.min(1.25, o.tPhi - dy * 0.005));
        }
        d.x = e.clientX; d.y = e.clientY;
      }
      return;
    }
    const h = this.hit(e);
    this.renderer.domElement.style.cursor = h ? 'pointer' : '';
  };
  private onUp = (e: PointerEvent) => {
    const wasClick = this.down && !this.down.moved && this.down.button === 0;
    this.down = null;
    if (!wasClick) return;
    const h = this.hit(e);
    if (h?.army) this.handlers.onArmy(h.army);
    else if (h?.agent) this.handlers.onAgent(h.agent);
    else if (h?.hex) this.handlers.onHex(h.hex);
  };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.orbit.tRad = Math.max(7, Math.min(36, this.orbit.tRad + e.deltaY * 0.012)); };

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handlers.onCamera?.();
  }

  private loop = (now: number) => {
    const o = this.orbit;
    const before = o.theta + o.phi + o.rad + o.look.x + o.look.z + o.look.y;
    const ease = (v: number, t: number) => (Math.abs(t - v) < 1e-3 ? t : v + (t - v) * 0.08);
    o.theta = ease(o.theta, o.tTheta); o.phi = ease(o.phi, o.tPhi); o.rad = ease(o.rad, o.tRad);
    if (o.look.distanceTo(o.tLook) < 1e-3) o.look.copy(o.tLook); else o.look.lerp(o.tLook, 0.08);
    this.camera.position.set(o.look.x + o.rad * Math.sin(o.phi) * Math.sin(o.theta), o.look.y + o.rad * Math.cos(o.phi), o.look.z + o.rad * Math.sin(o.phi) * Math.cos(o.theta));
    this.camera.lookAt(o.look);
    const moved = Math.abs(o.theta + o.phi + o.rad + o.look.x + o.look.z + o.look.y - before) > 1e-4;
    // armies glide to their places
    for (const e of this.units.values()) {
      e.obj.position.lerp(e.to, 0.1);
      // marching: bob and sway while walking; at rest a slow breathing
      if (e.body) {
        const ph = now / 1000;
        const walking = e.moving || e.obj.position.distanceTo(e.to) > 0.04;
        e.body.position.y = walking ? Math.abs(Math.sin(ph * 11)) * 0.07 : Math.sin(ph * 1.8) * 0.008;
        (e.body as THREE.Sprite).material.rotation = walking ? Math.sin(ph * 11) * 0.05 : 0;
      }
    }
    // the sea drifts, the focus outline pulses
    const t = (now - this.t0) / 1000;
    const map = (this.sea.material as THREE.MeshStandardMaterial).map!;
    map.offset.set(t * 0.004, t * 0.002);
    this.dyn.children.forEach((c) => {
      if (!c.userData.pulse) return;
      const op = 0.75 + 0.25 * Math.sin(t * 4);
      c.traverse((x) => { const m = (x as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m) m.opacity = op; });
    });
    this.renderer.render(this.scene, this.camera);
    if (moved) this.handlers.onCamera?.();
    this.raf = requestAnimationFrame(this.loop);
  };
}
