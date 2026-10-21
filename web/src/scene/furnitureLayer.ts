import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { catalogById } from '../furniture/catalog';
import { buildModel, disposeModel } from '../furniture/models';
import type { PlacedItem } from '../state/layout';

interface Entry {
  root: THREE.Group;
  key: string;
  label: CSS2DObject;
  labelKey: string;
}

const modelKey = (i: PlacedItem) => `${i.typeId}|${i.w}|${i.d}|${i.h}|${i.color}`;

export function setTint(root: THREE.Object3D, color: THREE.ColorRepresentation | null, intensity = 0.45): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (!sm.emissive) continue;
      if (color === null) {
        sm.emissive.setRGB(0, 0, 0);
        sm.emissiveIntensity = 1;
      } else {
        sm.emissive.set(color);
        sm.emissiveIntensity = intensity;
      }
    }
  });
}

export function makeGhost(item: Pick<PlacedItem, 'typeId' | 'w' | 'd' | 'h' | 'color'>): THREE.Group {
  const def = catalogById.get(item.typeId);
  const g = buildModel(def?.model ?? 'box', item, item.color);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    m.transparent = true;
    m.opacity = 0.6;
    m.depthWrite = false;
    mesh.castShadow = false;
  });
  return g;
}

/**
 * 배치 상태(PlacedItem 목록)를 3D 오브젝트로 옮긴다. 치수나 색이 바뀐 가구만 모델을 다시 만든다.
 * 가구마다 이름(과 메모) 라벨을 윗면 가운데에 띄운다. 평면도 화면에서는 가구 한가운데에 보인다.
 */
export class FurnitureLayer {
  readonly group = new THREE.Group();
  private readonly labels = new THREE.Group();
  private readonly entries = new Map<string, Entry>();

  constructor() {
    this.group.add(this.labels);
  }

  /** selected: 선택한 가구는 SelectionGizmo가 따로 라벨을 그리므로 이 라벨을 숨긴다 */
  sync(items: PlacedItem[], collisions: Set<string>, selected: string | null = null): void {
    const alive = new Set(items.map((i) => i.uid));
    for (const [uid, e] of this.entries) {
      if (!alive.has(uid)) {
        this.group.remove(e.root);
        this.labels.remove(e.label);
        disposeModel(e.root);
        this.entries.delete(uid);
      }
    }
    for (const item of items) {
      let e = this.entries.get(item.uid);
      const key = modelKey(item);
      if (!e || e.key !== key) {
        if (e) {
          this.group.remove(e.root);
          disposeModel(e.root);
        }
        const def = catalogById.get(item.typeId);
        const root = new THREE.Group();
        root.add(buildModel(def?.model ?? 'box', item, item.color));
        root.userData.uid = item.uid;
        root.traverse((o) => (o.userData.uid = item.uid));
        this.group.add(root);
        if (e) {
          e.root = root;
          e.key = key;
        } else {
          const label = new CSS2DObject(document.createElement('div'));
          label.element.className = 'furniture-label';
          this.labels.add(label);
          e = { root, key, label, labelKey: '' };
          this.entries.set(item.uid, e);
        }
      }
      e.root.position.set(item.x, 0, item.z);
      e.root.rotation.y = THREE.MathUtils.degToRad(item.rot);
      setTint(e.root, collisions.has(item.uid) ? '#ef4444' : null);
      this.updateLabel(e, item, item.uid === selected);
    }
  }

  setLabelsVisible(on: boolean): void {
    // CSS2DRenderer는 보이지 않는 부모 아래 라벨을 알아서 숨긴다
    this.labels.visible = on;
  }

  get pickables(): THREE.Object3D[] {
    return [...this.entries.values()].map((e) => e.root);
  }

