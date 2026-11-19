import * as THREE from 'three';
import { LOOKS, boardTexture, groundTexture, props } from './landTable.ts';
import { CARDS, COINS, rc, type CardKey, type GameState, type Move, type Piece, type Side, type Square, type PieceType } from '../game/rules.ts';

export interface TableHandlers {
  onSquare: (i: number) => void;
  onCard: (side: Side, index: number) => void;
}
export interface TableView {
  state: GameState;
  selected: number | null;
  moves: Move[];
  shieldPick: boolean;
  /** Extra squares to highlight as clickable (e.g. pieces to take off during deployment). */
  pickable?: number[];
  selectedCard: { side: Side; index: number } | null;
}

const pos = (i: number) => { const [r, c] = rc(i); return new THREE.Vector3(c - 3.5, 0.05, r - 3.5); };

function woodTex(base: string, grain: string, seed: number) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  let x = seed;
  for (let i = 0; i < 40; i++) {
    x = (x * 9301 + 49297) % 233280;
    const y = (x / 233280) * 128;
    g.strokeStyle = grain; g.globalAlpha = 0.08 + ((x % 7) / 7) * 0.12; g.lineWidth = 1 + (x % 3);
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(40, y + 4, 88, y - 4, 128, y + 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  let line = '';
  for (const w of text.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t;
  }
  if (line) g.fillText(line, x, y);
}

function cardTexture(key: CardKey, side: Side) {
  const C = CARDS[key];
  const cv = document.createElement('canvas'); cv.width = 360; cv.height = 520;
  const g = cv.getContext('2d')!;
  const edge = side === 'M' ? '#C8552F' : '#1F3D66';
  g.fillStyle = '#EDE3CC'; g.fillRect(0, 0, 360, 520);
  g.strokeStyle = edge; g.lineWidth = 16; g.strokeRect(8, 8, 344, 504);
  g.strokeStyle = '#A8874A'; g.lineWidth = 2; g.strokeRect(26, 26, 308, 468);
  g.fillStyle = edge; g.font = '600 15px Figtree, sans-serif'; g.textAlign = 'center';
  g.fillText(side === 'M' ? 'MANNSCHAFT' : 'OFFIZIERE', 180, 56);
  g.beginPath(); g.arc(180, 140, 58, 0, Math.PI * 2); g.fillStyle = edge; g.fill();
  g.strokeStyle = '#CDA641'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#F4ECD8'; g.font = '64px Georgia, serif'; g.textBaseline = 'middle'; g.fillText(C.sym + '︎', 180, 144);
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#2A1D10'; g.font = '600 32px "Spectral SC", Georgia, serif'; wrap(g, C.t, 180, 248, 300, 36);
  g.strokeStyle = '#A8874A'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(90, 282); g.lineTo(270, 282); g.stroke();
  g.fillStyle = '#3A2C1C'; g.font = '500 21px Figtree, sans-serif'; wrap(g, C.e, 180, 322, 290, 28);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function label(txt: string) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#CDA641'; g.font = '600 40px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 32, 34);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

const MAT = {
  coral: new THREE.MeshStandardMaterial({ color: 0xc8552f, roughness: 0.45, metalness: 0.05 }),
  coralLight: new THREE.MeshStandardMaterial({ color: 0xf2b49a, roughness: 0.5 }),
  navy: new THREE.MeshStandardMaterial({ color: 0x1f3d66, roughness: 0.35, metalness: 0.15 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xcda641, roughness: 0.28, metalness: 0.85 }),
  ebony: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.3, metalness: 0.1 }),
  ivory: new THREE.MeshStandardMaterial({ color: 0xf1eadb, roughness: 0.35 }),
  shield: new THREE.MeshStandardMaterial({ color: 0xcda641, emissive: 0x8a6a10, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.85 }),
  // Kaplane blue, Marines yellow (testers 19.11.2026); the other officers stay navy.
  chaplain: new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.35, metalness: 0.12 }),
  marine: new THREE.MeshStandardMaterial({ color: 0xe8c22a, roughness: 0.4, metalness: 0.1 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xf2c544, emissive: 0x5a3d00, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.45, side: THREE.DoubleSide }),
  // Ugur: pitch black with a glowing ember trim, so he cannot be mistaken for a promoted black tower.
  demon: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.45, metalness: 0.2 }),
  ember: new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0xd8261a, emissiveIntensity: 1.1, roughness: 0.4 }),
  silver: new THREE.MeshStandardMaterial({ color: 0xd7dce4, emissive: 0x30343a, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.55 }),
  silverDark: new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.3, metalness: 0.5 }),
};
const COIN_MAT = {
  gold: new THREE.MeshStandardMaterial({ color: 0xf2c544, emissive: 0x4a3200, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.5 }),
  silber: new THREE.MeshStandardMaterial({ color: 0xe6e9ef, emissive: 0x2a2d33, emissiveIntensity: 0.5, roughness: 0.25, metalness: 0.5 }),
  kupfer: new THREE.MeshStandardMaterial({ color: 0xc8703f, emissive: 0x3a1608, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.5 }),
};
const MARK = {
  sel: new THREE.MeshBasicMaterial({ color: 0xcda641, transparent: true, opacity: 0.55 }),
  dot: new THREE.MeshBasicMaterial({ color: 0x5daae4, transparent: true, opacity: 0.85 }),
  hit: new THREE.MeshBasicMaterial({ color: 0xe5574d }),
  path: new THREE.MeshBasicMaterial({ color: 0xcda641, transparent: true, opacity: 0.45 }),
  cap: new THREE.MeshBasicMaterial({ color: 0xe5574d, transparent: true, opacity: 0.4 }),
  pick: new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.9 }),
  // Last move of the other side: clearly visible (testers 19.11.2026): strong fill on the target, frame on both squares.
  last: new THREE.MeshBasicMaterial({ color: 0x3fb6ff, transparent: true, opacity: 0.5 }),
  lastFrom: new THREE.MeshBasicMaterial({ color: 0x3fb6ff, transparent: true, opacity: 0.28 }),
  lastEdge: new THREE.MeshBasicMaterial({ color: 0x8fd8ff }),
};

