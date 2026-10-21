import * as THREE from 'three';
import type { Viewer } from '../scene/viewer';
import {
  cloneSpec,
  DEFAULT_STEP,
  resetPreset,
  resizeColumn,
  resizeRow,
  resizeOuter,
  sameSpec,
  type PresetSpec,
} from './presetResize';

type HandleKind = 'column' | 'row' | 'outer-right' | 'outer-bottom';

interface HandleTarget {
  kind: HandleKind;
  /** 열·행 경계 인덱스. 바깥 손잡이는 쓰지 않는다. */
  index: number;
}

interface Drag {
  target: HandleTarget;
  pointerId: number;
  startX: number;
  startZ: number;
  base: PresetSpec;
}

export interface StructureEditorDeps {
  /** 드래그 중 매 프레임 구조를 적용한다. save는 pointerup처럼 확정할 때만 true다. */
  onApply: (spec: PresetSpec, save: boolean) => void;
}

const HANDLE_SIZE = 24;
const HANDLE_COLOR = '#2563eb';

/**
 * 평면도 모드에서 프리셋 격자 경계를 끌어 방 크기를 바꾸는 손잡이.
 * 내부 열·행 경계는 양쪽 칸 크기를 맞바꾸고, 오른쪽·아래 바깥 손잡이는 전체 폭·깊이를 바꾼다.
 */
export class StructureEditor {
  readonly group = new THREE.Group();
  private current: PresetSpec;
  private readonly handles: THREE.Mesh[] = [];
  private readonly material = new THREE.MeshBasicMaterial({
    color: HANDLE_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.9,
  });
  private readonly label = document.createElement('div');
  private drag: Drag | null = null;
  private pendingPointer: { x: number; y: number; shift: boolean } | null = null;
  private raf = 0;
  private readonly stopFrame: () => void;
  private readonly abort = new AbortController();

  constructor(
    private readonly viewer: Viewer,
    spec: PresetSpec,
    private readonly deps: StructureEditorDeps,
  ) {
    this.current = cloneSpec(spec);
    this.group.name = 'structure-handles';
    this.label.className = 'structure-dim';
    this.label.hidden = true;
    viewer.container.append(this.label);
    viewer.scene.add(this.group);
    this.rebuildHandles();
    this.stopFrame = viewer.onFrame(() => {
      this.group.visible = viewer.mode === 'plan';
    });

    const signal = this.abort.signal;
    // Interaction보다 먼저 등록해 손잡이 클릭을 가구 조작으로 넘기지 않는다
    viewer.container.addEventListener('pointerdown', (e) => this.onPointerDown(e), { capture: true, signal });
    viewer.container.addEventListener('pointermove', (e) => this.onHover(e), { signal });
    window.addEventListener('pointermove', (e) => this.onPointerMove(e), { capture: true, signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { capture: true, signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), { capture: true, signal });
  }

  get spec(): PresetSpec {
    return this.current;
  }

  /** 바깥에서 구조를 적용했을 때 손잡이 위치를 새 격자에 맞춘다. */
  setSpec(spec: PresetSpec): void {
    if (sameSpec(this.current, spec)) return;
    this.current = cloneSpec(spec);
    this.rebuildHandles();
  }

  /** 드래그 없이 구조를 한 번에 적용한다 (브라우저 검증·기본값 복원). */
  apply(spec: PresetSpec): void {
    this.deps.onApply(spec, true);
  }

  reset(): void {
    this.deps.onApply(resetPreset(this.current), true);
  }

  dispose(): void {
    this.abort.abort();
    this.stopFrame();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.releaseDrag();
    this.label.remove();
    this.viewer.scene.remove(this.group);
    for (const mesh of this.handles) mesh.geometry.dispose();
    this.handles.length = 0;
    this.group.clear();
    this.material.dispose();
  }

  private rebuildHandles(): void {
    for (const mesh of this.handles) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.handles.length = 0;

    const { columns, rows, width, depth } = this.current;
    let x = 0;
    for (let i = 0; i < columns.length - 1; i++) {
      x += columns[i];
      this.addHandle('column', i, x, depth / 2);
    }
    let y = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      y += rows[i];
      this.addHandle('row', i, width / 2, y);
    }
    this.addHandle('outer-right', -1, width, depth / 2);
    this.addHandle('outer-bottom', -1, width / 2, depth);
  }

