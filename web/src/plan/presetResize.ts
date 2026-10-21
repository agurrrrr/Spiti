import { buildPresetPlan, PRESETS, type PresetSpec } from './presets';

export { buildPresetPlan };
export type { PresetSpec };

/** 방 종류별 최소 크기(cm). 격자 경계를 움직여도 이 값 아래로 내려가지 않는다. */
export const ROOM_MIN = {
  bath: { width: 120, depth: 150 },
  bed: { width: 180, depth: 210 },
  living: { width: 240, depth: 240 },
  kitchen: { width: 150, depth: 150 },
  dining: { width: 150, depth: 150 },
  hall: { width: 90, depth: 90 },
  foyer: { width: 90, depth: 90 },
  utility: { width: 90, depth: 90 },
  dress: { width: 90, depth: 90 },
  study: { width: 180, depth: 180 },
  balcony: { width: 90, depth: 90 },
} as const;

/** 방 하나가 차지하지 않는 열·행도 이 정도는 남긴다. 0cm 벽이나 붙박이 오류를 막는다. */
export const AXIS_MIN = 60;

/** 전체 구조의 폭·깊이 허용 범위(cm) */
export const TOTAL_MIN = 300;
export const TOTAL_MAX = 1600;

/** 기본 이동 단위(cm). Shift를 누르면 1cm까지 허용한다. */
export const DEFAULT_STEP = 5;

export type OuterEdge = 'right' | 'bottom';
export type ResizeAxis = 'column' | 'row';

interface AxisRange {
  min: number;
  max: number;
}

function minFor(room: string): { width: number; depth: number } {
  if (room.startsWith('bath')) return ROOM_MIN.bath;
  if (room.startsWith('bed')) return ROOM_MIN.bed;
  if (room === 'kitchen') return ROOM_MIN.kitchen;
  if (room === 'dining') return ROOM_MIN.dining;
  if (room === 'hall') return ROOM_MIN.hall;
  if (room === 'foyer') return ROOM_MIN.foyer;
  if (room === 'utility') return ROOM_MIN.utility;
  if (room === 'dress') return ROOM_MIN.dress;
  if (room === 'study') return ROOM_MIN.study;
  if (room === 'balcony') return ROOM_MIN.balcony;
  return ROOM_MIN.living;
}

function roomRanges(spec: PresetSpec): Map<string, { cols: AxisRange; rows: AxisRange }> {
  const out = new Map<string, { cols: AxisRange; rows: AxisRange }>();
  for (const cell of spec.cells) {
    const current = out.get(cell.room) ?? {
      cols: { min: cell.col, max: cell.col + cell.colSpan - 1 },
      rows: { min: cell.row, max: cell.row + cell.rowSpan - 1 },
    };
    current.cols.min = Math.min(current.cols.min, cell.col);
    current.cols.max = Math.max(current.cols.max, cell.col + cell.colSpan - 1);
    current.rows.min = Math.min(current.rows.min, cell.row);
    current.rows.max = Math.max(current.rows.max, cell.row + cell.rowSpan - 1);
    out.set(cell.room, current);
  }
  return out;
}

function spanSum(sizes: number[], range: AxisRange): number {
  let sum = 0;
  for (let i = range.min; i <= range.max; i++) sum += sizes[i];
  return sum;
}

export function cloneSpec(spec: PresetSpec): PresetSpec {
  return {
    ...spec,
    columns: spec.columns.slice(),
    rows: spec.rows.slice(),
    cells: spec.cells.map((cell) => ({ ...cell })),
  };
}

export function sameSpec(a: PresetSpec, b: PresetSpec): boolean {
  if (
    a.kind !== b.kind ||
    a.rooms !== b.rooms ||
    a.baths !== b.baths ||
    a.width !== b.width ||
    a.depth !== b.depth ||
    a.columns.length !== b.columns.length ||
    a.rows.length !== b.rows.length
  ) {
    return false;
  }
  for (let i = 0; i < a.columns.length; i++) if (a.columns[i] !== b.columns[i]) return false;
  for (let i = 0; i < a.rows.length; i++) if (a.rows[i] !== b.rows[i]) return false;
  return true;
}

function roundTo(delta: number, step: number): number {
  const unit = Number.isFinite(step) && step > 0 ? step : DEFAULT_STEP;
  return Math.round(delta / unit) * unit;
}

/** 하한은 위로, 상한은 아래로 맞춰 이동 단위를 지키면서 허용 범위를 넘지 않게 한다. */
function clampDelta(delta: number, low: number, high: number, step: number): number {
  if (!Number.isFinite(low)) low = -Infinity;
  if (!Number.isFinite(high)) high = Infinity;
  if (low > high) return 0;
  let d = delta;
  if (Number.isFinite(high)) d = Math.min(d, Math.floor(high / step) * step);
  if (Number.isFinite(low)) d = Math.max(d, Math.ceil(low / step) * step);
  if (d < low || d > high) return 0;
  return d;
}

