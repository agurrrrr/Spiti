import { describe, expect, it } from 'vitest';
import * as polygonClippingNS from 'polygon-clipping';
import * as THREE from 'three';
import type { Vec2 } from '../types';
import { obbOverlap, pointInPolygon, polygonArea } from './geometry';
import { buildWallGeometry, sashSymbol } from './build3d';
import { findCollisions, magnetOffset } from './placement';
import { buildPresetPlan, PRESETS } from './presets';
import { resolvePlan, roomAt, wallSolidIntervals } from './resolve';

const polygonClipping = ((polygonClippingNS as unknown as { default?: typeof polygonClippingNS }).default ??
  polygonClippingNS) as typeof polygonClippingNS;

const plan = buildPresetPlan(PRESETS['villa-10-veranda'].spec);
const rp = resolvePlan(plan);
const wall = (id: string) => rp.walls.find((w) => w.id === id)!;

describe('프리셋 평면도 해석', () => {
  it('경고 없이 해석된다', () => {
    expect(rp.warnings).toEqual([]);
  });

  it('방끼리 겹치지 않는다', () => {
    const rooms = plan.rooms;
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const inter = polygonClipping.intersection([rooms[i].polygon], [rooms[j].polygon]);
        const area = inter.reduce((s, poly) => s + polygonArea(poly[0].slice(0, -1) as Vec2[]), 0);
        expect(area, `${rooms[i].id} ∩ ${rooms[j].id}`).toBeLessThan(1);
      }
    }
  });

  it('모든 개구부가 벽에 붙는다', () => {
    expect(rp.openings).toHaveLength(plan.openings.length);
    for (const opening of rp.openings) {
      expect(wall(opening.wallId), opening.id).toBeDefined();
    }
  });
});

