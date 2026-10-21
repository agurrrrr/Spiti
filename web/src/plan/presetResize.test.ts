import { describe, expect, it } from 'vitest';
import * as polygonClippingNS from 'polygon-clipping';
import type { Vec2 } from '../types';
import { bounds, polygonArea } from './geometry';
import { buildPresetPlan, PRESETS, PRESET_KINDS, type PresetKind, type PresetSpec } from './presets';
import {
  AXIS_MIN,
  resetPreset,
  resizeColumn,
  resizeOuter,
  resizeRow,
  ROOM_MIN,
  TOTAL_MAX,
  TOTAL_MIN,
} from './presetResize';
import { resolvePlan } from './resolve';
import { unreachableRooms } from './roomReach';

const polygonClipping = ((polygonClippingNS as unknown as { default?: typeof polygonClippingNS }).default ??
  polygonClippingNS) as typeof polygonClippingNS;

const DELTAS = [-1000, -200, -30, -5, -1, 0, 1, 5, 30, 200, 1000] as const;

function roomMin(id: string): { width: number; depth: number } {
  if (id.startsWith('bath')) return ROOM_MIN.bath;
  if (id.startsWith('bed')) return ROOM_MIN.bed;
  if (id === 'kitchen') return ROOM_MIN.kitchen;
  if (id === 'dining') return ROOM_MIN.dining;
  if (id === 'hall') return ROOM_MIN.hall;
  if (id === 'foyer') return ROOM_MIN.foyer;
  if (id === 'utility') return ROOM_MIN.utility;
  if (id === 'dress') return ROOM_MIN.dress;
  if (id === 'study') return ROOM_MIN.study;
  if (id === 'balcony') return ROOM_MIN.balcony;
  return ROOM_MIN.living;
}

function validate(spec: PresetSpec, label: string): void {
  expect(spec.width, label).toBeCloseTo(
    spec.columns.reduce((sum, v) => sum + v, 0),
    6,
  );
  expect(spec.depth, label).toBeCloseTo(
    spec.rows.reduce((sum, v) => sum + v, 0),
    6,
  );
  expect(spec.width, label).toBeGreaterThanOrEqual(TOTAL_MIN - 1e-6);
  expect(spec.width, label).toBeLessThanOrEqual(TOTAL_MAX + 1e-6);
  expect(spec.depth, label).toBeGreaterThanOrEqual(TOTAL_MIN - 1e-6);
  expect(spec.depth, label).toBeLessThanOrEqual(TOTAL_MAX + 1e-6);
  for (const column of spec.columns) expect(column, label).toBeGreaterThanOrEqual(AXIS_MIN - 1e-6);
  for (const row of spec.rows) expect(row, label).toBeGreaterThanOrEqual(AXIS_MIN - 1e-6);

  const plan = buildPresetPlan(spec);
  const rp = resolvePlan(plan);
  expect(rp.warnings, label).toEqual([]);
  expect(unreachableRooms(rp), label).toEqual([]);

  for (const room of plan.rooms) {
    const b = bounds(room.polygon);
    const min = roomMin(room.id);
    expect(b.maxX - b.minX, `${label} ${room.id} width`).toBeGreaterThanOrEqual(min.width - 1e-6);
    expect(b.maxY - b.minY, `${label} ${room.id} depth`).toBeGreaterThanOrEqual(min.depth - 1e-6);
  }

  const area = plan.rooms.reduce((sum, room) => sum + polygonArea(room.polygon), 0);
  expect(area, label).toBeCloseTo(spec.width * spec.depth, 0);

  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const intersection = polygonClipping.intersection([plan.rooms[i].polygon], [plan.rooms[j].polygon]);
      const overlap = intersection.reduce(
        (sum, poly) => sum + polygonArea(poly[0].slice(0, -1) as Vec2[]),
        0,
      );
      expect(overlap, `${label} ${plan.rooms[i].id} ∩ ${plan.rooms[j].id}`).toBeLessThan(1);
    }
  }

  for (const opening of rp.openings) {
    const wall = rp.walls.find((w) => w.id === opening.wallId);
    expect(wall, `${label} ${opening.id} wall`).toBeDefined();
    if (!wall) continue;
    expect(opening.t - opening.width / 2, `${label} ${opening.id} start`).toBeGreaterThanOrEqual(-1e-6);
    expect(opening.t + opening.width / 2, `${label} ${opening.id} end`).toBeLessThanOrEqual(
      wall.length + 1e-6,
    );
    if (opening.type === 'door') {
      expect(opening.t - opening.width / 2, `${label} ${opening.id} margin`).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(wall.length - (opening.t + opening.width / 2), `${label} ${opening.id} margin`).toBeGreaterThanOrEqual(
        10 - 1e-6,
      );
    }
  }
}