function add(geo: THREE.BufferGeometry, mat: THREE.Material, y: number, parent: THREE.Object3D, x = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function body(g: THREE.Group, mat: THREE.Material, h: number, topR: number) {
  add(new THREE.CylinderGeometry(0.36, 0.38, 0.1, 40), mat, 0.05, g);
  add(new THREE.TorusGeometry(0.32, 0.035, 10, 40), MAT.brass, 0.11, g).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(topR, 0.3, h, 40), mat, 0.1 + h / 2, g);
  return 0.1 + h;
}

/** Golden pennant on a short staff (the Captain, instead of the old cross). */
function pennant(g: THREE.Object3D, y: number, acc: THREE.Material) {
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.46, 12), acc, y + 0.23, g);
  add(new THREE.SphereGeometry(0.04, 12, 8), acc, y + 0.48, g);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(0.34, -0.07); shape.lineTo(0, -0.17); shape.lineTo(0, 0);
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(shape), MAT.gold);
  flag.position.set(0.02, y + 0.45, 0); flag.castShadow = true;
  g.add(flag);
}

/** Bicorne worn crosswise (the First Lieutenant): a crescent from shoulder to shoulder with pointed tips and a cockade. */
function bicorne(g: THREE.Object3D, y: number, mat: THREE.Material, acc: THREE.Material) {
  const w = 0.36, h = 0.27;
  const sh = new THREE.Shape();
  sh.moveTo(-w, 0);
  sh.quadraticCurveTo(-w * 0.55, h * 1.05, 0, h);
  sh.quadraticCurveTo(w * 0.55, h * 1.05, w, 0);
  sh.quadraticCurveTo(0, 0.07, -w, 0);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3, curveSegments: 24 });
  geo.translate(0, 0, -0.065);
  const hat = new THREE.Mesh(geo, mat); hat.position.y = y; hat.castShadow = true; g.add(hat);
  // Brass edge along the top and a cockade at the front.
  const edge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-w * 0.95, 0.02, 0), new THREE.Vector3(0, h * 1.32, 0), new THREE.Vector3(w * 0.95, 0.02, 0)), 24, 0.016, 8), acc);
  edge.position.set(0, y, 0.09); g.add(edge);
  const edge2 = edge.clone(); edge2.position.z = -0.09; g.add(edge2);
  add(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 20), acc, y + 0.12, g, 0, 0.11).rotation.x = Math.PI / 2;
}

