import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import * as polygonClippingNS from 'polygon-clipping';
import type { FloorKind, Fixture, Vec2 } from '../types';
import { polygonArea, polygonCentroid, rectSize } from './geometry';
import { wallFootprint, type ResolvedOpening, type ResolvedPlan, type ResolvedWall } from './resolve';

// polygon-clipping은 런타임에는 default export만 있고, 타입 선언은 named export만 있다
const polygonClipping = ((polygonClippingNS as unknown as { default?: typeof polygonClippingNS }).default ??
  polygonClippingNS) as typeof polygonClippingNS;

const WALL_SIDE = new THREE.Color('#f3f1ed');
const WALL_TOP = new THREE.Color('#3b4048');

/** 평면도 다각형을 XZ 평면용 Shape로 바꾼다. rotateX(-90°) 후 Z = 평면도 y가 된다. */
function toShape(ring: Vec2[]): THREE.Shape {
  return new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, -y)));
}

function dropClosingPoint(ring: [number, number][]): Vec2[] {
  const r = ring.slice() as Vec2[];
  if (r.length > 1) {
    const [fx, fy] = r[0];
    const [lx, ly] = r[r.length - 1];
    if (Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9) r.pop();
  }
  return r;
}

/** 벽 바닥 사각형을 합집합으로 녹여 하나로 세운 뒤, 개구부를 CSG로 뚫는다. */
export function buildWallGeometry(rp: ResolvedPlan, height: number): THREE.BufferGeometry {
  const polys = rp.walls.map((w) => [wallFootprint(w).map(([x, y]) => [x, y] as [number, number])]);
  const merged = polygonClipping.union(polys[0], ...polys.slice(1));
  const shapes = merged.map((poly) => {
    const [outer, ...holes] = poly.map(dropClosingPoint);
    const shape = toShape(outer);
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, -y))));
    return shape;
  });
  const extruded = new THREE.ExtrudeGeometry(shapes, { depth: height, bevelEnabled: false });
  extruded.rotateX(-Math.PI / 2);
  extruded.clearGroups();
  extruded.deleteAttribute('uv');

  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  evaluator.useGroups = false;

  let result = new Brush(extruded);
  result.updateMatrixWorld();
  const wallById = new Map(rp.walls.map((w) => [w.id, w]));
  for (const o of rp.openings) {
    if (o.bottom >= height) continue;
    const wall = wallById.get(o.wallId)!;
    const fromFloor = o.bottom <= 0;
    const y0 = fromFloor ? -2 : o.bottom;
    const y1 = Math.min(o.top, height + 10);
    const box = new THREE.BoxGeometry(o.width, y1 - y0, wall.thickness + 6);
    box.clearGroups();
    box.deleteAttribute('uv');
    const cutter = new Brush(box);
    cutter.position.set(o.center[0], (y0 + y1) / 2, o.center[1]);
    cutter.rotation.y = -Math.atan2(wall.dir[1], wall.dir[0]);
    cutter.updateMatrixWorld();
    const next = evaluator.evaluate(result, cutter, SUBTRACTION);
    result.geometry.dispose();
    box.dispose();
    result = next;
  }

  const geometry = result.geometry.index ? result.geometry.toNonIndexed() : result.geometry;
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const c = normals.getY(i) > 0.7 ? WALL_TOP : WALL_SIDE;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

let floorTextures: Partial<Record<FloorKind, THREE.Texture>> | null = null;

