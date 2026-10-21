import type { FloorPlan, Fixture, OBB, Opening, OpeningType, Room, Vec2 } from '../types';
import {
  add,
  bounds,
  cross,
  dist,
  dot,
  normalize,
  perp,
  pointInPolygon,
  projectOnSegment,
  rotationToPlanAngle,
  scale,
  sub,
} from './geometry';

export interface ResolvedOpening {
  id: string;
  type: OpeningType;
  wallId: string;
  /** 벽 시작점(a)에서 잰 개구부 중심 위치 */
  t: number;
  width: number;
  bottom: number;
  top: number;
  /** 벽 중심선 위의 개구부 중심 */
  center: Vec2;
  /** 문짝이 열리는 쪽 단위 법선 (opensToward가 없으면 null) */
  swingNormal: Vec2 | null;
  /** 경첩 위치 (문짝이 열리는 쪽 벽면 위) */
  hinge: Vec2 | null;
  /** 경첩에서 닫힌 문짝 끝을 향하는 단위 벡터 */
  closedDir: Vec2 | null;
}

export interface ResolvedWall {
  id: string;
  exterior: boolean;
  thickness: number;
  /** 원래 선 */
  from: Vec2;
  to: Vec2;
  /** 외벽 밀어내기를 반영한 중심선 */
  a: Vec2;
  b: Vec2;
  dir: Vec2;
  normal: Vec2;
  length: number;
  extStart: number;
  extEnd: number;
  openings: ResolvedOpening[];
}