/** Short heavy mortar on a block, barrel pointing steeply up (the former Carronade). */
function mortar(g: THREE.Object3D, mat: THREE.Material, acc: THREE.Material) {
  add(new THREE.CylinderGeometry(0.36, 0.38, 0.1, 40), mat, 0.05, g);
  add(new THREE.TorusGeometry(0.32, 0.035, 10, 40), acc, 0.11, g).rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.5, 0.18, 0.44), mat, 0.2, g);
  add(new THREE.BoxGeometry(0.08, 0.2, 0.3), acc, 0.36, g, 0.21, 0);
  add(new THREE.BoxGeometry(0.08, 0.2, 0.3), acc, 0.36, g, -0.21, 0);
  const tube = new THREE.Group(); tube.position.set(0, 0.42, 0); tube.rotation.x = -0.55; g.add(tube);
  add(new THREE.SphereGeometry(0.17, 24, 16), mat, 0, tube);
  add(new THREE.CylinderGeometry(0.17, 0.15, 0.32, 28, 1, true), mat, 0.16, tube);
  add(new THREE.TorusGeometry(0.17, 0.03, 10, 28), acc, 0.32, tube).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 24), MAT.ebony, 0.31, tube);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), acc, 0, tube).rotation.z = Math.PI / 2;
}

function steward(g: THREE.Group, coins: string[]) {
  add(new THREE.CylinderGeometry(0.38, 0.4, 0.18, 48), MAT.silver, 0.09, g);
  add(new THREE.TorusGeometry(0.2, 0.03, 10, 40), MAT.silverDark, 0.185, g).rotation.x = Math.PI / 2;
  add(new THREE.TorusGeometry(0.385, 0.02, 8, 48), MAT.silverDark, 0.12, g).rotation.x = Math.PI / 2;
  // Coins stacked loosely on top, each in its metal and size.
  coins.forEach((c, i) => {
    const k = COINS[c as keyof typeof COINS] ?? COINS.penny;
    const r = 0.1 + 0.07 * k.size;
    const a = i * 2.4, off = i === 0 ? 0 : 0.06 + (i % 3) * 0.03;
    const m = add(new THREE.CylinderGeometry(r, r, 0.022, 28), COIN_MAT[k.metal], 0.2 + i * 0.024, g, Math.cos(a) * off, Math.sin(a) * off);
    m.rotation.z = (i % 2 ? 1 : -1) * 0.04;
  });
}

