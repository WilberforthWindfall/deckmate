import * as THREE from 'three';

// Campaign battles: the board takes on the look of the landscape the battle is fought in (only optics, no rules).
// Board squares are cut from the campaign hex tile, dark squares darkened; light, fog and a few props around the
// board set the mood. Outside the campaign the table stays the ship deck.

export type Props = 'reeds' | 'trees' | 'rocks' | 'mounds' | 'sheaves' | 'water' | 'ford';
export interface LandLook {
  tile: string;
  bg: number; fogNear: number; fogFar: number;
  sky: number; ground: number; hemi: number; sun: number; sunI: number;
  /** Veil over the light / dark squares, so pieces stay readable on a busy texture. */
  light: string; dark: string;
  props: Props;
}

export const LOOKS: Record<string, LandLook> = {
  A: { tile: 'acker', bg: 0x231b0f, fogNear: 18, fogFar: 36, sky: 0xffe7b8, ground: 0x2a1c08, hemi: 0.6, sun: 0xffe2a8, sunI: 1.25, light: 'rgba(250,232,190,0.42)', dark: 'rgba(40,22,6,0.55)', props: 'sheaves' },
  W: { tile: 'wald', bg: 0x0c1a10, fogNear: 14, fogFar: 32, sky: 0xcfe8c4, ground: 0x0c1408, hemi: 0.5, sun: 0xf3f0c8, sunI: 1.05, light: 'rgba(225,240,200,0.42)', dark: 'rgba(4,14,4,0.55)', props: 'trees' },
  S: { tile: 'sumpf', bg: 0x1a231c, fogNear: 7, fogFar: 22, sky: 0xc9d8c0, ground: 0x10140a, hemi: 0.5, sun: 0xd8e0b8, sunI: 0.85, light: 'rgba(214,224,184,0.45)', dark: 'rgba(10,18,10,0.58)', props: 'reeds' },
  G: { tile: 'gebirge', bg: 0x161b24, fogNear: 16, fogFar: 34, sky: 0xdfe8ff, ground: 0x15161a, hemi: 0.5, sun: 0xf2f6ff, sunI: 1.05, light: 'rgba(150,140,128,0.2)', dark: 'rgba(14,16,22,0.62)', props: 'rocks' },
  F: { tile: 'fluss', bg: 0x0f1c1d, fogNear: 14, fogFar: 32, sky: 0xd4ecf0, ground: 0x0c1408, hemi: 0.55, sun: 0xfff1d6, sunI: 1.1, light: 'rgba(228,240,206,0.42)', dark: 'rgba(6,16,10,0.55)', props: 'ford' },
  K: { tile: 'kueste', bg: 0x0f2130, fogNear: 18, fogFar: 38, sky: 0xd8ecff, ground: 0x2a2010, hemi: 0.62, sun: 0xfff4dc, sunI: 1.25, light: 'rgba(250,240,214,0.4)', dark: 'rgba(40,30,12,0.55)', props: 'water' },
  H: { tile: 'huegel', bg: 0x221a0e, fogNear: 16, fogFar: 34, sky: 0xffeac0, ground: 0x241a08, hemi: 0.58, sun: 0xffe4b0, sunI: 1.2, light: 'rgba(250,236,196,0.42)', dark: 'rgba(36,24,6,0.55)', props: 'mounds' },
};

const cache: Record<string, Promise<HTMLImageElement>> = {};
function loadImage(src: string) {
  return (cache[src] ??= new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }));
}

function seeded(seed: number) { let x = seed; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; }

