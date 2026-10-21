import { describe, expect, it } from 'vitest';
import * as polygonClippingNS from 'polygon-clipping';
import type { Vec2 } from '../types';
import { bounds, pointInPolygon, polygonArea, projectOnSegment } from './geometry';
import {
  actualPyeong,
  buildPresetPlan,
  parsePresetSpec,
  PRESET_BANDS,
  PRESET_KINDS,
  PRESETS,
  type PresetKind,
} from './presets';
import { resolvePlan } from './resolve';
import { roomGraph, sharedEdges, unreachableRooms } from './roomReach';

const polygonClipping = ((polygonClippingNS as unknown as { default?: typeof polygonClippingNS }).default ??
  polygonClippingNS) as typeof polygonClippingNS;

function roomBounds(polygon: Vec2[]) {
  const b = bounds(polygon);
  return { width: b.maxX - b.minX, height: b.maxY - b.minY };
}

function distanceToPolygon(p: Vec2, polygon: Vec2[]): number {
  let min = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const q = polygon[(i + 1) % polygon.length];
    min = Math.min(min, projectOnSegment(p, polygon[i], q).distance);
  }
  return min;
}

function onOuterBoundary([x, y]: Vec2, width: number, depth: number): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
  return near(x, 0) || near(x, width) || near(y, 0) || near(y, depth);
}

function minSize(room: string): { width: number; depth: number } {
  if (room.startsWith('bath')) return { width: 120, depth: 150 };
  if (room.startsWith('bed')) return { width: 180, depth: 210 };
  if (room === 'kitchen') return { width: 150, depth: 150 };
  if (room === 'dining') return { width: 150, depth: 150 };
  if (room === 'hall') return { width: 90, depth: 90 };
  if (room === 'foyer') return { width: 90, depth: 90 };
  if (room === 'utility') return { width: 90, depth: 90 };
  if (room === 'dress') return { width: 90, depth: 90 };
  if (room === 'study') return { width: 180, depth: 180 };
  if (room === 'balcony') return { width: 90, depth: 90 };
  return { width: 240, depth: 240 };
}

