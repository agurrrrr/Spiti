import { describe, expect, it } from 'vitest';
import { buildPresetPlan, PRESETS } from './presets';
import { parseFloorPlan, PlanFileError } from './planFile';

const planJson = buildPresetPlan(PRESETS['villa-10-two'].spec);

const clone = () => JSON.parse(JSON.stringify(planJson)) as Record<string, unknown>;
const roomAt = (plan: Record<string, unknown>, i: number) => (plan.rooms as Record<string, unknown>[])[i];
const wallAt = (plan: Record<string, unknown>, i: number) => (plan.walls as Record<string, unknown>[])[i];
const openingAt = (plan: Record<string, unknown>, i: number) => (plan.openings as Record<string, unknown>[])[i];
const fixtureAt = (plan: Record<string, unknown>, i: number) => (plan.fixtures as Record<string, unknown>[])[i];

describe('평면도 파일', () => {
  it('프리셋 평면도를 정규화해서 읽는다', () => {
    const plan = parseFloorPlan(planJson);
    expect(plan.version).toBe(1);
    expect(plan.id).toBe('preset-villa-10-two');
    expect(plan.unit).toBe('cm');
    expect(plan.rooms).toHaveLength(planJson.rooms.length);
    expect(plan.walls.length).toBeGreaterThan(0);
    expect(plan.openings.length).toBeGreaterThan(0);
  });

  it('메모가 없으면 빈 목록으로 채운다', () => {
    const raw = clone();
    delete raw.notes;
    expect(parseFloorPlan(raw).notes).toEqual([]);
  });

  it('필수 항목이 없으면 이유를 담아 거부한다', () => {
    const missingId = clone();
    delete missingId.id;
    expect(() => parseFloorPlan(missingId)).toThrow(PlanFileError);
    expect(() => parseFloorPlan(missingId)).toThrow('평면도 id');

    const badVersion = clone();
    badVersion.version = 2;
    expect(() => parseFloorPlan(badVersion)).toThrow('버전이 1이 아닙니다');

    const badUnit = clone();
    badUnit.unit = 'mm';
    expect(() => parseFloorPlan(badUnit)).toThrow('단위는 cm');

    const badHeight = clone();
    badHeight.wallHeight = Number.POSITIVE_INFINITY;
    expect(() => parseFloorPlan(badHeight)).toThrow('벽 높이');

    const noRooms = clone();
    delete noRooms.rooms;
    expect(() => parseFloorPlan(noRooms)).toThrow('방 목록이 없습니다');

    const badThickness = clone();
    badThickness.thickness = { exterior: 0, interior: 10 };
    expect(() => parseFloorPlan(badThickness)).toThrow('외벽 두께');
  });

  it('잘못된 좌표와 치수를 거부한다', () => {
    const badPoint = clone();
    roomAt(badPoint, 0).polygon = [[0, 0], [287, 0], [287, Number.NaN]];
    expect(() => parseFloorPlan(badPoint)).toThrow('외곽선 3번 점 좌표');

    const shortPolygon = clone();
    roomAt(shortPolygon, 0).polygon = [[0, 0], [287, 0]];
    expect(() => parseFloorPlan(shortPolygon)).toThrow('3개보다 적습니다');

    const zeroWall = clone();
    wallAt(zeroWall, 0).to = [0, 0];
    expect(() => parseFloorPlan(zeroWall)).toThrow('길이가 0');

    const badOpeningWidth = clone();
    openingAt(badOpeningWidth, 0).width = 0;
    expect(() => parseFloorPlan(badOpeningWidth)).toThrow('폭');

    const badFixtureSize = clone();
    fixtureAt(badFixtureSize, 0).size = [275, -60, 85];
    expect(() => parseFloorPlan(badFixtureSize)).toThrow('깊이');

    const badFloor = clone();
    roomAt(badFloor, 0).floor = 'carpet';
    expect(() => parseFloorPlan(badFloor)).toThrow('바닥 종류');
  });

  it('허용하지 않는 개구부 종류와 경첩 위치를 거부한다', () => {
    const badType = clone();
    openingAt(badType, 0).type = 'hole';
    expect(() => parseFloorPlan(badType)).toThrow('종류');

    const badHinge = clone();
    openingAt(badHinge, 0).hinge = 'middle';
    expect(() => parseFloorPlan(badHinge)).toThrow('경첩 위치');
  });

  it('같은 목록 안에서 id가 겹치면 거부한다', () => {
    const duplicateRoom = clone();
    roomAt(duplicateRoom, 1).id = roomAt(duplicateRoom, 0).id;
    expect(() => parseFloorPlan(duplicateRoom)).toThrow('여러 번 나옵니다');

    const duplicateWall = clone();
    wallAt(duplicateWall, 1).id = wallAt(duplicateWall, 0).id;
    expect(() => parseFloorPlan(duplicateWall)).toThrow('벽 id');

    const duplicateOpening = clone();
    openingAt(duplicateOpening, 1).id = openingAt(duplicateOpening, 0).id;
    expect(() => parseFloorPlan(duplicateOpening)).toThrow('개구부 id');

    const duplicateFixture = clone();
    fixtureAt(duplicateFixture, 0).id = 'sink';
    const withTwo = clone();
    (withTwo.fixtures as unknown[]).push(fixtureAt(duplicateFixture, 0));
    expect(() => parseFloorPlan(withTwo)).toThrow('붙박이 가구 id');
  });
});