function resizeAxis(
  spec: PresetSpec,
  axis: ResizeAxis,
  boundaryIndex: number,
  deltaCm: number,
  step: number,
): PresetSpec {
  const sizes = axis === 'column' ? spec.columns : spec.rows;
  if (!Number.isInteger(boundaryIndex) || boundaryIndex < 0 || boundaryIndex >= sizes.length - 1) return spec;
  if (!Number.isFinite(deltaCm)) return spec;

  const delta = roundTo(deltaCm, step);
  if (delta === 0) return spec;

  const ranges = roomRanges(spec);
  let low = -Infinity;
  let high = Infinity;

  for (const [room, range] of ranges) {
    const span = axis === 'column' ? range.cols : range.rows;
    const min = axis === 'column' ? minFor(room).width : minFor(room).depth;
    const size = spanSum(sizes, span);
    const includesLeft = span.min <= boundaryIndex && boundaryIndex <= span.max;
    const includesRight = span.min <= boundaryIndex + 1 && boundaryIndex + 1 <= span.max;
    if (includesRight && !includesLeft) {
      // 오른쪽 칸이 줄어들면 이 방도 줄어든다
      high = Math.min(high, size - min);
    } else if (includesLeft && !includesRight) {
      // 왼쪽 칸이 줄어들면 이 방도 줄어든다
      low = Math.max(low, min - size);
    }
  }

  const left = sizes[boundaryIndex];
  const right = sizes[boundaryIndex + 1];
  low = Math.max(low, AXIS_MIN - left);
  high = Math.min(high, right - AXIS_MIN);

  const move = clampDelta(delta, low, high, step);
  if (move === 0) return spec;

  const next = cloneSpec(spec);
  if (axis === 'column') {
    next.columns[boundaryIndex] = left + move;
    next.columns[boundaryIndex + 1] = right - move;
    next.width = next.columns.reduce((sum, value) => sum + value, 0);
  } else {
    next.rows[boundaryIndex] = left + move;
    next.rows[boundaryIndex + 1] = right - move;
    next.depth = next.rows.reduce((sum, value) => sum + value, 0);
  }
  return next;
}

/** 열 경계(columns[index]와 columns[index+1] 사이)를 deltaCm만큼 움직인다. 전체 폭은 그대로다. */
export function resizeColumn(spec: PresetSpec, boundaryIndex: number, deltaCm: number, step = DEFAULT_STEP): PresetSpec {
  return resizeAxis(spec, 'column', boundaryIndex, deltaCm, step);
}

/** 행 경계(rows[index]와 rows[index+1] 사이)를 deltaCm만큼 움직인다. 전체 깊이는 그대로다. */
export function resizeRow(spec: PresetSpec, boundaryIndex: number, deltaCm: number, step = DEFAULT_STEP): PresetSpec {
  return resizeAxis(spec, 'row', boundaryIndex, deltaCm, step);
}

/** 바깥 오른쪽·아래 경계를 움직여 마지막 열·행과 전체 폭·깊이를 함께 바꾼다. */
export function resizeOuter(spec: PresetSpec, edge: OuterEdge, deltaCm: number, step = DEFAULT_STEP): PresetSpec {
  if (edge !== 'right' && edge !== 'bottom') return spec;
  if (!Number.isFinite(deltaCm)) return spec;

  const delta = roundTo(deltaCm, step);
  if (delta === 0) return spec;

  const isColumn = edge === 'right';
  const sizes = isColumn ? spec.columns : spec.rows;
  const last = sizes.length - 1;
  if (last < 0) return spec;
  const total = isColumn ? spec.width : spec.depth;
  const axisName: ResizeAxis = isColumn ? 'column' : 'row';

  let low = TOTAL_MIN - total;
  let high = TOTAL_MAX - total;
  low = Math.max(low, AXIS_MIN - sizes[last]);

  const ranges = roomRanges(spec);
  for (const [room, range] of ranges) {
    const span = isColumn ? range.cols : range.rows;
    if (span.max !== last) continue;
    const size = spanSum(sizes, span);
    const min = isColumn ? minFor(room).width : minFor(room).depth;
    low = Math.max(low, min - size);
  }

  const move = clampDelta(delta, low, high, step);
  if (move === 0) return spec;

  const next = cloneSpec(spec);
  const nextSizes = axisName === 'column' ? next.columns : next.rows;
  nextSizes[last] = sizes[last] + move;
  if (isColumn) next.width = next.columns.reduce((sum, value) => sum + value, 0);
  else next.depth = next.rows.reduce((sum, value) => sum + value, 0);
  return next;
}

/** 프리셋의 처음 격자로 되돌린다. */
export function resetPreset(spec: PresetSpec): PresetSpec {
  const entry = PRESETS[spec.kind];
  return cloneSpec(entry ? entry.spec : spec);
}