describe.each(PRESET_KINDS)('프리셋 %s', (kind: PresetKind) => {
  const { spec } = PRESETS[kind];
  const plan = buildPresetPlan(spec);
  const rp = resolvePlan(plan);

  it('방과 욕실 개수가 spec과 같다', () => {
    expect(plan.rooms).toHaveLength(spec.rooms + spec.baths);
    expect(plan.rooms.filter((r) => r.id.startsWith('bath'))).toHaveLength(spec.baths);
    expect(plan.rooms.filter((r) => !r.id.startsWith('bath'))).toHaveLength(spec.rooms);
  });

  it('경고 없이 해석된다', () => {
    expect(rp.warnings).toEqual([]);
  });

  it('방이 겹치지 않고 면적 합이 width×depth와 같다', () => {
    for (let i = 0; i < plan.rooms.length; i++) {
      for (let j = i + 1; j < plan.rooms.length; j++) {
        const intersection = polygonClipping.intersection([plan.rooms[i].polygon], [plan.rooms[j].polygon]);
        const overlap = intersection.reduce(
          (sum, poly) => sum + polygonArea(poly[0].slice(0, -1) as Vec2[]),
          0,
        );
        expect(overlap, `${plan.rooms[i].id} ∩ ${plan.rooms[j].id}`).toBeLessThan(1);
      }
    }
    const total = plan.rooms.reduce((sum, room) => sum + polygonArea(room.polygon), 0);
    expect(total).toBeCloseTo(spec.width * spec.depth, 0);
    expect(Math.abs(total - spec.width * spec.depth) / (spec.width * spec.depth)).toBeLessThan(0.01);
  });

  it('문·창·현관이 실제 벽에 붙고 벽 길이 안에 들어간다', () => {
    expect(rp.openings).toHaveLength(plan.openings.length);
    for (const opening of rp.openings) {
      const wall = rp.walls.find((w) => w.id === opening.wallId);
      expect(wall, opening.id).toBeDefined();
      if (!wall) continue;
      expect(opening.t - opening.width / 2).toBeGreaterThanOrEqual(-0.001);
      expect(opening.t + opening.width / 2).toBeLessThanOrEqual(wall.length + 0.001);
      expect(projectOnSegment(opening.center, wall.a, wall.b).distance).toBeLessThan(0.001);
    }
    for (const wall of rp.walls) {
      const sorted = wall.openings.slice().sort((a, b) => a.t - b.t);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i - 1].t + sorted[i - 1].width / 2).toBeLessThanOrEqual(
          sorted[i].t - sorted[i].width / 2 + 0.001,
        );
      }
    }
  });

  it('모든 방이 거실에서 벽에 막히지 않고 이어지고, 문은 벽 끝에서 10cm 이상 떨어졌다', () => {
    expect(unreachableRooms(rp), kind).toEqual([]);
    for (const door of rp.openings.filter((o) => o.type === 'door')) {
      const wall = rp.walls.find((w) => w.id === door.wallId)!;
      expect(door.t - door.width / 2).toBeGreaterThanOrEqual(10 - 0.001);
      expect(wall.length - (door.t + door.width / 2)).toBeGreaterThanOrEqual(10 - 0.001);
    }
    expect(rp.openings.filter((o) => o.type === 'entrance')).toHaveLength(1);
  });

  it('거실·주방·식당이 맞닿은 곳에는 벽을 세우지 않는다', () => {
    const openPlan = new Set(['living', 'kitchen', 'dining']);
    const edges = sharedEdges(rp).filter((edge) => openPlan.has(edge.a) && openPlan.has(edge.b));
    expect(edges.length, kind).toBeGreaterThan(0);
    for (const edge of edges) {
      const covering = plan.walls.filter((wall) => {
        const horizontal = Math.abs(wall.from[1] - wall.to[1]) < 0.01;
        if (horizontal !== edge.horizontal) return false;
        const axis = horizontal ? 0 : 1;
        if (Math.abs(wall.from[1 - axis] - edge.line) > 0.01) return false;
        const lo = Math.min(wall.from[axis], wall.to[axis]);
        const hi = Math.max(wall.from[axis], wall.to[axis]);
        return Math.min(hi, edge.end) - Math.max(lo, edge.start) > 1;
      });
      expect(covering.map((w) => w.id), `${edge.a}-${edge.b}`).toEqual([]);
    }
    const kitchen = plan.rooms.find((room) => room.id === 'kitchen');
    expect(kitchen, kind).toBeDefined();
    const sink = plan.fixtures.find((f) => f.id === 'sink');
    expect(sink, kind).toBeDefined();
    if (kitchen && sink) expect(pointInPolygon(sink.at, kitchen.polygon)).toBe(true);
  });

  it('실내 복도 없이 현관에서 들어오고, 현관문은 현관 바깥벽에 있다', () => {
    expect(plan.rooms.some((room) => room.id === 'hall'), kind).toBe(false);
    const foyer = plan.rooms.find((room) => room.id === 'foyer');
    expect(foyer, kind).toBeDefined();
    const entrance = rp.openings.find((o) => o.type === 'entrance');
    if (foyer && entrance) expect(distanceToPolygon(entrance.center, foyer.polygon)).toBeLessThan(11);
    // 현관은 벽 없이 거실 쪽으로 트여 있다
    expect(roomGraph(rp).get('foyer')?.size ?? 0, kind).toBeGreaterThan(0);
  });

  it('드레스룸과 부부욕실은 안방 쪽으로 드나든다', () => {
    const edges = sharedEdges(rp);
    const touches = (room: string, other: string) =>
      edges.some((edge) => (edge.a === room && edge.b === other) || (edge.b === room && edge.a === other));
    const doorOf = (room: string) => rp.openings.find((o) => o.id === `door-${room}`);
    const roomById = (id: string) => plan.rooms.find((room) => room.id === id)!;
    for (const room of plan.rooms) {
      const parents =
        room.id === 'dress' ? ['bed1'] : room.id.startsWith('bath') && room.id !== 'bath1' ? ['bed1', 'dress'] : [];
      const reachable = parents.filter((parent) => plan.rooms.some((r) => r.id === parent) && touches(room.id, parent));
      if (!reachable.length) continue;
      const door = doorOf(room.id);
      expect(door, `${kind} ${room.id}`).toBeDefined();
      if (!door) continue;
      expect(
        reachable.some((parent) => distanceToPolygon(door.center, roomById(parent).polygon) < 1),
        `${kind} ${room.id} → ${reachable.join('/')}`,
      ).toBe(true);
    }
  });

  it('벽 id가 유일하고 외벽이 바깥 경계에만 있다', () => {
    expect(new Set(plan.walls.map((w) => w.id)).size).toBe(plan.walls.length);

    let exteriorLength = 0;
    for (const wall of plan.walls) {
      if (!wall.exterior) continue;
      expect(onOuterBoundary(wall.from, spec.width, spec.depth), `${wall.id} from`).toBe(true);
      expect(onOuterBoundary(wall.to, spec.width, spec.depth), `${wall.id} to`).toBe(true);
      exteriorLength += Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    }
    expect(exteriorLength).toBeCloseTo(2 * (spec.width + spec.depth), 0);
  });

  it('기본 치수에서 방 종류별 최소 크기를 만족한다', () => {
    for (const room of plan.rooms) {
      const size = roomBounds(room.polygon);
      const min = minSize(room.id);
      expect(size.width, room.id).toBeGreaterThanOrEqual(min.width);
      expect(size.height, room.id).toBeGreaterThanOrEqual(min.depth);
    }
  });

  it('프리셋 설명과 id를 담는다', () => {
    expect(plan.id).toBe(`preset-${kind}`);
    expect(plan.name).toBe(PRESETS[kind].label);
    expect(plan.notes).toHaveLength(1);
    expect(plan.wallHeight).toBe(240);
    expect(plan.thickness).toEqual({ exterior: 20, interior: 10 });
  });
});