  private updateLabel(e: Entry, item: PlacedItem, selected: boolean): void {
    e.label.visible = !selected;
    e.label.position.set(item.x, item.h, item.z);
    const labelKey = `${item.name}|${item.note ?? ''}`;
    if (labelKey === e.labelKey) return;
    e.labelKey = labelKey;
    const name = document.createElement('b');
    name.textContent = item.name;
    e.label.element.replaceChildren(name);
    if (item.note) {
      const note = document.createElement('span');
      note.textContent = item.note;
      e.label.element.append(note);
    }
  }
}

/** 선택한 가구 둘레의 바닥 윤곽선, 회전 링, 치수 라벨 */
export class SelectionGizmo {
  readonly group = new THREE.Group();
  readonly ringPick: THREE.Mesh;
  private readonly outline: THREE.LineLoop;
  private readonly ring: THREE.Mesh;
  private readonly handle: THREE.Mesh;
  private readonly label: CSS2DObject;
  private readonly labelEl = document.createElement('div');
  private readonly outlineMat = new THREE.LineBasicMaterial({ color: '#2563eb', depthTest: false });
  private readonly ringMat = new THREE.MeshBasicMaterial({
    color: '#2563eb',
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  private sizeKey = '';

  constructor() {
    this.outline = new THREE.LineLoop(new THREE.BufferGeometry(), this.outlineMat);
    this.outline.renderOrder = 10;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.1, 72), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 10;
    this.ringPick = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.1, 48),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
    );
    this.ringPick.rotation.x = -Math.PI / 2;
    this.handle = new THREE.Mesh(
      new THREE.SphereGeometry(5, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#2563eb', depthTest: false }),
    );
    this.handle.renderOrder = 11;
    this.labelEl.className = 'item-label';
    this.label = new CSS2DObject(this.labelEl);
    this.group.add(this.outline, this.ring, this.ringPick, this.handle, this.label);
    this.group.visible = false;
  }

  update(item: PlacedItem | undefined, colliding: boolean): void {
    if (!item) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const key = `${item.w}|${item.d}`;
    const radius = Math.hypot(item.w, item.d) / 2 + 16;
    if (key !== this.sizeKey) {
      this.sizeKey = key;
      // 가구 테두리와 겹치지 않게 4cm 바깥에 그린다
      const hw = item.w / 2 + 4;
      const hd = item.d / 2 + 4;
      this.outline.geometry.dispose();
      this.outline.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, 1, -hd),
        new THREE.Vector3(hw, 1, -hd),
        new THREE.Vector3(hw, 1, hd),
        new THREE.Vector3(-hw, 1, hd),
      ]);
      this.ring.geometry.dispose();
      this.ring.geometry = new THREE.RingGeometry(radius - 2.5, radius + 2.5, 96);
      this.ringPick.geometry.dispose();
      this.ringPick.geometry = new THREE.RingGeometry(radius - 14, radius + 14, 48);
    }
    this.ring.position.y = 1.2;
    this.ringPick.position.y = 1.2;
    this.handle.position.set(0, 1.5, radius);
    this.label.position.set(0, item.h + 12, 0);
    this.group.position.set(item.x, 0, item.z);
    this.group.rotation.y = THREE.MathUtils.degToRad(item.rot);
    const color = colliding ? '#ef4444' : '#2563eb';
    this.outlineMat.color.set(color);
    this.ringMat.color.set(color);
    (this.handle.material as THREE.MeshBasicMaterial).color.set(color);
    const note = item.note ? ` · ${item.note}` : '';
    this.labelEl.textContent = `${item.name}${note} · ${item.w}×${item.d}×${item.h} · ${Math.round(item.rot)}°`;
    this.labelEl.classList.toggle('warn', colliding);
  }

  isRingHit(objects: THREE.Intersection[]): boolean {
    return objects.some((h) => h.object === this.ringPick || h.object === this.handle);
  }

  get ringTargets(): THREE.Object3D[] {
    return this.group.visible ? [this.ringPick, this.handle] : [];
  }
}