/** 바닥 텍스처는 캔버스로 그린다. UV가 cm 단위라서 repeat로 타일 크기를 정한다. */
function floorTexture(kind: FloorKind): THREE.Texture {
  floorTextures ??= {};
  const cached = floorTextures[kind];
  if (cached) return cached;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  let tileCm = 160;
  if (kind === 'wood' || kind === 'kitchen') {
    // 마루: 폭 20cm, 길이 80cm 판재를 엇갈려 깐다
    const base = kind === 'wood' ? [214, 190, 152] : [226, 212, 186];
    const planks = 8;
    const pw = size / planks;
    const half = size / 2;
    for (let i = 0; i < planks; i++) {
      const offset = ((i * 3) % 4) * (size / 4);
      for (let j = 0; j < 2; j++) {
        const jitter = ((i * 37 + j * 91) % 17) - 8;
        g.fillStyle = `rgb(${base[0] + jitter},${base[1] + jitter},${base[2] + jitter})`;
        const y0 = (offset + j * half) % size;
        g.fillRect(i * pw, y0, pw, half);
        if (y0 + half > size) g.fillRect(i * pw, y0 - size, pw, half);
      }
      g.fillStyle = 'rgba(90,64,40,0.2)';
      g.fillRect(i * pw, 0, 2, size);
      g.fillRect(i * pw, offset, pw, 2);
      g.fillRect(i * pw, (offset + half) % size, pw, 2);
    }
  } else {
    tileCm = 60;
    g.fillStyle = '#d9dee2';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#b8c0c7';
    for (let k = 0; k <= 2; k++) {
      g.fillRect((k * size) / 2 - 2, 0, 4, size);
      g.fillRect(0, (k * size) / 2 - 2, size, 4);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / tileCm, 1 / tileCm);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  floorTextures[kind] = tex;
  return tex;
}

function doorSymbol(o: ResolvedOpening, wallHeight: number): THREE.Group {
  const g = new THREE.Group();
  if (!o.hinge || !o.swingNormal || !o.closedDir) return g;
  const [hx, hy] = o.hinge;
  const [nx, ny] = o.swingNormal;
  const [cx, cy] = o.closedDir;
  const r = o.width;
  const pts: THREE.Vector3[] = [new THREE.Vector3(hx + nx * r, 0.8, hy + ny * r), new THREE.Vector3(hx, 0.8, hy)];
  for (let i = 0; i <= 24; i++) {
    const s = (i / 24) * (Math.PI / 2);
    const vx = cx * Math.cos(s) + nx * Math.sin(s);
    const vy = cy * Math.cos(s) + ny * Math.sin(s);
    pts.push(new THREE.Vector3(hx + vx * r, 0.8, hy + vy * r));
  }
  const color = o.type === 'entrance' ? '#b45309' : '#8b6b47';
  const arc = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }),
  );
  arc.userData.planLine = true;
  g.add(arc);

  const leafH = Math.min(o.top, wallHeight) - 2;
  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(r - 2, leafH, 3.5),
    new THREE.MeshStandardMaterial({ color: o.type === 'entrance' ? '#6b4f3a' : '#c9a77c', roughness: 0.7 }),
  );
  leaf.position.set(hx + nx * (r / 2) + cx * 2, leafH / 2 + 0.5, hy + ny * (r / 2) + cy * 2);
  leaf.rotation.y = -Math.atan2(ny, nx);
  leaf.castShadow = true;
  leaf.userData.doorLeaf = true;
  g.add(leaf);
  return g;
}

const SASH_FRAME = new THREE.MeshStandardMaterial({ color: '#f4f5f4', roughness: 0.45 });
const SASH_GLASS = new THREE.MeshStandardMaterial({
  color: '#bfe0ec',
  roughness: 0.05,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
});

/**
 * 유리 미닫이 샷시: 벽 두께를 채우는 바깥 틀 안에 유리 두 짝이 앞뒤로 엇갈려 겹친다.
 * 로컬 X는 벽 방향, Z는 벽 두께 방향이고 원점은 개구부 중심의 바닥이다.
 */
export function sashSymbol(o: ResolvedOpening, wall: ResolvedWall, wallHeight: number): THREE.Group {
  const g = new THREE.Group();
  const W = o.width;
  const H = Math.min(o.top, wallHeight);
  const T = wall.thickness;
  const f = 5; // 바깥 틀 폭
  const sill = 3; // 바닥 레일
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = mat !== SASH_GLASS;
    m.userData.doorLeaf = true;
    g.add(m);
  };

  box(W, f, T, 0, H - f / 2, 0, SASH_FRAME);
  box(W, sill, T, 0, sill / 2, 0, SASH_FRAME);
  box(f, H, T, -(W - f) / 2, H / 2, 0, SASH_FRAME);
  box(f, H, T, (W - f) / 2, H / 2, 0, SASH_FRAME);

  // 두 짝은 가운데에서 4cm 겹치고, 벽 두께의 1/4씩 앞뒤로 비켜 선다
  const clearW = W - 2 * f;
  const clearH = H - f - sill;
  const pw = (clearW + 4) / 2;
  const s = 4.5; // 짝 틀 폭
  const pd = Math.min(3.5, T / 2 - 1);
  const linePts: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const x = (side * (clearW - pw)) / 2;
    const z = side * (T / 4);
    const y = sill + clearH / 2;
    box(pw, s, pd, x, sill + clearH - s / 2, z, SASH_FRAME);
    box(pw, s + 2, pd, x, sill + (s + 2) / 2, z, SASH_FRAME);
    box(s, clearH, pd, x - (pw - s) / 2, y, z, SASH_FRAME);
    box(s, clearH, pd, x + (pw - s) / 2, y, z, SASH_FRAME);
    box(pw - 2 * s, clearH - 2 * s - 2, 0.6, x, sill + (s + 2) + (clearH - 2 * s - 2) / 2, z, SASH_GLASS);
    linePts.push(new THREE.Vector3(x - pw / 2, 0.8, z), new THREE.Vector3(x + pw / 2, 0.8, z));
  }

  // 평면도용 선: 짝마다 한 줄씩 그려 미닫이임을 보인다
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(linePts),
    new THREE.LineBasicMaterial({ color: '#0e7490', transparent: true, opacity: 0.85 }),
  );
  lines.userData.planLine = true;
  g.add(lines);

  g.position.set(o.center[0], 0, o.center[1]);
  g.rotation.y = -Math.atan2(wall.dir[1], wall.dir[0]);
  return g;
}

