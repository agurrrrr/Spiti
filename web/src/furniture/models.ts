import * as THREE from 'three';
import type { ModelKind } from './catalog';

/**
 * 치수만으로 가구 모델을 절차적으로 만든다.
 * 원점은 바닥 중심, 앞면은 +Z, 가로는 X축이다. 재질은 가구마다 새로 만들어 충돌 색칠을 따로 할 수 있게 한다.
 */
export interface ModelSize {
  w: number;
  d: number;
  h: number;
}

type Builder = (s: ModelSize, color: THREE.Color, g: Parts) => void;

class Parts {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  constructor(readonly group: THREE.Group) {}

  mat(color: THREE.ColorRepresentation, roughness = 0.75, metalness = 0): THREE.MeshStandardMaterial {
    const c = new THREE.Color(color);
    const key = `${c.getHexString()}-${roughness}-${metalness}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: c, roughness, metalness });
      this.cache.set(key, m);
    }
    return m;
  }

  /** 바닥 높이 y에서 시작하는 상자 */
  box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.1), Math.max(h, 0.1), Math.max(d, 0.1)), material);
    m.position.set(x, y + h / 2, z);
    this.group.add(m);
    return m;
  }

  cylinder(r: number, h: number, material: THREE.Material, x = 0, y = 0, z = 0, segments = 20): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material);
    m.position.set(x, y + h / 2, z);
    this.group.add(m);
    return m;
  }

  sphere(r: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), material);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }
}

const shade = (c: THREE.Color, l: number) => c.clone().offsetHSL(0, 0, l);
const WOOD = '#b48a5e';
const DARK = '#2f3237';
const LINE = '#6b7280';

const bed: Builder = ({ w, d, h }, color, p) => {
  const frameH = Math.min(30, h * 0.33);
  const wood = p.mat(WOOD, 0.7);
  p.box(w, frameH, d, wood);
  p.box(w, Math.max(h, frameH + 30), 7, wood, 0, 0, -d / 2 + 3.5);
  const matH = 20;
  p.box(w - 6, matH, d - 10, p.mat('#f6f4ef', 0.95), 0, frameH, 2);
  const top = frameH + matH;
  const pillows = w >= 140 ? 2 : 1;
  const pw = (w - 16) / pillows - 6;
  for (let i = 0; i < pillows; i++) {
    const x = -w / 2 + 8 + (i + 0.5) * ((w - 16) / pillows);
    p.box(pw, 10, 38, p.mat('#ffffff', 0.95), x, top, -d / 2 + 34);
  }
  p.box(w - 2, 5, d * 0.58, p.mat(color, 0.95), 0, top - 2, d / 2 - d * 0.29 - 3);
};

const sofa: Builder = ({ w, d, h }, color, p) => {
  const main = p.mat(color, 0.95);
  const cushion = p.mat(shade(color, 0.06), 0.95);
  const legs = p.mat(DARK, 0.5);
  const legH = 8;
  const armW = Math.min(18, w * 0.14);
  const seatTop = Math.min(45, h * 0.53);
  const backD = Math.min(22, d * 0.26);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) p.box(4, legH, 4, legs, sx * (w / 2 - 8), 0, sz * (d / 2 - 8));
  }
  p.box(w, seatTop - legH - 12, d, main, 0, legH);
  p.box(w - armW * 2, h - legH, backD, main, 0, legH, -d / 2 + backD / 2);
  for (const sx of [-1, 1]) p.box(armW, h * 0.68 - legH, d, main, sx * (w / 2 - armW / 2), legH);
  const n = w > 190 ? 3 : w > 120 ? 2 : 1;
  const inner = w - armW * 2;
  const cw = inner / n - 2;
  for (let i = 0; i < n; i++) {
    const x = -inner / 2 + (i + 0.5) * (inner / n);
    p.box(cw, 13, d - backD - 3, cushion, x, seatTop - 12, backD / 2 + 1);
  }
};

const table: Builder = ({ w, d, h }, color, p) => {
  const wood = p.mat(color, 0.6);
  p.box(w, 4, d, wood, 0, h - 4);
  const legs = p.mat(shade(color, -0.12), 0.6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) p.box(5, h - 4, 5, legs, sx * (w / 2 - 7), 0, sz * (d / 2 - 7));
  }
};

/** 가로·깊이가 다르면 타원 상판이 된다 */
const roundTable: Builder = ({ w, d, h }, color, p) => {
  p.cylinder(0.5, 4, p.mat(color, 0.6), 0, h - 4, 0, 48).scale.set(w, 1, d);
  const leg = p.mat(shade(color, -0.12), 0.6);
  const r = Math.min(w, d);
  p.cylinder(Math.max(3, r * 0.05), h - 6, leg, 0, 2, 0, 16);
  p.cylinder(r * 0.28, 2, leg, 0, 0, 0, 32);
};

/** 수납장은 뒤쪽(주방 쪽, -Z)에 두고, 앞쪽은 상판만 내밀어 의자가 들어가게 한다 */
const island: Builder = ({ w, d, h }, color, p) => {
  const topT = 4;
  const side = 3;
  const wood = p.mat(WOOD, 0.6);
  p.box(w, topT, d, wood, 0, h - topT);
  for (const sx of [-1, 1]) p.box(side, h - topT, d, wood, sx * (w / 2 - side / 2), 0);
  const bodyD = d - Math.min(30, d * 0.35);
  const bz = -d / 2 + bodyD / 2;
  const bw = w - side * 2;
  const bodyH = h - topT - 8;
  p.box(bw, bodyH, bodyD, p.mat(color, 0.55), 0, 8, bz);
  p.box(bw, 8, bodyD - 4, p.mat(shade(color, -0.2), 0.8), 0, 0, bz + 2);
  const doors = Math.max(2, Math.round(bw / 45));
  const line = p.mat(LINE);
  const handle = p.mat('#9ca3af', 0.3, 0.7);
  for (let i = 0; i < doors; i++) {
    const x0 = -bw / 2 + (bw / doors) * i;
    if (i > 0) p.box(0.6, bodyH - 2, 0.6, line, x0, 9, -d / 2 - 0.2);
    p.box((bw / doors) * 0.4, 1.5, 1.5, handle, x0 + bw / doors / 2, bodyH, -d / 2 - 0.8);
  }
};

const chair: Builder = ({ w, d, h }, color, p) => {
  const wood = p.mat(color, 0.6);
  const seatH = Math.min(45, h * 0.53);
  p.box(w, 4, d, wood, 0, seatH - 4);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) p.box(3.5, seatH - 4, 3.5, wood, sx * (w / 2 - 3), 0, sz * (d / 2 - 3));
  }
  p.box(w, h - seatH, 3, wood, 0, seatH, -d / 2 + 1.5);
};

const desk: Builder = ({ w, d, h }, color, p) => {
  const body = p.mat(color, 0.6);
  p.box(w, 3, d, body, 0, h - 3);
  p.box(3, h - 3, d - 2, body, -w / 2 + 1.5, 0);
  if (w >= 100) {
    p.box(40, h - 3, d - 4, body, w / 2 - 20, 0, -1);
    const line = p.mat(LINE);
    for (let i = 1; i < 3; i++) p.box(36, 0.6, 0.6, line, w / 2 - 20, ((h - 3) / 3) * i, d / 2 - 2.6);
  } else {
    p.box(3, h - 3, d - 2, body, w / 2 - 1.5, 0);
  }
  p.box(w - 6, 20, 2, body, 0, h - 23, -d / 2 + 2);
};

const wardrobe: Builder = ({ w, d, h }, color, p) => {
  p.box(w, h - 6, d, p.mat(color, 0.55), 0, 6);
  p.box(w - 4, 6, d - 4, p.mat(shade(color, -0.2), 0.8), 0, 0, -2);
  const doors = Math.max(1, Math.round(w / 50));
  const line = p.mat(LINE);
  const handle = p.mat('#9ca3af', 0.3, 0.7);
  for (let i = 0; i < doors; i++) {
    const x0 = -w / 2 + (w / doors) * i;
    if (i > 0) p.box(0.6, h - 8, 0.6, line, x0, 7, d / 2 + 0.2);
    const hx = i % 2 === 0 ? x0 + w / doors - 5 : x0 + 5;
    p.box(1.5, 22, 1.5, handle, hx, h * 0.45, d / 2 + 0.8);
  }
};

const drawer: Builder = ({ w, d, h }, color, p) => {
  p.box(w, h - 5, d, p.mat(color, 0.6), 0, 5);
  p.box(w - 4, 5, d - 4, p.mat(shade(color, -0.2)), 0, 0, -2);
  const rows = Math.max(2, Math.round(h / 22));
  const line = p.mat(LINE);
  const handle = p.mat('#9ca3af', 0.3, 0.7);
  const rh = (h - 5) / rows;
  for (let i = 0; i < rows; i++) {
    if (i > 0) p.box(w - 2, 0.6, 0.6, line, 0, 5 + rh * i, d / 2 + 0.2);
    p.box(w * 0.3, 1.5, 1.5, handle, 0, 5 + rh * (i + 0.5), d / 2 + 0.8);
  }
};

const BOOK_COLORS = ['#b45309', '#1d4ed8', '#047857', '#be123c', '#6d28d9', '#a16207', '#0f766e'];

const bookshelf: Builder = ({ w, d, h }, color, p) => {
  const wood = p.mat(color, 0.65);
  p.box(2, h, d, wood, -w / 2 + 1, 0);
  p.box(2, h, d, wood, w / 2 - 1, 0);
  p.box(w, 1, d, wood, 0, 0);
  p.box(w, 2, d, wood, 0, h - 2);
  p.box(w - 4, h, 1, wood, 0, 0, -d / 2 + 0.5);
  // 넓은 책장은 칸막이로 나눈다
  const bays = Math.max(1, Math.round(w / 70));
  const bayW = (w - 4) / bays;
  for (let b = 1; b < bays; b++) p.box(2, h - 3, d - 1, wood, -w / 2 + 2 + bayW * b, 1, 0.5);
  const shelves = Math.max(1, Math.floor(h / 36));
  const gap = h / (shelves + 1);
  for (let s = 0; s <= shelves; s++) {
    const y = s * gap + (s === 0 ? 1 : 0);
    if (s > 0) p.box(w - 4, 2, d - 1, wood, 0, y, 0.5);
    for (let b = 0; b < bays; b++) {
      const left = -w / 2 + 2 + bayW * b;
      let x = left + (b > 0 ? 2 : 1);
      let k = s * 3 + b * 5;
      while (x < left + bayW - 10) {
        const bw = 2.5 + ((k * 7) % 4);
        const bh = gap * (0.55 + ((k * 13) % 5) * 0.07);
        p.box(bw, bh, d * 0.75, p.mat(BOOK_COLORS[k % BOOK_COLORS.length], 0.8), x + bw / 2, y + 2, 0);
        x += bw + 0.6;
        k++;
        if (k % 9 === 0) x += 8;
      }
    }
  }
};

const STORAGE_COLORS = ['#c8a477', '#e2e8f0', '#9ca3af'];

/** 뒤판 없는 스틸 랙. 칸마다 수납함을 얹어 빈 틀처럼 보이지 않게 한다 */
const shelf: Builder = ({ w, d, h }, color, p) => {
  const metal = p.mat(color, 0.45, 0.5);
  const board = p.mat(shade(color, 0.06), 0.6);
  const t = 2.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) p.box(t, h, t, metal, sx * (w / 2 - t / 2), 0, sz * (d / 2 - t / 2));
  }
  const levels = Math.max(2, Math.floor(h / 40) + 1);
  const bottom = Math.min(10, h * 0.1);
  const gap = (h - bottom - 2) / (levels - 1);
  const bw = Math.min(36, w * 0.38);
  const bh = Math.min(30, gap * 0.65);
  const stored = (k: number) => p.mat(STORAGE_COLORS[k % STORAGE_COLORS.length], 0.85);
  for (let i = 0; i < levels; i++) {
    const y = bottom + gap * i;
    p.box(w, 2, d, board, 0, y);
    if (i === levels - 1) continue;
    if (i % 2 === 0) {
      p.box(bw, bh, d * 0.8, stored(i), -w / 2 + bw / 2 + 4, y + 2);
      if (w > bw * 2 + 12) p.box(bw, bh, d * 0.8, stored(i + 1), -w / 2 + bw * 1.5 + 8, y + 2);
    } else {
      p.box(bw, bh, d * 0.8, stored(i), w / 2 - bw / 2 - 4, y + 2);
    }
  }
};

const tvStand: Builder = ({ w, d, h }, color, p) => {
  p.box(w, h - 6, d, p.mat(color, 0.55), 0, 6);
  p.box(w - 6, 6, d - 6, p.mat(DARK, 0.6), 0, 0, -1);
  const doors = Math.max(2, Math.round(w / 60));
  const line = p.mat(LINE);
  for (let i = 1; i < doors; i++) p.box(0.6, h - 10, 0.6, line, -w / 2 + (w / doors) * i, 8, d / 2 + 0.2);
};

const tv: Builder = ({ w, d, h }, color, p) => {
  const standH = 45;
  tvStand({ w, d, h: standH }, color, p);
  const panelH = Math.max(20, h - standH - 6);
  const panelW = Math.min(w * 0.9, panelH / 0.5625);
  const black = p.mat('#111317', 0.35, 0.2);
  p.box(24, 2, 16, black, 0, standH, -d / 2 + 14);
  p.box(5, 6, 3, black, 0, standH + 1, -d / 2 + 14);
  p.box(panelW, panelW * 0.5625, 3, black, 0, standH + 6, -d / 2 + 14);
};

const fridge: Builder = ({ w, d, h }, color, p) => {
  p.box(w, h, d, p.mat(color, 0.35, 0.35));
  p.box(0.8, h - 4, 0.8, p.mat(LINE), 0, 2, d / 2 + 0.2);
  const handle = p.mat('#9ca3af', 0.25, 0.8);
  p.box(2, h * 0.4, 3, handle, -4, h * 0.38, d / 2 + 1.5);
  p.box(2, h * 0.4, 3, handle, 4, h * 0.38, d / 2 + 1.5);
};

/** 단문형: 문 한 짝, 손잡이는 오른쪽 끝 */
const fridge1: Builder = ({ w, d, h }, color, p) => {
  p.box(w, h, d, p.mat(color, 0.35, 0.35));
  p.box(2, h * 0.4, 3, p.mat('#9ca3af', 0.25, 0.8), w / 2 - 5, h * 0.38, d / 2 + 1.5);
};

const washer: Builder = ({ w, d, h }, color, p) => {
  p.box(w, h, d, p.mat(color, 0.4, 0.05));
  p.box(w - 2, 10, 0.6, p.mat('#d1d5db', 0.5), 0, h - 12, d / 2 + 0.2);
  const r = Math.min(w, h) * 0.3;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3, 32), p.mat('#9ca3af', 0.3, 0.7));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, h * 0.45, d / 2 + 1.5);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r * 0.75, 3.4, 32), p.mat('#334155', 0.1, 0.3));
  glass.rotation.x = Math.PI / 2;
  glass.position.set(0, h * 0.45, d / 2 + 1.6);
  p.group.add(ring, glass);
};

const rug: Builder = ({ w, d, h }, color, p) => {
  const t = Math.max(h, 0.8);
  p.box(w, t, d, p.mat(shade(color, -0.12), 1), 0, 0.2);
  p.box(w - 16, t + 0.2, d - 16, p.mat(color, 1), 0, 0.2);
};

const plant: Builder = ({ w, d, h }, color, p) => {
  const r = Math.min(w, d) * 0.3;
  const potH = h * 0.28;
  p.cylinder(r, potH, p.mat('#b8673f', 0.8), 0, 0, 0);
  const leaf = p.mat(color, 0.9);
  const leafDark = p.mat(shade(new THREE.Color(color), -0.08), 0.9);
  p.cylinder(1.5, h * 0.4, p.mat('#6b4f3a'), 0, potH, 0, 8);
  p.sphere(Math.min(w, d) * 0.45, leaf, 0, h * 0.72, 0);
  p.sphere(Math.min(w, d) * 0.32, leafDark, w * 0.15, h * 0.55, d * 0.08);
  p.sphere(Math.min(w, d) * 0.3, leaf, -w * 0.12, h * 0.88, -d * 0.05);
};

const aircon: Builder = ({ w, d, h }, color, p) => {
  p.box(w, h, d, p.mat(color, 0.4));
  p.box(w - 8, h * 0.18, 0.6, p.mat('#475569', 0.6), 0, h * 0.74, d / 2 + 0.2);
  p.box(10, 3, 0.6, p.mat('#38bdf8', 0.3), 0, h * 0.62, d / 2 + 0.2);
};

const HANGER_CLOTHES = ['#334155', '#9f1239', '#e2e8f0', '#1e3a8a', '#a3a3a3', '#57534e', '#0f766e'];

const hanger: Builder = ({ w, d, h }, color, p) => {
  const metal = p.mat(color, 0.35, 0.6);
  for (const sx of [-1, 1]) {
    p.cylinder(1.3, h, metal, sx * (w / 2 - 2), 0, 0, 10);
    p.box(3, 3, d, metal, sx * (w / 2 - 2), 0, 0);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, w - 4, 10), metal);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, h - 4, 0);
  p.group.add(bar);
  const n = Math.max(3, Math.floor((w - 20) / 9));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 12 + i * ((w - 24) / Math.max(1, n - 1));
    const len = h * (0.35 + ((i * 7) % 4) * 0.06);
    p.box(3, len, Math.min(d - 6, 44), p.mat(HANGER_CLOTHES[i % HANGER_CLOTHES.length], 0.95), x, h - 6 - len, 0);
  }
};

const box: Builder = ({ w, d, h }, color, p) => {
  p.box(w, h, d, p.mat(color, 0.7));
};

const BUILDERS: Record<ModelKind, Builder> = {
  bed,
  sofa,
  table,
  roundTable,
  island,
  chair,
  desk,
  wardrobe,
  drawer,
  bookshelf,
  shelf,
  tv,
  tvStand,
  fridge,
  fridge1,
  washer,
  rug,
  plant,
  aircon,
  hanger,
  box,
};

export function buildModel(kind: ModelKind, size: ModelSize, color: string): THREE.Group {
  const group = new THREE.Group();
  BUILDERS[kind](size, new THREE.Color(color), new Parts(group));
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = kind !== 'rug';
      mesh.receiveShadow = true;
    }
  });
  return group;
}

export function disposeModel(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      const m = mesh.material;
      (Array.isArray(m) ? m : [m]).forEach((x) => materials.add(x));
    }
  });
  materials.forEach((m) => m.dispose());
}