/** 1024² canvas with the whole board: landscape, ford or puddles, then the chequer veil. */
export async function boardTexture(land: string): Promise<THREE.CanvasTexture> {
  const look = LOOKS[land];
  const img = await loadImage(`/tiles/${look.tile}.jpg`);
  const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
  const g = cv.getContext('2d')!;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.drawImage(img, x * 512, y * 512, 512, 512);
  const rnd = seeded(land.charCodeAt(0) * 31);
  if (look.props === 'reeds') {
    // morass: dark brackish puddles with a pale rim
    for (let i = 0; i < 16; i++) {
      const x = rnd() * 1024, y = rnd() * 1024, rx = 30 + rnd() * 70, ry = rx * (0.45 + rnd() * 0.3);
      g.fillStyle = 'rgba(28,44,36,0.7)'; g.beginPath(); g.ellipse(x, y, rx, ry, rnd() * Math.PI, 0, 2 * Math.PI); g.fill();
      g.strokeStyle = 'rgba(190,210,190,0.25)'; g.lineWidth = 3; g.stroke();
    }
  }
  if (look.props === 'ford') {
    // the ford runs across the middle of the board (ranks 4 and 5)
    const y0 = 3 * 128, y1 = 5 * 128;
    const grd = g.createLinearGradient(0, y0 - 20, 0, y1 + 20);
    grd.addColorStop(0, 'rgba(60,110,130,0)'); grd.addColorStop(0.12, 'rgba(60,110,130,0.62)');
    grd.addColorStop(0.88, 'rgba(60,110,130,0.62)'); grd.addColorStop(1, 'rgba(60,110,130,0)');
    g.fillStyle = grd; g.fillRect(0, y0 - 20, 1024, y1 - y0 + 40);
    g.strokeStyle = 'rgba(220,240,250,0.35)'; g.lineWidth = 2;
    for (let i = 0; i < 28; i++) {
      const x = rnd() * 1024, y = y0 + 10 + rnd() * (y1 - y0 - 20), w = 30 + rnd() * 60;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 6, x + w, y); g.stroke();
    }
    for (let i = 0; i < 22; i++) {
      const x = rnd() * 1024, y = y0 + rnd() * (y1 - y0), r = 8 + rnd() * 14;
      g.fillStyle = 'rgba(150,150,140,0.8)'; g.beginPath(); g.ellipse(x, y, r, r * 0.7, rnd(), 0, 2 * Math.PI); g.fill();
    }
  }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    g.fillStyle = (r + c) % 2 ? look.dark : look.light;
    g.fillRect(c * 128, r * 128, 128, 128);
  }
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 2;
  for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 1024); g.moveTo(0, i * 128); g.lineTo(1024, i * 128); g.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export async function groundTexture(land: string): Promise<THREE.CanvasTexture> {
  const img = await loadImage(`/tiles/${LOOKS[land].tile}.jpg`);
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  cv.getContext('2d')!.drawImage(img, 0, 0, 512, 512);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
  return t;
}

const TOP = -0.38; // surface of the round table