export function buildFixture(f: Fixture): THREE.Group {
  const [w, d, h] = f.size;
  const g = new THREE.Group();
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(w, h - 4 - 10, d - 4),
    new THREE.MeshStandardMaterial({ color: '#f7f7f5', roughness: 0.6 }),
  );
  cabinet.position.set(0, 10 + (h - 14) / 2, -2);
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(w - 2, 10, d - 10),
    new THREE.MeshStandardMaterial({ color: '#9ca3af', roughness: 0.8 }),
  );
  plinth.position.set(0, 5, -5);
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(w, 4, d),
    new THREE.MeshStandardMaterial({ color: '#8d939b', roughness: 0.35, metalness: 0.1 }),
  );
  top.position.set(0, h - 2, 0);
  const basin = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(80, w * 0.35), 1, d * 0.6),
    new THREE.MeshStandardMaterial({ color: '#cbd2d9', roughness: 0.2, metalness: 0.6 }),
  );
  basin.position.set(-w * 0.15, h + 0.1, 0);
  const faucet = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 25, 12),
    new THREE.MeshStandardMaterial({ color: '#d1d5db', roughness: 0.2, metalness: 0.8 }),
  );
  faucet.position.set(-w * 0.15, h + 12, -d * 0.36);
  g.add(cabinet, plinth, top, basin, faucet);
  // 문짝 경계선
  const doors = Math.max(1, Math.round(w / 45));
  for (let i = 1; i < doors; i++) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, h - 18, 0.6),
      new THREE.MeshStandardMaterial({ color: '#b6bcc4' }),
    );
    line.position.set(-w / 2 + (w / doors) * i, 10 + (h - 18) / 2, d / 2 - 3.6);
    g.add(line);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.position.set(f.at[0], 0, f.at[1]);
  g.rotation.y = THREE.MathUtils.degToRad(f.rotation ?? 0);
  return g;
}

