import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { FurnitureDef } from '../furniture/catalog';
import { catalogById } from '../furniture/catalog';
import { disposeModel } from '../furniture/models';
import { canOverlap, findCollisions, footprintRect, magnetOffset, type Footprint } from '../plan/placement';
import { obbOverlap } from '../plan/geometry';
import type { ResolvedPlan } from '../plan/resolve';
import type { LayoutStore, PlacedItem } from '../state/layout';
import { FurnitureLayer, SelectionGizmo, makeGhost, setTint } from './furnitureLayer';
import type { Viewer } from './viewer';

type Mode =
  | { kind: 'idle' }
  | { kind: 'move'; uid: string; dx: number; dz: number; pointerId: number }
  | { kind: 'rotate'; uid: string; startAngle: number; startRot: number; pointerId: number }
  | { kind: 'empty'; x: number; y: number; pointerId: number };

const MOVE_THRESHOLD = 4;
/** 손가락은 떨림이 커서, 이 거리를 넘기 전에는 카드 드래그로 보지 않는다 */
const TOUCH_MOVE_THRESHOLD = 10;

export const toFootprint = (i: PlacedItem): Footprint => ({
  uid: i.uid,
  x: i.x,
  z: i.z,
  rot: i.rot,
  w: i.w,
  d: i.d,
  flat: catalogById.get(i.typeId)?.flat,
  model: catalogById.get(i.typeId)?.model,
});

/** 위에서 볼 때 반시계 방향이 +인 각도 (three.js rotation.y와 같은 규칙) */
const angleAround = (cx: number, cz: number, p: THREE.Vector3) => Math.atan2(-(p.z - cz), p.x - cx);

/**
 * 3D 화면의 포인터·키보드 조작.
 * - 가구 드래그: 이동 (벽에 가까우면 붙음, Shift로 해제)
 * - 회전 링 드래그: 15° 단위 회전 (Shift로 자유 회전)
 * - 카드 드래그: 오른쪽 목록에서 끌어와 배치
 */