describe.each(PRESET_KINDS)('프리셋 %s 경계 리사이즈', (kind: PresetKind) => {
  const base = PRESETS[kind].spec;

  it('모든 열 경계를 어떤 delta로 움직여도 최소 크기와 생성 규칙을 지킨다', () => {
    for (let boundary = 0; boundary < base.columns.length - 1; boundary++) {
      for (const delta of DELTAS) {
        validate(resizeColumn(base, boundary, delta, 1), `${kind} col ${boundary} ${delta}`);
      }
    }
  });

  it('모든 행 경계를 어떤 delta로 움직여도 최소 크기와 생성 규칙을 지킨다', () => {
    for (let boundary = 0; boundary < base.rows.length - 1; boundary++) {
      for (const delta of DELTAS) {
        validate(resizeRow(base, boundary, delta, 1), `${kind} row ${boundary} ${delta}`);
      }
    }
  });

  it('바깥 오른쪽·아래를 움직여도 최소 크기와 전체 범위를 지킨다', () => {
    for (const delta of DELTAS) {
      validate(resizeOuter(base, 'right', delta, 1), `${kind} outer right ${delta}`);
      validate(resizeOuter(base, 'bottom', delta, 1), `${kind} outer bottom ${delta}`);
    }
  });

  it('기본값 복원은 원래 프리셋 격자를 돌려준다', () => {
    const stretched = resizeOuter(resizeColumn(base, 0, 30, 1), 'bottom', 50, 1);
    expect(resetPreset(stretched)).toEqual(base);
    expect(resetPreset(stretched)).not.toBe(base);
  });
});

describe('프리셋 리사이즈 규칙', () => {
  const base = PRESETS['apt-30-84a'].spec;

  it('내부 경계는 전체 폭·깊이를 유지하고 나머지 칸은 그대로 둔다', () => {
    const col = resizeColumn(base, 0, 25, 1);
    expect(col.width).toBe(base.width);
    expect(col.depth).toBe(base.depth);
    expect(col.columns.slice(2)).toEqual(base.columns.slice(2));

    const row = resizeRow(base, 0, -15, 1);
    expect(row.width).toBe(base.width);
    expect(row.depth).toBe(base.depth);
    expect(row.rows.slice(2)).toEqual(base.rows.slice(2));
    expect(row.rows[0] + row.rows[1]).toBe(base.rows[0] + base.rows[1]);
    expect(row.cells).toEqual(base.cells);
  });

  it('바깥 경계는 마지막 열·행과 전체 크기만 바꾼다', () => {
    const right = resizeOuter(base, 'right', 40, 1);
    expect(right.width).toBe(base.width + 40);
    expect(right.depth).toBe(base.depth);
    expect(right.columns.slice(0, -1)).toEqual(base.columns.slice(0, -1));
    expect(right.columns[right.columns.length - 1]).toBe(base.columns[base.columns.length - 1] + 40);

    const bottom = resizeOuter(base, 'bottom', -15, 1);
    expect(bottom.depth).toBe(base.depth - 15);
    expect(bottom.width).toBe(base.width);
    expect(bottom.rows.slice(0, -1)).toEqual(base.rows.slice(0, -1));
  });

  it('5cm 단위로 반올림하고 Shift용 1cm 단위를 받는다', () => {
    expect(resizeColumn(base, 0, 7).columns[0]).toBe(base.columns[0] + 5);
    expect(resizeColumn(base, 0, 7, 1).columns[0]).toBe(base.columns[0] + 7);
    expect(resizeColumn(base, 0, 2).columns[0]).toBe(base.columns[0]);
  });

  it('잘못된 경계 인덱스·delta는 원본을 그대로 돌려준다', () => {
    expect(resizeColumn(base, -1, 10)).toBe(base);
    expect(resizeColumn(base, base.columns.length - 1, 10)).toBe(base);
    expect(resizeRow(base, base.rows.length, 10)).toBe(base);
    expect(resizeColumn(base, 0, Number.NaN)).toBe(base);
    expect(resizeRow(base, 0, Number.POSITIVE_INFINITY)).toBe(base);
    expect(resizeOuter(base, 'right', Number.NaN)).toBe(base);
    expect(resizeColumn(base, 0, 0)).toBe(base);
    expect(resizeColumn(base, 0, 2)).toBe(base);
  });

  it('입력 spec을 바꾸지 않는다', () => {
    const before = JSON.parse(JSON.stringify(base)) as PresetSpec;
    resizeColumn(base, 0, 30, 1);
    resizeRow(base, 0, 30, 1);
    resizeOuter(base, 'right', 30, 1);
    expect(base).toEqual(before);
  });
});