export interface ResolvedPlan {
  plan: FloorPlan;
  walls: ResolvedWall[];
  openings: ResolvedOpening[];
  fixtures: { fixture: Fixture; rect: OBB }[];
  /** 가구가 부딪히는 정적 사각형 (벽 조각 + 붙박이) */
  obstacles: OBB[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  warnings: string[];
}

const EPS = 0.5;

const samePoint = (a: Vec2, b: Vec2) => dist(a, b) < EPS;

export function roomAt(rooms: Room[], p: Vec2): Room | undefined {
  return rooms.find((r) => pointInPolygon(p, r.polygon));
}

export function resolvePlan(plan: FloorPlan): ResolvedPlan {
  const warnings: string[] = [];
  const inRoom = (p: Vec2) => roomAt(plan.rooms, p) !== undefined;

  // 1단계: 두께, 방향, 외벽 밀어내기
  const walls: ResolvedWall[] = plan.walls.map((w) => {
    const exterior = !!w.exterior;
    const thickness = w.thickness ?? (exterior ? plan.thickness.exterior : plan.thickness.interior);
    const dir = normalize(sub(w.to, w.from));
    const normal = perp(dir);
    const len = dist(w.from, w.to);
    let shift: Vec2 = [0, 0];
    if (exterior) {
      const mid = scale(add(w.from, w.to), 0.5);
      const plusInside = inRoom(add(mid, scale(normal, 2)));
      const minusInside = inRoom(add(mid, scale(normal, -2)));
      if (plusInside !== minusInside) {
        // 방이 없는 쪽이 바깥이다
        shift = scale(normal, (plusInside ? -1 : 1) * (thickness / 2));
      } else {
        warnings.push(`외벽 ${w.id}: 안쪽/바깥쪽을 판단하지 못해 선 중심에 세웠습니다.`);
      }
    }
    return {
      id: w.id,
      exterior,
      thickness,
      from: w.from,
      to: w.to,
      a: add(w.from, shift),
      b: add(w.to, shift),
      dir,
      normal,
      length: len,
      extStart: 0,
      extEnd: 0,
      openings: [],
    };
  });

  // 2단계: 모서리 연장
  for (const w of walls) {
    for (const end of ['start', 'end'] as const) {
      const endpoint = end === 'start' ? w.from : w.to;
      const shifted = end === 'start' ? w.a : w.b;
      const outward = end === 'start' ? scale(w.dir, -1) : w.dir;
      let ext: number;
      if (w.exterior) {
        // 바깥 모서리(볼록)는 두께만큼 늘려 모서리를 채우고, 안쪽 모서리(오목)는 방을 침범하므로 늘리지 않는다
        const probe = add(shifted, scale(outward, w.thickness / 2));
        ext = inRoom(probe) ? 0 : w.thickness;
      } else {
        // 같은 직선으로 이어지는 외벽이 있으면 그 외벽이 모서리를 덮는다
        const continuesExterior = walls.some(
          (o) =>
            o !== w &&
            o.exterior &&
            (samePoint(o.from, endpoint) || samePoint(o.to, endpoint)) &&
            Math.abs(cross(o.dir, w.dir)) < 1e-6,
        );
        ext = continuesExterior ? 0 : w.thickness / 2;
      }
      if (end === 'start') w.extStart = ext;
      else w.extEnd = ext;
    }
  }

  // 3단계: 개구부를 가장 가까운 벽에 붙인다
  const openings: ResolvedOpening[] = [];
  for (const o of plan.openings) {
    const resolved = attachOpening(o, walls);
    if (!resolved) {
      warnings.push(`개구부 ${o.id}: 가까운 벽을 찾지 못했습니다.`);
      continue;
    }
    openings.push(resolved);
    walls.find((w) => w.id === resolved.wallId)!.openings.push(resolved);
  }

  const fixtures = plan.fixtures.map((fixture) => ({
    fixture,
    rect: {
      cx: fixture.at[0],
      cy: fixture.at[1],
      hw: fixture.size[0] / 2,
      hh: fixture.size[1] / 2,
      angle: rotationToPlanAngle(fixture.rotation ?? 0),
    },
  }));

  const obstacles: OBB[] = [...walls.flatMap(wallSolidRects), ...fixtures.map((f) => f.rect)];

  const allPoints = plan.rooms.flatMap((r) => r.polygon);
  return { plan, walls, openings, fixtures, obstacles, bounds: bounds(allPoints), warnings };
}

function attachOpening(o: Opening, walls: ResolvedWall[]): ResolvedOpening | null {
  let best: { wall: ResolvedWall; t: number; distance: number } | null = null;
  for (const w of walls) {
    const p = projectOnSegment(o.at, w.from, w.to);
    if (p.distance > 15) continue;
    if (!best || p.distance < best.distance) best = { wall: w, t: p.t, distance: p.distance };
  }
  if (!best) return null;
  const { wall } = best;
  const half = o.width / 2;
  const t = Math.max(half, Math.min(wall.length - half, best.t));
  const center = add(wall.a, scale(wall.dir, t));
  const isWindow = o.type === 'window';
  const bottom = o.sill ?? (isWindow ? 90 : 0);
  const top = o.height ?? 210;

  let swingNormal: Vec2 | null = null;
  let hinge: Vec2 | null = null;
  let closedDir: Vec2 | null = null;
  if (o.opensToward && (o.type === 'door' || o.type === 'entrance')) {
    const side = Math.sign(dot(sub(o.opensToward, center), wall.normal)) || 1;
    swingNormal = scale(wall.normal, side);
    const atStart = (o.hinge ?? 'start') === 'start';
    const hingeT = atStart ? t - half : t + half;
    hinge = add(add(wall.a, scale(wall.dir, hingeT)), scale(swingNormal, wall.thickness / 2));
    closedDir = atStart ? wall.dir : scale(wall.dir, -1);
  }

  return {
    id: o.id,
    type: o.type,
    wallId: wall.id,
    t,
    width: o.width,
    bottom,
    top,
    center,
    swingNormal,
    hinge,
    closedDir,
  };
}

/**
 * 벽 길이 방향 구간에서 바닥까지 뚫린 개구부(문, 현관, 통로)를 뺀 나머지 구간.
 * 외벽의 샷시는 바닥까지 내려와도 드나드는 곳이 아니므로 벽으로 남긴다.
 */
export function wallSolidIntervals(w: ResolvedWall): [number, number][] {
  const holes = w.openings
    .filter((o) => o.bottom <= 0 && !(w.exterior && o.type === 'sash'))
    .map((o) => [o.t - o.width / 2, o.t + o.width / 2] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cursor = 0 - w.extStart;
  const endT = w.length + w.extEnd;
  for (const [s, e] of holes) {
    if (s > cursor) out.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (endT > cursor) out.push([cursor, endT]);
  return out.filter(([s, e]) => e - s > 0.01);
}

export function wallSolidRects(w: ResolvedWall): OBB[] {
  const angle = Math.atan2(w.dir[1], w.dir[0]);
  return wallSolidIntervals(w).map(([s, e]) => {
    const c = add(w.a, scale(w.dir, (s + e) / 2));
    return { cx: c[0], cy: c[1], hw: (e - s) / 2, hh: w.thickness / 2, angle };
  });
}

/** 연장을 포함한 벽 전체 바닥 사각형 (꼭짓점 4개) */
export function wallFootprint(w: ResolvedWall): Vec2[] {
  const s = add(w.a, scale(w.dir, -w.extStart));
  const e = add(w.b, scale(w.dir, w.extEnd));
  const n = scale(w.normal, w.thickness / 2);
  return [sub(s, n), sub(e, n), add(e, n), add(s, n)];
}