describe('평형대별 프리셋 구성', () => {
  it('10평대에 11개, 나머지 평형대에 10개씩, 모두 41개다', () => {
    expect(PRESET_KINDS).toHaveLength(41);
    expect(PRESET_KINDS.filter((kind) => PRESETS[kind].band === 10)).toHaveLength(11);
    for (const band of PRESET_BANDS.filter((value) => value !== 10)) {
      expect(PRESET_KINDS.filter((kind) => PRESETS[kind].band === band), `${band}평대`).toHaveLength(10);
    }
  });

  it('10평대는 아파트 4·빌라 4·단독주택 3, 나머지는 아파트 4·빌라 3·단독주택 3이다', () => {
    for (const band of PRESET_BANDS) {
      const kinds = PRESET_KINDS.filter((kind) => PRESETS[kind].band === band);
      expect(kinds.filter((kind) => PRESETS[kind].collection === 'apartment'), `${band}평대 아파트`).toHaveLength(4);
      expect(kinds.filter((kind) => PRESETS[kind].collection === 'villa'), `${band}평대 빌라`).toHaveLength(
        band === 10 ? 4 : 3,
      );
      expect(kinds.filter((kind) => PRESETS[kind].collection === 'house'), `${band}평대 단독주택`).toHaveLength(3);
    }
  });

  it('아파트는 공급면적 평형, 빌라·단독주택은 실제 바닥면적 평형을 쓴다', () => {
    for (const kind of PRESET_KINDS) {
      const entry = PRESETS[kind];
      expect(entry.pyeong, kind).toBeGreaterThanOrEqual(entry.band);
      expect(entry.pyeong, kind).toBeLessThan(entry.band + 10);
      const actual = actualPyeong(entry.spec);
      if (entry.collection === 'apartment') {
        expect(entry.pyeong, kind).toBeGreaterThan(actual);
        expect(entry.pyeong, kind).toBeLessThan(actual / 0.62);
      } else {
        expect(Math.abs(entry.pyeong - actual), kind).toBeLessThanOrEqual(0.1);
      }
      expect(entry.areaM2, kind).toBeCloseTo((entry.spec.width * entry.spec.depth) / 10000, 1);
    }
  });

  it('kind와 label이 겹치지 않고 열·행 합이 전체 크기와 맞는다', () => {
    expect(new Set(PRESET_KINDS).size).toBe(PRESET_KINDS.length);
    expect(new Set(PRESET_KINDS.map((kind) => PRESETS[kind].label)).size).toBe(PRESET_KINDS.length);
    for (const kind of PRESET_KINDS) {
      const { spec } = PRESETS[kind];
      expect(spec.columns.reduce((sum, value) => sum + value, 0), kind).toBe(spec.width);
      expect(spec.rows.reduce((sum, value) => sum + value, 0), kind).toBe(spec.depth);
    }
  });
});