export class Interaction {
  readonly layer = new FurnitureLayer();
  readonly gizmo = new SelectionGizmo();
  collisions = new Set<string>();
  private mode: Mode = { kind: 'idle' };
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly viewer: Viewer,
    private readonly store: LayoutStore,
    private rp: ResolvedPlan,
  ) {
    viewer.scene.add(this.layer.group, this.gizmo.group);
    const signal = this.abort.signal;
    // 캡처 단계에서 먼저 받아야 OrbitControls보다 앞서 가구 드래그를 가로챌 수 있다
    viewer.container.addEventListener('pointerdown', (e) => this.onPointerDown(e), { capture: true, signal });
    viewer.renderer.domElement.addEventListener('pointermove', (e) => this.onHover(e), { signal });
    window.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal });
    window.addEventListener('keydown', (e) => this.onKey(e), { signal });
    this.unsubscribe = store.subscribe(() => this.refresh());
    this.refresh();
  }

  /** 화면을 다른 평면도로 바꿀 때 리스너와 3D 객체를 정리한다 */
  dispose(): void {
    this.abort.abort();
    this.unsubscribe();
    this.listeners.clear();
    for (const root of [this.layer.group, this.gizmo.group]) {
      this.viewer.scene.remove(root);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (material) (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
        if (o instanceof CSS2DObject) o.element.remove();
      });
      root.clear();
    }
  }

  /** 구조를 다시 계산했을 때 벽·붙박이 충돌체와 가구 배치를 새 평면도에 맞춘다. */
  setPlan(rp: ResolvedPlan): void {
    this.rp = rp;
    this.refresh();
  }

  /** 충돌 상태가 바뀔 때 UI가 다시 그리도록 알린다 */
  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  refresh(): void {
    this.collisions = findCollisions(this.store.items.map(toFootprint), this.rp.obstacles);
    this.layer.sync(this.store.items, this.collisions, this.store.selected);
    const sel = this.store.get(this.store.selected);
    this.gizmo.update(sel, !!sel && this.collisions.has(sel.uid));
    this.listeners.forEach((fn) => fn());
  }

  /**
   * 목록 카드에서 시작한 드래그. 움직이지 않고 떼면 화면 가운데에 놓는다.
   * 터치에서는 카드의 touch-action 방향으로 밀면 브라우저가 목록을 스크롤하고 pointercancel을 보낸다.
   */
  startCardDrag(def: FurnitureDef, e: PointerEvent, thumb: string | undefined): void {
    e.preventDefault();
    const pointerId = e.pointerId;
    const threshold = e.pointerType === 'touch' ? TOUCH_MOVE_THRESHOLD : MOVE_THRESHOLD;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let rot = 0;
    const draft = { typeId: def.id, w: def.w, d: def.d, h: def.h, color: def.color };
    const ghost = makeGhost(draft);
    ghost.visible = false;
    this.viewer.scene.add(ghost);
    const chip = document.createElement('div');
    chip.className = 'drag-chip';
    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb;
      chip.append(img);
    }
    chip.append(document.createTextNode(def.name));

    let placeAt: { x: number; z: number } | null = null;
    const update = (cx: number, cy: number, shift: boolean) => {
      chip.style.transform = `translate(${cx + 12}px, ${cy + 12}px)`;
      const inside = this.viewer.isInside(cx, cy);
      const p = inside ? this.viewer.floorPoint(cx, cy) : null;
      chip.style.display = p ? 'none' : '';
      ghost.visible = !!p;
      placeAt = null;
      if (!p) return;
      const spot = this.placeable({ uid: '__ghost', x: p.x, z: p.z, rot, w: def.w, d: def.d, flat: def.flat, model: def.model }, shift);
      placeAt = spot;
      ghost.position.set(spot.x, 0, spot.z);
      ghost.rotation.y = THREE.MathUtils.degToRad(rot);
      const hit = !def.flat && this.wouldCollide({ uid: '__ghost', ...spot, rot, w: def.w, d: def.d, model: def.model });
      setTint(ghost, hit ? '#ef4444' : '#22c55e', 0.35);
    };

    let lastX = startX;
    let lastY = startY;
    let lastShift = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      lastShift = ev.shiftKey;
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) > threshold) {
        active = true;
        document.body.append(chip);
        document.body.classList.add('dragging-card');
      }
      if (active) update(ev.clientX, ev.clientY, ev.shiftKey);
    };
    const key = (ev: KeyboardEvent) => {
      if (!active) return;
      if (ev.key === 'r' || ev.key === 'R') {
        rot = (rot + (ev.shiftKey ? 90 : 270)) % 360;
        update(lastX, lastY, lastShift);
        ev.preventDefault();
        ev.stopImmediatePropagation();
      } else if (ev.key === 'Escape') {
        active = false;
        placeAt = null;
        cleanup();
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      chip.remove();
      document.body.classList.remove('dragging-card');
      this.viewer.scene.remove(ghost);
      disposeModel(ghost);
    };
    // 브라우저가 터치를 목록 스크롤로 가져갔다. 아무것도 놓지 않는다.
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) cleanup();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const wasActive = active;
      cleanup();
      if (wasActive) {
        if (placeAt) this.place(def, placeAt.x, placeAt.z, rot);
      } else if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= threshold) {
        const c = this.viewer.centerFloorPoint();
        const spot = this.placeable(
          { uid: '__ghost', x: c.x, z: c.z, rot: 0, w: def.w, d: def.d, flat: def.flat, model: def.model },
          false,
        );
        this.place(def, spot.x, spot.z, 0);
      }
    };
    window.addEventListener('pointermove', move, { signal: this.abort.signal });
    window.addEventListener('pointerup', up, { signal: this.abort.signal });
    window.addEventListener('pointercancel', cancel, { signal: this.abort.signal });
    window.addEventListener('keydown', key, { capture: true, signal: this.abort.signal });
  }

  rotateSelected(delta: number): void {
    const item = this.store.get(this.store.selected);
    if (item) this.store.update(item.uid, { rot: Math.round(item.rot + delta) });
  }

  private place(def: FurnitureDef, x: number, z: number, rot: number): void {
    this.store.add({
      typeId: def.id,
      name: def.name,
      x: Math.round(x),
      z: Math.round(z),
      rot,
      w: def.w,
      d: def.d,
      h: def.h,
      color: def.color,
    });
  }

  /** 1cm 격자에 맞추고, Shift가 아니면 벽면에 붙인다 */
  private placeable(f: Footprint, free: boolean): { x: number; z: number } {
    let x = Math.round(f.x);
    let z = Math.round(f.z);
    if (!free && !f.flat) {
      const others = this.store.items
        .map(toFootprint)
        .filter((o) => o.uid !== f.uid && !o.flat && !canOverlap(o, f))
        .map(footprintRect);
      const { dx, dz } = magnetOffset({ ...f, x, z }, [...this.rp.obstacles, ...others], 10);
      x = Math.round(x + dx);
      z = Math.round(z + dz);
    }
    return { x, z };
  }

  private wouldCollide(f: Footprint): boolean {
    const rect = footprintRect(f);
    if (this.rp.obstacles.some((o) => obbOverlap(rect, o))) return true;
    return this.store.items
      .map(toFootprint)
      .some((o) => o.uid !== f.uid && !o.flat && !canOverlap(o, f) && obbOverlap(rect, footprintRect(o)));
  }

  private pickItem(e: PointerEvent): string | null {
    const hits = this.viewer.pick(e.clientX, e.clientY, this.layer.pickables);
    return (hits[0]?.object.userData.uid as string | undefined) ?? null;
  }

  private setControls(enabled: boolean): void {
    this.viewer.activeControls.enabled = enabled;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.target !== this.viewer.renderer.domElement || e.button !== 0) return;
    const ringHits = this.viewer.pick(e.clientX, e.clientY, this.gizmo.ringTargets);
    const sel = this.store.get(this.store.selected);
    if (sel && this.gizmo.isRingHit(ringHits)) {
      const p = this.viewer.floorPoint(e.clientX, e.clientY);
      if (p) {
        this.store.begin();
        this.mode = {
          kind: 'rotate',
          uid: sel.uid,
          startAngle: angleAround(sel.x, sel.z, p),
          startRot: sel.rot,
          pointerId: e.pointerId,
        };
        this.setControls(false);
        document.body.classList.add('rotating');
        return;
      }
    }
    const uid = this.pickItem(e);
    if (uid) {
      const item = this.store.get(uid)!;
      this.store.select(uid);
      const p = this.viewer.floorPoint(e.clientX, e.clientY);
      if (p) {
        this.store.begin();
        this.mode = { kind: 'move', uid, dx: item.x - p.x, dz: item.z - p.z, pointerId: e.pointerId };
        this.setControls(false);
        document.body.classList.add('moving');
      }
      return;
    }
    this.mode = { kind: 'empty', x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  }

  private onPointerMove(e: PointerEvent): void {
    const m = this.mode;
    if (m.kind === 'move' && e.pointerId === m.pointerId) {
      const item = this.store.get(m.uid);
      const p = this.viewer.floorPoint(e.clientX, e.clientY);
      if (!item || !p) return;
      const spot = this.placeable({ ...toFootprint(item), x: p.x + m.dx, z: p.z + m.dz }, e.shiftKey);
      if (spot.x !== item.x || spot.z !== item.z) this.store.patch(m.uid, spot);
    } else if (m.kind === 'rotate' && e.pointerId === m.pointerId) {
      const item = this.store.get(m.uid);
      const p = this.viewer.floorPoint(e.clientX, e.clientY);
      if (!item || !p) return;
      const delta = THREE.MathUtils.radToDeg(angleAround(item.x, item.z, p) - m.startAngle);
      let rot = m.startRot + delta;
      rot = e.shiftKey ? Math.round(rot) : Math.round(rot / 15) * 15;
      if (rot !== item.rot) this.store.patch(m.uid, { rot });
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const m = this.mode;
    if (m.kind === 'idle' || e.pointerId !== m.pointerId) return;
    if (m.kind === 'move' || m.kind === 'rotate') {
      this.store.end();
      this.setControls(true);
      document.body.classList.remove('moving', 'rotating');
    } else if (m.kind === 'empty' && Math.hypot(e.clientX - m.x, e.clientY - m.y) <= MOVE_THRESHOLD) {
      this.store.select(null);
    }
    this.mode = { kind: 'idle' };
  }

  private onHover(e: PointerEvent): void {
    if (this.mode.kind !== 'idle') return;
    const canvas = this.viewer.renderer.domElement;
    const ring = this.gizmo.isRingHit(this.viewer.pick(e.clientX, e.clientY, this.gizmo.ringTargets));
    canvas.style.cursor = ring ? 'grab' : this.pickItem(e) ? 'move' : '';
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      this.store.redo();
      return;
    }
    const item = this.store.get(this.store.selected);
    if (!item) return;
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.store.remove(item.uid);
        return;
      case 'Escape':
        this.store.select(null);
        return;
      case 'r':
      case 'R':
        // R: 시계 방향 90°, Shift+R: 반시계 90°
        this.rotateSelected(e.shiftKey ? 90 : -90);
        return;
      case 'q':
      case 'Q':
        this.rotateSelected(15);
        return;
      case 'e':
      case 'E':
        this.rotateSelected(-15);
        return;
      case 'd':
      case 'D':
        if (mod) {
          e.preventDefault();
          this.store.duplicate(item.uid);
        }
        return;
    }
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const arrow = arrows[e.key];
    if (!arrow) return;
    e.preventDefault();
    // 화면 기준 위/아래/좌/우를 가장 가까운 평면도 축으로 맞춘다
    const forward = new THREE.Vector3();
    this.viewer.camera.getWorldDirection(forward);
    if (this.viewer.mode === 'plan') forward.set(0, 0, -1);
    forward.y = 0;
    if (Math.abs(forward.x) > Math.abs(forward.z)) forward.set(Math.sign(forward.x), 0, 0);
    else forward.set(0, 0, Math.sign(forward.z) || -1);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const step = e.shiftKey ? 10 : 1;
    const dx = (forward.x * arrow[1] + right.x * arrow[0]) * step;
    const dz = (forward.z * arrow[1] + right.z * arrow[0]) * step;
    this.store.update(item.uid, { x: item.x + dx, z: item.z + dz });
  }
}
