import { normalizeDeg } from '../plan/geometry';

export interface PlacedItem {
  uid: string;
  typeId: string;
  name: string;
  /** 바닥 중심 (평면도 cm 좌표) */
  x: number;
  z: number;
  /** 도 단위, 위에서 볼 때 반시계 방향 */
  rot: number;
  w: number;
  d: number;
  h: number;
  color: string;
  /** 가구 라벨에 이름 아래 한 줄로 붙는 메모 (예: 분해 후 이동). 없으면 이름만 보인다. */
  note?: string;
}

/** 이름과 메모 최대 길이. 편집 패널과 파일 가져오기가 같은 값을 쓴다. */
export const NAME_MAX = 30;
export const NOTE_MAX = 40;

/** 가구 치수 허용 범위 (cm). 편집 패널과 파일 가져오기가 같은 범위를 쓴다. */
export const DIM_LIMITS = { w: [5, 600], d: [5, 600], h: [1, 300] } as const satisfies Record<
  'w' | 'd' | 'h',
  readonly [number, number]
>;

export type LayoutEvent = { type: 'items' } | { type: 'selection' };

type Listener = (e: LayoutEvent) => void;

const HISTORY_LIMIT = 100;

let uidCounter = 0;
export const newUid = () => `f${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

/**
 * 배치 상태. 모든 변경은 transaction 또는 begin/end 사이에서 일어나야 되돌리기 기록에 남는다.
 * MVP는 계정 없이 브라우저 localStorage에만 저장한다.
 */
export class LayoutStore {
  items: PlacedItem[] = [];
  selected: string | null = null;
  private readonly listeners = new Set<Listener>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private pending: string | null = null;

  constructor(private readonly storageKey: string | null) {
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) this.items = (JSON.parse(raw) as PlacedItem[]).filter((i) => typeof i.uid === 'string');
      } catch {
        this.items = [];
      }
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(uid: string | null): PlacedItem | undefined {
    return uid ? this.items.find((i) => i.uid === uid) : undefined;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  select(uid: string | null): void {
    if (this.selected === uid) return;
    this.selected = uid;
    this.emit({ type: 'selection' });
  }

  /** 드래그처럼 여러 번 나눠 바뀌는 변경의 시작 */
  begin(): void {
    this.pending ??= this.snapshot();
  }

  /** begin 이후 바뀐 것이 있으면 한 번의 되돌리기 단위로 기록한다 */
  end(): void {
    if (this.pending === null) return;
    const before = this.pending;
    this.pending = null;
    if (before !== this.snapshot()) this.record(before);
  }

  transaction(fn: () => void): void {
    const before = this.snapshot();
    fn();
    if (before !== this.snapshot()) this.record(before);
    this.emit({ type: 'items' });
  }

  add(item: Omit<PlacedItem, 'uid'> & { uid?: string }, select = true): PlacedItem {
    const placed: PlacedItem = { ...item, uid: item.uid ?? newUid(), rot: normalizeDeg(item.rot) };
    this.transaction(() => this.items.push(placed));
    if (select) this.select(placed.uid);
    return placed;
  }

  /** 기록 없이 즉시 반영. begin/end 또는 transaction 안에서 쓴다. */
  patch(uid: string, patch: Partial<Omit<PlacedItem, 'uid'>>): void {
    const item = this.get(uid);
    if (!item) return;
    Object.assign(item, patch);
    if (patch.rot !== undefined) item.rot = normalizeDeg(item.rot);
    this.emit({ type: 'items' });
  }

  update(uid: string, patch: Partial<Omit<PlacedItem, 'uid'>>): void {
    this.transaction(() => this.patch(uid, patch));
  }

  remove(uid: string): void {
    this.transaction(() => {
      this.items = this.items.filter((i) => i.uid !== uid);
    });
    if (this.selected === uid) this.select(null);
  }

  duplicate(uid: string): PlacedItem | undefined {
    const src = this.get(uid);
    if (!src) return undefined;
    const { uid: _uid, ...rest } = src;
    void _uid;
    return this.add({ ...rest, x: src.x + 20, z: src.z + 20 });
  }

  clear(): void {
    this.replaceAll([]);
  }

  /**
   * 되돌리기 기록 없이 배치를 고친다. 구조를 바꾼 뒤 가구 중심을 새 외곽 안으로 옮길 때 쓴다.
   * 콜백이 true를 돌려주면 localStorage에도 바로 반영한다.
   */
  adjustWithoutHistory(fn: (items: PlacedItem[]) => boolean): void {
    if (!fn(this.items)) return;
    this.persist();
    this.emit({ type: 'items' });
  }

  /** 배치를 통째로 바꾼다 (파일 가져오기). 되돌리기 한 번으로 이전 배치로 돌아간다. */
  replaceAll(items: PlacedItem[]): void {
    this.select(null);
    this.transaction(() => {
      this.items = items.map((i) => ({ ...i }));
    });
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  private restore(snapshot: string): void {
    this.items = JSON.parse(snapshot) as PlacedItem[];
    this.persist();
    this.emit({ type: 'items' });
    if (this.selected && !this.get(this.selected)) this.select(null);
  }

  private record(before: string): void {
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.persist();
  }

  private snapshot(): string {
    return JSON.stringify(this.items);
  }

  private persist(): void {
    if (!this.storageKey) return;
    try {
      localStorage.setItem(this.storageKey, this.snapshot());
    } catch {
      // 저장 공간이 없으면 메모리 상태만 유지한다
    }
  }

  private emit(e: LayoutEvent): void {
    this.listeners.forEach((fn) => fn(e));
  }
}