function makePiece(p: Piece) {
  const g = new THREE.Group();
  const t = p.t;
  if (t === 'STW') {
    steward(g, p.coins ?? []);
  } else if (t === 'stone') {
    add(new THREE.CylinderGeometry(0.38, 0.4, 0.18, 48), MAT.coral, 0.09, g);
    add(new THREE.TorusGeometry(0.2, 0.03, 10, 40), MAT.coralLight, 0.185, g).rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(0.385, 0.02, 8, 48), MAT.coralLight, 0.12, g).rotation.x = Math.PI / 2;
  } else {
    const promoted = t === 'PT' || t === 'PL';
    const demon = !!p.ugur;
    const mat = demon ? MAT.demon : t === 'PT' ? MAT.ebony : t === 'PL' ? MAT.ivory : t === 'KAP' ? MAT.chaplain : t === 'MAR' ? MAT.marine : MAT.navy;
    const acc = demon ? MAT.ember : t === 'PT' ? MAT.ivory : t === 'PL' ? MAT.ebony : MAT.brass;
    const kind = t === 'PT' ? 'KAN' : t === 'PL' ? 'KAP' : t;
    if (kind === 'INF') { const y = body(g, mat, 0.32, 0.14); add(new THREE.TorusGeometry(0.15, 0.03, 10, 32), acc, y, g).rotation.x = Math.PI / 2; add(new THREE.SphereGeometry(0.17, 32, 20), mat, y + 0.13, g); }
    if (kind === 'KAN' && !promoted) mortar(g, mat, acc);
    if (kind === 'KAN' && promoted) {
      const y = body(g, mat, 0.5, 0.22);
      add(new THREE.CylinderGeometry(0.27, 0.25, 0.14, 32), mat, y + 0.07, g);
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; add(new THREE.BoxGeometry(0.11, 0.12, 0.11), acc, y + 0.2, g, Math.cos(a) * 0.19, Math.sin(a) * 0.19); }
    }
    if (kind === 'KAP') {
      const y = body(g, mat, 0.6, 0.14);
      add(new THREE.TorusGeometry(0.14, 0.03, 10, 32), acc, y, g).rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(0.17, 32, 20), mat, y + 0.16, g).scale.y = 1.25;
      add(new THREE.ConeGeometry(0.06, 0.14, 16), acc, y + 0.42, g);
      add(new THREE.BoxGeometry(0.03, 0.16, 0.02), acc, y + 0.18, g, 0, 0.165);
    }
    if (kind === 'MAR') {
      const y = body(g, mat, 0.4, 0.18);
      const head = new THREE.Group(); head.position.y = y; g.add(head);
      add(new THREE.BoxGeometry(0.24, 0.44, 0.3), mat, 0.2, head);
      add(new THREE.BoxGeometry(0.22, 0.2, 0.36), mat, 0.32, head, 0, 0.16).rotation.x = 0.35;
      add(new THREE.BoxGeometry(0.06, 0.3, 0.2), acc, 0.32, head, 0, -0.12);
      add(new THREE.SphereGeometry(0.035, 12, 8), acc, 0.38, head, 0.12, 0.1);
      add(new THREE.SphereGeometry(0.035, 12, 8), acc, 0.38, head, -0.12, 0.1);
    }
    if (kind === 'CAP') {
      // First Lieutenant (queen piece): head with a bicorne worn crosswise.
      const y = body(g, mat, 0.72, 0.16);
      add(new THREE.TorusGeometry(0.16, 0.035, 10, 32), acc, y, g).rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(0.19, 32, 20), mat, y + 0.14, g);
      bicorne(g, y + 0.2, mat, acc);
    }
    if (kind === 'FL') {
      // Captain (king piece): crown ring with a golden pennant instead of the cross.
      const y = body(g, mat, 0.82, 0.17);
      add(new THREE.TorusGeometry(0.17, 0.035, 10, 32), acc, y, g).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.22, 0.17, 0.2, 32), mat, y + 0.1, g);
      add(new THREE.TorusGeometry(0.21, 0.025, 8, 32), acc, y + 0.2, g).rotation.x = Math.PI / 2;
      pennant(g, y + 0.2, demon ? MAT.ember : MAT.gold);
    }
    if (promoted) add(new THREE.TorusGeometry(0.37, 0.03, 10, 40), acc, 0.05, g).rotation.x = Math.PI / 2;
    if (demon) { const ring = add(new THREE.TorusGeometry(0.42, 0.025, 8, 48), MAT.ember, 0.03, g); ring.rotation.x = Math.PI / 2; }
    if (p.s === 'O' || demon) g.rotation.y = Math.PI;
  }
  if (p.shielded) { const ring = add(new THREE.TorusGeometry(0.47, 0.035, 10, 48), MAT.shield, 0.3, g); ring.rotation.x = Math.PI / 2; ring.userData.spin = true; }
  return g;
}

function frameGeo() {
  const sh = new THREE.Shape();
  sh.moveTo(-0.48, -0.48); sh.lineTo(0.48, -0.48); sh.lineTo(0.48, 0.48); sh.lineTo(-0.48, 0.48); sh.lineTo(-0.48, -0.48);
  const hole = new THREE.Path();
  hole.moveTo(-0.41, -0.41); hole.lineTo(-0.41, 0.41); hole.lineTo(0.41, 0.41); hole.lineTo(0.41, -0.41); hole.lineTo(-0.41, -0.41);
  sh.holes.push(hole);
  return new THREE.ShapeGeometry(sh);
}

interface Tween { t0: number; dur: number; f: (k: number) => void; end?: () => void }