describe('벽 해석', () => {
  it('외벽은 방 바깥쪽으로 두께의 절반만큼 밀려난다', () => {
    const exterior = rp.walls.filter((w) => w.exterior);
    expect(exterior.length).toBeGreaterThan(0);
    for (const w of exterior) {
      expect(Math.hypot(w.a[0] - w.from[0], w.a[1] - w.from[1]), w.id).toBeCloseTo(w.thickness / 2, 6);
    }
  });

  it('모서리 연장은 바깥 모서리에서만 두께만큼 늘어난다', () => {
    for (const w of rp.walls) {
      const allowed = w.exterior ? [0, w.thickness] : [0, w.thickness / 2];
      expect(allowed, w.id).toContain(w.extStart);
      expect(allowed, w.id).toContain(w.extEnd);
    }
  });

  it('바닥까지 뚫린 개구부 구간은 벽 충돌 영역에서 빠진다', () => {
    const holes = rp.openings.filter((o) => o.bottom <= 0);
    expect(holes.length).toBeGreaterThan(0);
    for (const opening of holes) {
      const w = wall(opening.wallId);
      // 외벽 샷시는 드나드는 곳이 아니므로 벽으로 남는다
      if (w.exterior && opening.type === 'sash') continue;
      const start = opening.t - opening.width / 2;
      const end = opening.t + opening.width / 2;
      for (const [s, e] of wallSolidIntervals(w)) {
        expect(Math.min(e, end) - Math.max(s, start), opening.id).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('샷시는 개구부와 벽 두께 안에 유리 두 짝을 세운다', () => {
    const sashes = rp.openings.filter((o) => o.type === 'sash');
    expect(sashes.length).toBeGreaterThan(0);
    for (const o of sashes) {
      const w = wall(o.wallId);
      const g = sashSymbol(o, w, 240);
      const glass = g.children.filter(
        (c) => ((c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined)?.transparent && !c.userData.planLine,
      );
      expect(glass, o.id).toHaveLength(2);
      // 로컬 좌표(회전 전)에서 틀 전체가 폭 × 높이 × 벽 두께 상자 안에 있다
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
      const box = new THREE.Box3().setFromObject(g);
      expect(box.max.x - box.min.x, o.id).toBeCloseTo(o.width, 3);
      expect(box.max.y, o.id).toBeCloseTo(o.top, 3);
      expect(box.max.z - box.min.z, o.id).toBeLessThanOrEqual(w.thickness + 1e-6);
    }
  });

  it('벽 메시가 만들어지고 높이가 층고와 같다', () => {
    const geo = buildWallGeometry(rp, 240);
    const box = geo.boundingBox!;
    expect(geo.getAttribute('position').count).toBeGreaterThan(100);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(240, 3);
    expect(box.min.x).toBeCloseTo(rp.bounds.minX - 20, 0);
    expect(box.max.x).toBeCloseTo(rp.bounds.maxX + 20, 0);
    expect(box.min.z).toBeCloseTo(rp.bounds.minY - 20, 0);
    expect(box.max.z).toBeCloseTo(rp.bounds.maxY + 20, 0);
  });

  it('roomAt은 점이 속한 방을 찾는다', () => {
    for (const room of plan.rooms) {
      expect(roomAt(plan.rooms, room.labelAt!)?.id, room.id).toBe(room.id);
    }
    expect(pointInPolygon([rp.bounds.maxX + 100, rp.bounds.maxY + 100], plan.rooms[0].polygon)).toBe(false);
    expect(roomAt(plan.rooms, [rp.bounds.maxX + 100, rp.bounds.maxY + 100])).toBeUndefined();
  });
});

describe('가구 배치 계산', () => {
  it('벽을 뚫은 가구와 겹친 가구를 찾는다', () => {
    const inner = rp.walls.find((w) => !w.exterior && w.length > 40)!;
    const mid: Vec2 = [
      inner.a[0] + inner.dir[0] * (inner.length / 2),
      inner.a[1] + inner.dir[1] * (inner.length / 2),
    ];
    const hits = findCollisions([{ uid: 'wall', x: mid[0], z: mid[1], rot: 0, w: 20, d: 20 }], rp.obstacles);
    expect([...hits]).toEqual(['wall']);
  });

  it('방 가운데의 작은 가구는 벽과 부딪히지 않는다', () => {
    const living = plan.rooms.reduce((a, b) => (polygonArea(a.polygon) >= polygonArea(b.polygon) ? a : b));
    const hits = findCollisions(
      [{ uid: 'clear', x: living.labelAt![0], z: living.labelAt![1], rot: 0, w: 10, d: 10 }],
      rp.obstacles,
    );
    expect([...hits]).toEqual([]);
  });

  it('의자는 식탁 밑으로 들어가도 겹침이 아니다', () => {
    const items = [
      { uid: 'table', x: 820, z: 200, rot: 0, w: 120, d: 80, model: 'table' },
      { uid: 'chair', x: 820, z: 250, rot: 180, w: 45, d: 50, model: 'chair' },
      { uid: 'fridge', x: 900, z: 200, rot: 0, w: 60, d: 60, model: 'fridge' },
    ];
    expect([...findCollisions(items, [])].sort()).toEqual(['fridge', 'table']);
  });

  it('원형 식탁과 아일랜드 식탁 밑에도 의자가 들어간다', () => {
    const items = [
      { uid: 'round', x: 820, z: 200, rot: 0, w: 100, d: 100, model: 'roundTable' },
      { uid: 'c1', x: 820, z: 260, rot: 180, w: 45, d: 50, model: 'chair' },
      { uid: 'island', x: 300, z: 350, rot: 0, w: 160, d: 90, model: 'island' },
      { uid: 'c2', x: 300, z: 400, rot: 180, w: 45, d: 50, model: 'chair' },
    ];
    expect([...findCollisions(items, [])]).toEqual([]);
  });

  it('회전된 사각형도 분리축으로 판정한다', () => {
    const a = { cx: 0, cy: 0, hw: 50, hh: 10, angle: Math.PI / 4 };
    expect(obbOverlap(a, { cx: 60, cy: 60, hw: 5, hh: 5, angle: 0 })).toBe(false);
    expect(obbOverlap(a, { cx: 30, cy: 30, hw: 5, hh: 5, angle: 0 })).toBe(true);
  });

  it('벽 가까이 가면 벽면에 붙는다', () => {
    const ext = rp.walls.find((w) => w.exterior && Math.abs(w.dir[1]) < 1e-6 && Math.abs(w.dir[0]) > 0.9)!;
    const centerY = (rp.bounds.minY + rp.bounds.maxY) / 2;
    const inward = centerY > ext.a[1] ? 1 : -1;
    const faceY = ext.a[1] + inward * (ext.thickness / 2);
    const midX = ext.a[0] + ext.dir[0] * (ext.length / 2);
    const off = magnetOffset(
      { uid: 'w', x: midX, z: faceY + inward * (120 / 2 + 6), rot: 0, w: 60, d: 120 },
      rp.obstacles,
    );
    expect(off.dz).toBeCloseTo(-inward * 6, 5);
    expect(off.dx).toBe(0);
  });
});