/** Props on the table around the board, away from the board and the card slots. */
export function props(land: string): THREE.Group {
  const look = LOOKS[land];
  const grp = new THREE.Group();
  const rnd = seeded(land.charCodeAt(0) * 17 + 3);
  const spots = (n: number, rMin = 5.4, rMax = 9.3) => {
    const out: [number, number][] = [];
    for (let k = 0; out.length < n && k < n * 20; k++) {
      const a = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 5 && Math.abs(z) < 5) continue; // board
      if (Math.abs(x) < 3.3 && Math.abs(z) > 4.3 && Math.abs(z) < 6.8) continue; // card slots
      out.push([x, z]);
    }
    return out;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; grp.add(m); return m;
  };
  const std = (color: number, roughness = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const water = std(0x2b4d52, 0.12, { metalness: 0.25, transparent: true, opacity: 0.88 });

  if (look.props === 'reeds' || look.props === 'ford') {
    const reed = std(0x7a7432), head = std(0x4a3420);
    for (const [x, z] of spots(look.props === 'reeds' ? 26 : 12)) {
      const n = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const h = 0.5 + rnd() * 0.8, dx = (rnd() - 0.5) * 0.5, dz = (rnd() - 0.5) * 0.5;
        const s = mesh(new THREE.CylinderGeometry(0.015, 0.025, h, 5), reed, x + dx, TOP + h / 2, z + dz);
        s.rotation.set((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3);
        if (rnd() < 0.5) mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 8), head, x + dx, TOP + h, z + dz);
      }
    }
  }
  if (look.props === 'reeds') {
    for (const [x, z] of spots(9, 5.2, 9.5)) {
      const r = 0.4 + rnd() * 0.9;
      const p = mesh(new THREE.CircleGeometry(r, 28), water, x, TOP + 0.005, z);
      p.rotation.x = -Math.PI / 2; p.scale.y = 0.6 + rnd() * 0.4; p.castShadow = false;
    }
  }
  if (look.props === 'ford') {
    // the river continues beside the board
    for (const sx of [-1, 1]) {
      const s = mesh(new THREE.PlaneGeometry(5, 2.2), water, sx * 7.2, TOP + 0.005, 0);
      s.rotation.x = -Math.PI / 2; s.castShadow = false;
    }
  }
  if (look.props === 'trees') {
    const leaf = std(0x1f3a1c), leaf2 = std(0x2c4a22), bark = std(0x3a2616);
    for (const [x, z] of spots(22, 5.6, 9.6)) {
      const h = 1.1 + rnd() * 1.1;
      mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 6), bark, x, TOP + 0.2, z);
      mesh(new THREE.ConeGeometry(0.45 + rnd() * 0.2, h, 8), rnd() < 0.5 ? leaf : leaf2, x, TOP + 0.35 + h / 2, z);
    }
  }
  if (look.props === 'rocks') {
    const rock = std(0x4d4944, 0.95, { flatShading: true }), snow = std(0xdfe4ea, 0.7, { flatShading: true });
    for (const [x, z] of spots(18, 5.5, 9.6)) {
      const s = 0.2 + rnd() * 0.45;
      const m = mesh(new THREE.DodecahedronGeometry(s, 0), rock, x, TOP + s * 0.5, z);
      m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); m.scale.y = 0.7 + rnd() * 0.6;
      if (s > 0.48) mesh(new THREE.DodecahedronGeometry(s * 0.45, 0), snow, x, TOP + s * 1.05, z).rotation.set(rnd(), rnd(), rnd());
    }
  }
  if (look.props === 'mounds') {
    const grass = std(0x7d6a2c), vine = std(0x40501e);
    for (const [x, z] of spots(10, 6, 9.6)) {
      const r = 0.7 + rnd() * 0.8;
      const m = mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), grass, x, TOP, z);
      m.scale.y = 0.35 + rnd() * 0.2;
      if (rnd() < 0.5) for (let i = 0; i < 3; i++) mesh(new THREE.BoxGeometry(0.06, 0.2, r * 1.1), vine, x + (i - 1) * 0.25, TOP + r * 0.32, z);
    }
  }
  if (look.props === 'sheaves') {
    const hay = std(0xc9a24a), band = std(0x7a5a24);
    for (const [x, z] of spots(14, 5.6, 9.4)) {
      const b = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 18), hay, x, TOP + 0.32, z);
      b.rotation.set(0, rnd() * 3, Math.PI / 2);
      const t = mesh(new THREE.TorusGeometry(0.325, 0.02, 6, 20), band, x, TOP + 0.32, z);
      t.rotation.copy(b.rotation); t.rotateX(Math.PI / 2);
    }
  }
  if (look.props === 'water') {
    // the sea on the officers' side, a few rocks in the surf
    const sea = std(0x24536b, 0.1, { metalness: 0.3, transparent: true, opacity: 0.92 });
    const s = mesh(new THREE.RingGeometry(7, 9.95, 64, 1, Math.PI * 0.06, Math.PI * 0.88), sea, 0, TOP + 0.004, 0);
    s.rotation.x = -Math.PI / 2; s.castShadow = false;
    const rock = std(0x5c5a55, 0.95);
    for (const [x, z] of spots(8, 6, 9.4)) {
      if (z > -1) continue;
      const r = 0.2 + rnd() * 0.4;
      mesh(new THREE.DodecahedronGeometry(r, 0), rock, x, TOP + r * 0.4, z).rotation.set(rnd() * 3, rnd() * 3, 0);
    }
  }
  return grp;
}