describe('베란다형 빌라 프리셋', () => {
  it('10평대 빌라 프리셋의 방 구성을 유지한다', () => {
    const entry = PRESETS['villa-10-veranda'];
    expect(entry.band).toBe(10);
    expect(entry.collection).toBe('villa');
    expect(entry.label).toBe('빌라 투룸 · 베란다형');
    expect(entry.spec.rooms).toBe(7);
    expect(entry.spec.baths).toBe(1);
    const plan = buildPresetPlan(entry.spec);
    const rp = resolvePlan(plan);
    expect(plan.rooms.map((room) => room.id).sort()).toEqual(
      ['balcony', 'bath1', 'bed1', 'bed2', 'foyer', 'kitchen', 'living', 'utility'].sort(),
    );
    const foyer = plan.rooms.find((room) => room.id === 'foyer');
    expect(foyer?.name).toBe('현관');
    const entrance = rp.openings.find((opening) => opening.type === 'entrance');
    expect(entrance).toBeDefined();
    if (foyer && entrance) expect(distanceToPolygon(entrance.center, foyer.polygon)).toBeLessThan(11);
    expect(entry.areaM2).toBeCloseTo((entry.spec.width * entry.spec.depth) / 10000, 1);

    // 작은방 문은 주방 쪽에 있고, 주방·현관과 거실 사이에는 벽이 없다
    const kitchen = plan.rooms.find((room) => room.id === 'kitchen')!;
    const door = rp.openings.find((opening) => opening.id === 'door-bed1');
    expect(door).toBeDefined();
    if (door) expect(distanceToPolygon(door.center, kitchen.polygon)).toBeLessThan(1);
    const graph = roomGraph(rp);
    expect(graph.get('living')?.has('kitchen')).toBe(true);
    expect(graph.get('living')?.has('foyer')).toBe(true);
    expect(graph.get('living')?.has('balcony')).toBe(true);
  });
});

describe('프리셋 격자 파라미터', () => {
  it('열 너비를 바꾸면 방과 벽이 다시 계산된다', () => {
    const base = PRESETS[PRESET_KINDS[0]].spec;
    const width = base.width + 40;
    const columns = base.columns.slice();
    columns[0] += 40;
    const plan = buildPresetPlan({ ...base, width, columns });

    expect(Math.max(...plan.walls.flatMap((w) => [w.from[0], w.to[0]]))).toBe(width);

    const total = plan.rooms.reduce((sum, room) => sum + polygonArea(room.polygon), 0);
    expect(total).toBeCloseTo(width * base.depth, 0);
  });

  it('저장된 spec을 다시 읽고, 잘못된 spec은 버린다', () => {
    for (const kind of PRESET_KINDS) {
      const copied = JSON.parse(JSON.stringify(PRESETS[kind].spec)) as unknown;
      expect(parsePresetSpec(copied)).toEqual(PRESETS[kind].spec);
    }
    const base = PRESETS[PRESET_KINDS[0]].spec;
    expect(parsePresetSpec({ ...base, columns: [base.columns[0]], width: base.width })).toBeNull();
    expect(parsePresetSpec({ ...base, rooms: base.rooms + 1 })).toBeNull();
    expect(parsePresetSpec(null)).toBeNull();
  });
});