export class PlanView {
  readonly group = new THREE.Group();
  private readonly wallMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });
  private readonly edgeMaterial = new THREE.LineBasicMaterial({ color: '#7b828c', transparent: true, opacity: 0.55 });
  private wallMesh: THREE.Mesh | null = null;
  private wallEdges: THREE.LineSegments | null = null;
  private readonly floors = new THREE.Group();
  private readonly outlines = new THREE.Group();
  private readonly doors = new THREE.Group();
  private readonly fixtures = new THREE.Group();
  private readonly labels = new THREE.Group();
  private wallHeight: number;
  private wireframe = false;

  constructor(private rp: ResolvedPlan) {
    this.wallHeight = rp.plan.wallHeight;
    this.group.add(this.floors, this.outlines, this.doors, this.fixtures, this.labels);
    this.buildFloors();
    this.buildLabels();
    for (const { fixture } of rp.fixtures) this.fixtures.add(buildFixture(fixture));
    this.rebuildWalls();
  }

  get height(): number {
    return this.wallHeight;
  }

  /**
   * 같은 화면에서 구조만 바뀌었을 때 벽·바닥·라벨·붙박이를 다시 만든다.
   * 벽 높이·와이어프레임·라벨 표시 상태와 카메라는 그대로 둔다.
   */
  reset(rp: ResolvedPlan): void {
    this.rp = rp;
    this.clearGroup(this.floors);
    this.clearGroup(this.outlines);
    this.clearGroup(this.labels);
    this.clearGroup(this.fixtures);
    this.clearGroup(this.doors);
    if (this.wallMesh) {
      this.group.remove(this.wallMesh, this.wallEdges!);
      this.wallMesh.geometry.dispose();
      this.wallEdges!.geometry.dispose();
      this.wallMesh = null;
      this.wallEdges = null;
    }
    this.buildFloors();
    this.buildLabels();
    for (const { fixture } of rp.fixtures) this.fixtures.add(buildFixture(fixture));
    this.rebuildWalls();
  }

  private clearGroup(group: THREE.Group): void {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (material) {
        for (const m of Array.isArray(material) ? material : [material]) {
          if (m !== SASH_FRAME && m !== SASH_GLASS) m.dispose();
        }
      }
      if (o instanceof CSS2DObject) o.element.remove();
    });
    group.clear();
  }

  setWallHeight(h: number): void {
    if (h === this.wallHeight) return;
    this.wallHeight = h;
    this.rebuildWalls();
  }

  setWireframe(on: boolean): void {
    this.wireframe = on;
    this.applyStyle();
  }

  setLabelsVisible(on: boolean): void {
    // CSS2DRenderer는 보이지 않는 부모 아래 라벨을 알아서 숨긴다
    this.labels.visible = on;
  }

  /** 다른 평면도로 바꿀 때 씬에서 걷어내고 geometry/material/라벨 DOM을 해제한다 */
  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (material) (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.group.clear();
    this.wallMesh = null;
    this.wallEdges = null;
  }

  private rebuildWalls(): void {
    if (this.wallMesh) {
      this.group.remove(this.wallMesh, this.wallEdges!);
      this.wallMesh.geometry.dispose();
      this.wallEdges!.geometry.dispose();
    }
    const geo = buildWallGeometry(this.rp, this.wallHeight);
    this.wallMesh = new THREE.Mesh(geo, this.wallMaterial);
    this.wallMesh.castShadow = true;
    this.wallMesh.receiveShadow = true;
    this.wallMesh.name = 'walls';
    this.wallEdges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), this.edgeMaterial);
    this.group.add(this.wallMesh, this.wallEdges);

    this.doors.clear();
    const wallById = new Map(this.rp.walls.map((w) => [w.id, w]));
    for (const o of this.rp.openings) {
      this.doors.add(
        o.type === 'sash'
          ? sashSymbol(o, wallById.get(o.wallId)!, this.wallHeight)
          : doorSymbol(o, this.wallHeight),
      );
    }
    this.applyStyle();
  }

  private buildFloors(): void {
    for (const room of this.rp.plan.rooms) {
      const geo = new THREE.ShapeGeometry(toShape(room.polygon));
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ map: floorTexture(room.floor), roughness: 0.85 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.1;
      mesh.receiveShadow = true;
      mesh.userData.roomId = room.id;
      this.floors.add(mesh);

      const pts = room.polygon.map(([x, y]) => new THREE.Vector3(x, 0.4, y));
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.7 }),
      );
      this.outlines.add(outline);
    }
  }

  private buildLabels(): void {
    for (const room of this.rp.plan.rooms) {
      const at = room.labelAt ?? polygonCentroid(room.polygon);
      const el = document.createElement('div');
      el.className = 'room-label';
      const size = rectSize(room.polygon);
      const area = (polygonArea(room.polygon) / 10000).toFixed(1);
      const name = document.createElement('b');
      name.textContent = room.name;
      const meta = document.createElement('span');
      meta.textContent = size ? `${size[0]}×${size[1]} · ${area}㎡` : `${area}㎡`;
      el.append(name, meta);
      const label = new CSS2DObject(el);
      label.position.set(at[0], 2, at[1]);
      this.labels.add(label);
    }
  }

  private applyStyle(): void {
    const wf = this.wireframe;
    this.wallMaterial.transparent = wf;
    this.wallMaterial.opacity = wf ? 0.07 : 1;
    this.wallMaterial.depthWrite = !wf;
    this.wallMaterial.needsUpdate = true;
    this.edgeMaterial.color.set(wf ? '#1d4ed8' : '#7b828c');
    this.edgeMaterial.opacity = wf ? 0.95 : 0.55;
    if (this.wallMesh) this.wallMesh.castShadow = !wf;
    this.outlines.visible = wf;
    for (const f of this.floors.children) {
      const m = (f as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.transparent = wf;
      m.opacity = wf ? 0.7 : 1;
    }
    this.doors.traverse((o) => {
      if (o.userData.doorLeaf) o.visible = !wf;
    });
  }
}
