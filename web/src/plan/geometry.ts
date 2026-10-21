import type { OBB, Vec2 } from '../types';

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const length = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2): number => length(sub(a, b));

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l];
}

/** 방향 벡터에 수직인 벡터. 화면(y 아래) 기준으로 진행 방향의 오른쪽이다. */
export const perp = (d: Vec2): Vec2 => [-d[1], d[0]];

/** 부호 있는 넓이 (cm²). 화면 좌표(y 아래)에서 시계 방향이면 양수. */
export function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const polygonArea = (poly: Vec2[]): number => Math.abs(signedArea(poly));

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** 짝홀 규칙. 경계 위의 점은 어느 쪽이든 될 수 있으니 판정용 점은 경계에서 조금 떨어뜨려서 넘긴다. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function bounds(points: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** 축 정렬 직사각형이면 [가로, 세로]를, 아니면 null을 돌려준다. */
export function rectSize(poly: Vec2[]): [number, number] | null {
  if (poly.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    if (a[0] !== b[0] && a[1] !== b[1]) return null;
  }
  const b = bounds(poly);
  return [b.maxX - b.minX, b.maxY - b.minY];
}

/** 점에서 선분까지의 거리와, 선분 시작점에서 잰 투영 길이 */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { distance: number; t: number; length: number } {
  const ab = sub(b, a);
  const len = length(ab);
  const d = normalize(ab);
  const t = Math.max(0, Math.min(len, dot(sub(p, a), d)));
  const closest = add(a, scale(d, t));
  return { distance: dist(p, closest), t, length: len };
}

export function obbCorners(o: OBB): Vec2[] {
  const u: Vec2 = [Math.cos(o.angle), Math.sin(o.angle)];
  const v: Vec2 = perp(u);
  const c: Vec2 = [o.cx, o.cy];
  return [
    add(add(c, scale(u, -o.hw)), scale(v, -o.hh)),
    add(add(c, scale(u, o.hw)), scale(v, -o.hh)),
    add(add(c, scale(u, o.hw)), scale(v, o.hh)),
    add(add(c, scale(u, -o.hw)), scale(v, o.hh)),
  ];
}

/**
 * 분리축 정리로 두 OBB가 겹치는지 본다.
 * tolerance만큼은 겹쳐도 봐준다 (벽에 딱 붙인 가구가 충돌로 잡히지 않게).
 */
export function obbOverlap(a: OBB, b: OBB, tolerance = 0.5): boolean {
  const axes: Vec2[] = [];
  for (const o of [a, b]) {
    const u: Vec2 = [Math.cos(o.angle), Math.sin(o.angle)];
    axes.push(u, perp(u));
  }
  const delta: Vec2 = [b.cx - a.cx, b.cy - a.cy];
  for (const axis of axes) {
    const ra = radiusOn(a, axis);
    const rb = radiusOn(b, axis);
    if (Math.abs(dot(delta, axis)) >= ra + rb - tolerance) return false;
  }
  return true;
}

function radiusOn(o: OBB, axis: Vec2): number {
  const u: Vec2 = [Math.cos(o.angle), Math.sin(o.angle)];
  const v = perp(u);
  return o.hw * Math.abs(dot(u, axis)) + o.hh * Math.abs(dot(v, axis));
}

/** OBB의 축 정렬 경계 상자 */
export function obbAabb(o: OBB): { minX: number; minY: number; maxX: number; maxY: number } {
  return bounds(obbCorners(o));
}

/** three.js rotation.y(도)를 평면도 OBB 각도(rad)로 바꾼다. 위에서 볼 때 반시계 회전이 평면도에서는 -각이다. */
export const rotationToPlanAngle = (deg: number): number => (-deg * Math.PI) / 180;

/** 0 이상 360 미만으로 정규화 */
export function normalizeDeg(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** 각도가 90도 배수에 가까운지 */
export function isRightAngle(deg: number, eps = 0.01): boolean {
  const r = normalizeDeg(deg) % 90;
  return r < eps || 90 - r < eps;
}