export class Table3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private tiles: THREE.Mesh[] = [];
  private pieceGroup = new THREE.Group();
  private markGroup = new THREE.Group();
  private cardGroup = new THREE.Group();
  private capturedGroup = new THREE.Group();
  private capturedKey = '';
  private meshes: (THREE.Group | null)[] = [];
  private cardMeshes: THREE.Mesh[] = [];
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private tweens: Tween[] = [];
  private view: TableView | null = null;
  private shownBoard: Square[] | null = null;
  private shownV = -1;
  private handKey = '';
  private hoverMove: Move | null = null;
  private hoverCard: THREE.Mesh | null = null;
  private busy = false;
  private down: { x: number; y: number; moved: boolean } | null = null;
  private orbit = { theta: 0, phi: 0.86, rad: 15, tTheta: 0, tPhi: 0.86, tRad: 15 };
  private raf = 0;
  private ro: ResizeObserver;
  private reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private land: string | undefined = undefined;
  private landReq = 0;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private tableTop!: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  private deckMap!: THREE.Texture;
  private landBoard: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null;
  private landProps: THREE.Group | null = null;

  constructor(private host: HTMLElement, private handlers: TableHandlers) {
    const mobile = matchMedia('(max-width: 860px)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    const s = this.scene;
    s.background = new THREE.Color(0x0d1620);
    s.fog = new THREE.Fog(0x0d1620, 20, 38);
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x1a1208, 0.55 * Math.PI);
    s.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.15 * Math.PI);
    this.sun = sun;
    sun.position.set(-5, 11, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
    sun.shadow.bias = -0.0005;
    s.add(sun);
    const lamp = new THREE.PointLight(0xffb36b, 0.5 * Math.PI, 20, 0); lamp.position.set(5, 4, -5); s.add(lamp);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.4, 9.4), new THREE.MeshStandardMaterial({ map: woodTex('#3b2416', '#1c0f07', 7), roughness: 0.75 }));
    frame.position.y = -0.17; frame.receiveShadow = true; frame.castShadow = true; s.add(frame);
    const table = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 0.2, 72), new THREE.MeshStandardMaterial({ map: woodTex('#1e2a36', '#0b1219', 5), roughness: 0.9 }));
    table.position.y = -0.48; table.receiveShadow = true; s.add(table);
    this.tableTop = table; this.deckMap = table.material.map!;
    const tileGeo = new THREE.BoxGeometry(1, 0.1, 1);
    // Light squares golden, dark squares wine red (testers 19.11.2026).
    const light = new THREE.MeshStandardMaterial({ map: woodTex('#d8b25a', '#9a7428', 3), roughness: 0.45, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ map: woodTex('#6a1626', '#2e0710', 11), roughness: 0.55 });
    for (let i = 0; i < 64; i++) {
      const [r, c] = rc(i);
      const m = new THREE.Mesh(tileGeo, (r + c) % 2 ? dark : light);
      m.position.set(c - 3.5, 0, r - 3.5); m.receiveShadow = true; m.userData.sq = i;
      s.add(m); this.tiles.push(m);
    }
    for (let c = 0; c < 8; c++) {
      const a = label('abcdefgh'[c]); a.position.set(c - 3.5, 0.04, 4.35); s.add(a);
      const b = label('abcdefgh'[c]); b.position.set(c - 3.5, 0.04, -4.35); b.rotation.z = Math.PI; s.add(b);
    }
    for (let r = 0; r < 8; r++) {
      const a = label(String(8 - r)); a.position.set(-4.35, 0.04, r - 3.5); s.add(a);
      const b = label(String(8 - r)); b.position.set(4.35, 0.04, r - 3.5); b.rotation.z = Math.PI; s.add(b);
    }
    s.add(this.pieceGroup, this.markGroup, this.cardGroup, this.capturedGroup);

    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
    document.fonts?.ready.then(() => { this.handKey = ''; if (this.view) this.renderCards(this.view.state); });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    this.renderer.dispose();
    el.remove();
  }

  /** Turn the camera to look from one side of the table. */
  face(side: Side) {
    const base = side === 'M' ? 0 : Math.PI;
    const o = this.orbit;
    o.tTheta = Math.round((o.theta - base) / (2 * Math.PI)) * 2 * Math.PI + base;
    if (o.tPhi < 0.3) o.tPhi = 0.86;
  }
  topDown() { this.orbit.tPhi = 0.05; }
  zoom(d: number) { this.orbit.tRad = Math.max(7, Math.min(24, this.orbit.tRad + d)); }

  /** Campaign battle landscape (A, W, S, G, F, K, H) or the ship deck (undefined). Only optics. */
  setLand(land: string | undefined) {
    if (land && !LOOKS[land]) land = undefined;
    if (land === this.land) return;
    this.land = land;
    const req = ++this.landReq;
    const s = this.scene;
    if (this.landBoard) { s.remove(this.landBoard); this.landBoard.material.map?.dispose(); this.landBoard = null; }
    if (this.landProps) { s.remove(this.landProps); this.landProps = null; }
    const m = this.tableTop.material;
    if (!land) {
      (s.background as THREE.Color).set(0x0d1620); (s.fog as THREE.Fog).color.set(0x0d1620);
      Object.assign(s.fog as THREE.Fog, { near: 20, far: 38 });
      this.hemi.color.set(0xcfe0ff); this.hemi.groundColor.set(0x1a1208); this.hemi.intensity = 0.55 * Math.PI;
      this.sun.color.set(0xfff1d6); this.sun.intensity = 1.15 * Math.PI;
      m.map = this.deckMap; m.color.set(0xffffff); m.needsUpdate = true;
      return;
    }
    const look = LOOKS[land];
    (s.background as THREE.Color).set(look.bg); (s.fog as THREE.Fog).color.set(look.bg);
    Object.assign(s.fog as THREE.Fog, { near: look.fogNear, far: look.fogFar });
    this.hemi.color.set(look.sky); this.hemi.groundColor.set(look.ground); this.hemi.intensity = look.hemi * Math.PI;
    this.sun.color.set(look.sun); this.sun.intensity = look.sunI * Math.PI;
    this.landProps = props(land); s.add(this.landProps);
    Promise.all([boardTexture(land), groundTexture(land)]).then(([board, ground]) => {
      if (req !== this.landReq) { board.dispose(); ground.dispose(); return; }
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: board, roughness: 0.85 }));
      plane.rotation.x = -Math.PI / 2; plane.position.y = 0.0505; plane.receiveShadow = true;
      this.landBoard = plane; s.add(plane);
      m.map = ground; m.color.set(0x8c8c8c); m.needsUpdate = true;
    }).catch(() => { /* tile missing: keep the wooden board */ });
  }

  update(view: TableView) {
    const prev = this.view;
    this.view = view;
    const st = view.state;
    const lm = st.lastMove;
    const animate = !this.reduce && prev && lm && this.shownBoard && st.v === this.shownV + 1 && this.shownBoard[lm.from]?.t === lm.t && this.meshes[lm.from];
    if (animate && !this.busy) {
      this.busy = true;
      this.hoverMove = null;
      this.markGroup.clear();
      this.animateMove(lm!, () => { this.busy = false; this.rebuild(this.view!.state); this.marks(); });
    } else if (!this.busy && (st.v !== this.shownV || !this.shownBoard)) {
      this.rebuild(st);
    } else if (!this.busy && JSON.stringify(st.board) !== JSON.stringify(this.shownBoard)) {
      this.rebuild(st);
    }
    this.renderCards(st);
    if (!this.busy) this.renderCaptured(st);
    if (!this.busy) this.marks();
  }

  /**
   * Captured pieces stand in rows beside the board (beta feedback #27): what the crew took on the right of the crew,
   * what the officers took on the left, each starting at its own side.
   */
  private renderCaptured(st: GameState) {
    const key = JSON.stringify(st.captured ?? {});
    if (key === this.capturedKey) return;
    this.capturedKey = key;
    this.capturedGroup.clear();
    const place = (list: PieceType[], x0: number, dir: 1 | -1, zStart: number, zDir: 1 | -1, owner: Side) => {
      list.forEach((t, i) => {
        const col = Math.floor(i / 12), row = i % 12;
        const g = makePiece({ t, s: owner });
        g.scale.setScalar(0.6);
        g.position.set(x0 + dir * col * 0.62, -0.38, zStart + zDir * row * 0.62);
        this.capturedGroup.add(g);
      });
    };
    // Officers lost by the officers = taken by the crew → right of the crew (x > 0), starting near the crew.
    place(st.captured?.O ?? [], 5.25, 1, 3.4, -1, 'O');
    // Crew lost = taken by the officers → left of the crew (x < 0), starting near the officers.
    place(st.captured?.M ?? [], -5.25, -1, -3.4, 1, 'M');
  }

  private rebuild(st: GameState) {
    this.pieceGroup.clear();
    this.meshes = Array(64).fill(null);
    st.board.forEach((p, i) => {
      if (!p) return;
      const g = makePiece(p);
      g.position.copy(pos(i));
      g.traverse((o) => { o.userData.sq = i; });
      this.pieceGroup.add(g);
      this.meshes[i] = g;
    });
    this.shownBoard = JSON.parse(JSON.stringify(st.board));
    this.shownV = st.v;
  }

  private flat(geo: THREE.BufferGeometry, mat: THREE.Material, i: number, y = 0.056) {
    const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2;
    const p = pos(i); m.position.set(p.x, y, p.z);
    this.markGroup.add(m);
  }

  private marks() {
    this.markGroup.clear();
    const v = this.view;
    if (!v) return;
    const lm = v.state.lastMove;
    if (lm) {
      this.flat(new THREE.PlaneGeometry(0.96, 0.96), MARK.lastFrom, lm.from, 0.053);
      this.flat(new THREE.PlaneGeometry(0.96, 0.96), MARK.last, lm.to, 0.053);
      for (const i of [lm.from, lm.to]) this.flat(frameGeo(), MARK.lastEdge, i, 0.055);
      if (lm.path.length > 1) lm.path.slice(0, -1).forEach((i) => this.flat(new THREE.CircleGeometry(0.12, 24), MARK.lastEdge, i, 0.055));
    }
    if (v.shieldPick) v.state.board.forEach((p, i) => { if (p && p.s === v.state.turn && p.t !== 'STW') this.flat(new THREE.RingGeometry(0.4, 0.5, 48), MARK.pick, i, 0.06); });
    v.pickable?.forEach((i) => this.flat(new THREE.RingGeometry(0.4, 0.5, 48), MARK.pick, i, 0.06));
    if (v.selected !== null) this.flat(new THREE.RingGeometry(0.42, 0.5, 48), MARK.sel, v.selected);
    for (const m of v.moves) {
      if (m.cap.length) this.flat(new THREE.RingGeometry(0.36, 0.44, 48), MARK.hit, m.to, 0.058);
      else this.flat(new THREE.CircleGeometry(0.13, 32), MARK.dot, m.to);
    }
    const h = this.hoverMove;
    if (h && h.cap.length) {
      h.path.forEach((i) => this.flat(new THREE.PlaneGeometry(0.96, 0.96), MARK.path, i, 0.054));
      h.cap.forEach((i) => this.flat(new THREE.PlaneGeometry(0.96, 0.96), MARK.cap, i, 0.054));
    }
  }

  private renderCards(st: GameState) {
    const key = JSON.stringify(st.hands);
    if (key === this.handKey) return;
    this.handKey = key;
    this.cardGroup.clear();
    this.cardMeshes = [];
    const slots: Record<Side, [number, number][]> = { M: [[-1.7, 5.55], [0, 5.55], [1.7, 5.55]], O: [[1.7, -5.55], [0, -5.55], [-1.7, -5.55]] };
    const edge = new THREE.MeshStandardMaterial({ color: 0xd8cba8, roughness: 0.8 });
    const back = new THREE.MeshStandardMaterial({ color: 0x6b2a1a, roughness: 0.7 });
    (['M', 'O'] as Side[]).forEach((s) => st.hands[s].forEach((k, i) => {
      const face = new THREE.MeshStandardMaterial({ map: cardTexture(k, s), roughness: 0.65 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.025, 1.8), [edge, edge, face, back, edge, edge]);
      const n = st.hands[s].length;
      const [x, z] = slots[s][n === 1 ? 1 : i === 0 ? 0 : i === 1 ? 2 : 1];
      m.position.set(x, -0.36, z);
      m.rotation.y = (s === 'O' ? Math.PI : 0) + (i % 2 ? -0.06 : 0.06);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.card = { side: s, index: i };
      this.cardGroup.add(m); this.cardMeshes.push(m);
    }));
  }

  private tween(dur: number, f: (k: number) => void, end?: () => void) {
    if (this.reduce) { f(1); end?.(); return; }
    this.tweens.push({ t0: performance.now(), dur, f, end });
  }

  private animateMove(m: Move & { t: string }, done: () => void) {
    const g = this.meshes[m.from]!;
    const pts = [g.position.clone(), ...m.path.map(pos)];
    const caps = m.cap.map((i) => this.meshes[i]);
    const knight = m.t === 'MAR';
    let i = 0;
    const step = () => {
      if (i >= pts.length - 1) { done(); return; }
      const a = pts[i], b = pts[i + 1], dist = a.distanceTo(b);
      const jump = (m.cap.length > 0 && m.path.length > 1) || knight;
      const hop = jump ? 0.9 : Math.min(0.5, 0.15 + dist * 0.05);
      const dur = Math.min(520, 240 + dist * 60);
      const capNow = m.path.length > 1 ? caps[i] : (i === pts.length - 2 ? caps[0] : null);
      this.tween(dur, (k) => {
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        g.position.lerpVectors(a, b, e);
        g.position.y = a.y + Math.sin(Math.PI * k) * hop;
        if (capNow && k > 0.6) capNow.scale.setScalar(Math.max(0, 1 - (k - 0.6) / 0.4));
      }, () => { i++; step(); });
    };
    step();
  }

  private hit(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.intersectObjects([...this.cardMeshes, ...this.pieceGroup.children, ...this.tiles], true)[0];
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, moved: false };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };
  private onMove = (e: PointerEvent) => {
    const d = this.down;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) { d.moved = true; this.host.classList.add('dragging'); }
      if (d.moved) {
        this.orbit.tTheta -= dx * 0.006;
        this.orbit.tPhi = Math.max(0.05, Math.min(1.35, this.orbit.tPhi - dy * 0.005));
        d.x = e.clientX; d.y = e.clientY;
      }
      return;
    }
    const h = this.hit(e);
    this.hoverCard = h && h.object.userData.card ? (h.object as THREE.Mesh) : null;
    let m: Move | null = null;
    const v = this.view;
    if (!this.busy && v && v.selected !== null && h && h.object.userData.sq !== undefined) {
      const sq = h.object.userData.sq as number;
      m = v.moves.find((x) => x.to === sq) ?? null;
    }
    if (m !== this.hoverMove) { this.hoverMove = m; this.marks(); }
    const sq = h?.object.userData.sq;
    this.renderer.domElement.style.cursor = this.hoverCard || m || (sq !== undefined && v?.state.board[sq]) ? 'pointer' : '';
  };
  private onUp = (e: PointerEvent) => {
    this.host.classList.remove('dragging');
    const wasClick = this.down && !this.down.moved;
    this.down = null;
    if (!wasClick || this.busy) return;
    const h = this.hit(e);
    if (!h) return;
    if (h.object.userData.card) { const { side, index } = h.object.userData.card; this.handlers.onCard(side, index); return; }
    if (h.object.userData.sq !== undefined) this.handlers.onSquare(h.object.userData.sq);
  };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.zoom(e.deltaY * 0.01); };

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.orbit.tRad = Math.max(this.orbit.tRad, w / h < 1 ? 19 : 15);
    this.camera.updateProjectionMatrix();
  }

  private loop = (now: number) => {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i], k = Math.min(1, (now - t.t0) / t.dur);
      t.f(k);
      if (k >= 1) { this.tweens.splice(i, 1); t.end?.(); }
    }
    const sc = this.view?.selectedCard;
    for (const m of this.cardMeshes) {
      const c = m.userData.card;
      const target = -0.36 + (m === this.hoverCard ? 0.12 : 0) + (sc && sc.side === c.side && sc.index === c.index ? 0.08 : 0);
      m.position.y += (target - m.position.y) * 0.2;
    }
    this.pieceGroup.traverse((o) => { if (o.userData.spin) o.rotation.z = now * 0.0015; });
    const o = this.orbit;
    o.theta += (o.tTheta - o.theta) * 0.08; o.phi += (o.tPhi - o.phi) * 0.1; o.rad += (o.tRad - o.rad) * 0.1;
    this.camera.position.set(o.rad * Math.sin(o.phi) * Math.sin(o.theta), o.rad * Math.cos(o.phi), o.rad * Math.sin(o.phi) * Math.cos(o.theta));
    this.camera.lookAt(0, -0.3, 0);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };
}