  private addHandle(kind: HandleKind, index: number, x: number, y: number): void {
    const geometry = new THREE.BoxGeometry(HANDLE_SIZE, 4, HANDLE_SIZE);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(x, 6, y);
    mesh.renderOrder = 1000;
    mesh.userData.handle = { kind, index } satisfies HandleTarget;
    this.handles.push(mesh);
    this.group.add(mesh);
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this.viewer.mode !== 'plan') return;
    if (e.target !== this.viewer.renderer.domElement) return;
    const hit = this.viewer.pick(e.clientX, e.clientY, this.handles)[0];
    const target = hit?.object.userData.handle as HandleTarget | undefined;
    if (!target) return;
    const p = this.viewer.floorPoint(e.clientX, e.clientY);
    if (!p) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this.drag = {
      target,
      pointerId: e.pointerId,
      startX: p.x,
      startZ: p.z,
      base: cloneSpec(this.current),
    };
    this.viewer.controlsPlan.enabled = false;
    try {
      this.viewer.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // 합성 이벤트처럼 활성 포인터가 아닌 경우에도 드래그 자체는 계속한다
    }
    document.body.classList.add('resizing-structure');
    this.showLabel(e.clientX, e.clientY);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    e.preventDefault();
    this.pendingPointer = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.flush();
    });
  }

  private flush(): void {
    const drag = this.drag;
    const pending = this.pendingPointer;
    if (!drag || !pending) return;
    this.pendingPointer = null;

    const p = this.viewer.floorPoint(pending.x, pending.y);
    if (!p) return;
    const step = pending.shift ? 1 : DEFAULT_STEP;
    const { target, base } = drag;
    let next: PresetSpec;
    if (target.kind === 'column') {
      next = resizeColumn(base, target.index, p.x - drag.startX, step);
    } else if (target.kind === 'row') {
      next = resizeRow(base, target.index, p.z - drag.startZ, step);
    } else if (target.kind === 'outer-right') {
      next = resizeOuter(base, 'right', p.x - drag.startX, step);
    } else {
      next = resizeOuter(base, 'bottom', p.z - drag.startZ, step);
    }

    if (!sameSpec(next, this.current)) this.deps.onApply(next, false);
    this.updateLabel(next);
    this.moveLabel(pending.x, pending.y);
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.flush();
    const spec = this.current;
    this.releaseDrag();
    this.deps.onApply(spec, true);
  }

  private releaseDrag(): void {
    if (!this.drag) return;
    const canvas = this.viewer.renderer.domElement;
    if (canvas.hasPointerCapture(this.drag.pointerId)) canvas.releasePointerCapture(this.drag.pointerId);
    this.drag = null;
    this.pendingPointer = null;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.viewer.controlsPlan.enabled = this.viewer.mode === 'plan';
    document.body.classList.remove('resizing-structure');
    this.label.hidden = true;
  }

  private onHover(e: PointerEvent): void {
    if (this.drag || this.viewer.mode !== 'plan') return;
    const hit = this.viewer.pick(e.clientX, e.clientY, this.handles)[0];
    const target = hit?.object.userData.handle as HandleTarget | undefined;
    if (!target) return;
    this.viewer.renderer.domElement.style.cursor =
      target.kind === 'column' || target.kind === 'outer-right' ? 'ew-resize' : 'ns-resize';
  }

  private showLabel(clientX: number, clientY: number): void {
    this.label.hidden = false;
    this.updateLabel(this.current);
    this.moveLabel(clientX, clientY);
  }

  private moveLabel(clientX: number, clientY: number): void {
    const rect = this.viewer.container.getBoundingClientRect();
    this.label.style.left = `${clientX - rect.left + 16}px`;
    this.label.style.top = `${clientY - rect.top + 16}px`;
  }

  private updateLabel(spec: PresetSpec): void {
    const drag = this.drag;
    if (!drag) return;
    const { target, base } = drag;
    let text: string;
    if (target.kind === 'column') {
      text = `열 ${target.index + 1} ${Math.round(base.columns[target.index])} → ${Math.round(spec.columns[target.index])}cm`;
    } else if (target.kind === 'row') {
      text = `행 ${target.index + 1} ${Math.round(base.rows[target.index])} → ${Math.round(spec.rows[target.index])}cm`;
    } else if (target.kind === 'outer-right') {
      text = `폭 ${Math.round(base.width)} → ${Math.round(spec.width)}cm`;
    } else {
      text = `깊이 ${Math.round(base.depth)} → ${Math.round(spec.depth)}cm`;
    }
    this.label.textContent = text;
  }
}
