import * as THREE from 'three';
import { LOOKS, boardTexture, groundTexture, props } from './landTable.ts';
import { CARDS, rc, type CardKey, type GameState, type Move, type Piece, type Side, type Square, type PieceType } from '../game/rules.ts';

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
};
const MARK = {
  sel: new THREE.MeshBasicMaterial({ color: 0xcda641, transparent: true, opacity: 0.55 }),
  dot: new THREE.MeshBasicMaterial({ color: 0x5daae4, transparent: true, opacity: 0.85 }),
  hit: new THREE.MeshBasicMaterial({ color: 0xe5574d }),
  path: new THREE.MeshBasicMaterial({ color: 0xcda641, transparent: true, opacity: 0.45 }),
  cap: new THREE.MeshBasicMaterial({ color: 0xe5574d, transparent: true, opacity: 0.4 }),
  pick: new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.9 }),
  last: new THREE.MeshBasicMaterial({ color: 0x5daae4, transparent: true, opacity: 0.22 }),
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

function makePiece(p: Piece) {
  const g = new THREE.Group();
  const t = p.t;
  if (t === 'stone') {
    add(new THREE.CylinderGeometry(0.38, 0.4, 0.18, 48), MAT.coral, 0.09, g);
    add(new THREE.TorusGeometry(0.2, 0.03, 10, 40), MAT.coralLight, 0.185, g).rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(0.385, 0.02, 8, 48), MAT.coralLight, 0.12, g).rotation.x = Math.PI / 2;
  } else {
    const promoted = t === 'PT' || t === 'PL';
    const mat = t === 'PT' ? MAT.ebony : t === 'PL' ? MAT.ivory : MAT.navy;
    const acc = t === 'PT' ? MAT.ivory : t === 'PL' ? MAT.ebony : MAT.brass;
    const kind = t === 'PT' ? 'KAN' : t === 'PL' ? 'KAP' : t;
    if (kind === 'INF') { const y = body(g, mat, 0.32, 0.14); add(new THREE.TorusGeometry(0.15, 0.03, 10, 32), acc, y, g).rotation.x = Math.PI / 2; add(new THREE.SphereGeometry(0.17, 32, 20), mat, y + 0.13, g); }
    if (kind === 'KAN') {
      const y = body(g, mat, 0.5, 0.22);
      add(new THREE.CylinderGeometry(0.27, 0.25, 0.14, 32), mat, y + 0.07, g);
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; add(new THREE.BoxGeometry(0.11, 0.12, 0.11), acc, y + 0.2, g, Math.cos(a) * 0.19, Math.sin(a) * 0.19); }
      if (!promoted) add(new THREE.CylinderGeometry(0.045, 0.055, 0.38, 16), acc, y - 0.12, g, 0, 0.2).rotation.x = Math.PI / 2.4;
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
      const y = body(g, mat, 0.72, 0.16);
      add(new THREE.TorusGeometry(0.16, 0.035, 10, 32), acc, y, g).rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(0.2, 32, 20), mat, y + 0.14, g);
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; add(new THREE.SphereGeometry(0.04, 12, 8), acc, y + 0.3, g, Math.cos(a) * 0.15, Math.sin(a) * 0.15); }
      add(new THREE.SphereGeometry(0.07, 16, 12), acc, y + 0.38, g);
    }
    if (kind === 'FL') {
      const y = body(g, mat, 0.82, 0.17);
      add(new THREE.TorusGeometry(0.17, 0.035, 10, 32), acc, y, g).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.22, 0.17, 0.2, 32), mat, y + 0.1, g);
      add(new THREE.BoxGeometry(0.06, 0.3, 0.06), acc, y + 0.35, g);
      add(new THREE.BoxGeometry(0.22, 0.06, 0.06), acc, y + 0.38, g);
    }
    if (promoted) add(new THREE.TorusGeometry(0.37, 0.03, 10, 40), acc, 0.05, g).rotation.x = Math.PI / 2;
    if (p.s === 'O') g.rotation.y = Math.PI;
  }
  if (p.shielded) { const ring = add(new THREE.TorusGeometry(0.47, 0.035, 10, 48), MAT.shield, 0.3, g); ring.rotation.x = Math.PI / 2; ring.userData.spin = true; }
  return g;
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
    const light = new THREE.MeshStandardMaterial({ map: woodTex('#d9c9a3', '#8a6f43', 3), roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ map: woodTex('#7a5634', '#3a2412', 11), roughness: 0.6 });
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
    if (lm && !v.selected) { this.flat(new THREE.PlaneGeometry(0.96, 0.96), MARK.last, lm.from, 0.053); this.flat(new THREE.PlaneGeometry(0.96, 0.96), MARK.last, lm.to, 0.053); }
    if (v.shieldPick) v.state.board.forEach((p, i) => { if (p && p.s === v.state.turn) this.flat(new THREE.RingGeometry(0.4, 0.5, 48), MARK.pick, i, 0.06); });
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
