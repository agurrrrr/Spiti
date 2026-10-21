import type { FloorKind, FloorPlan, Fixture, Opening, OpeningType, Room, Vec2, Wall } from '../types';

/** 사용자에게 그대로 보여 줄 수 있는 한국어 메시지를 담는다 */
export class PlanFileError extends Error {}

const FLOOR_KINDS: readonly FloorKind[] = ['wood', 'tile', 'kitchen'];
const OPENING_TYPES: readonly OpeningType[] = ['door', 'entrance', 'opening', 'window', 'sash'];
const HINGES = ['start', 'end'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function fail(message: string): never {
  throw new PlanFileError(message);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} 값이 없거나 문자열이 아닙니다.`);
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (!isFiniteNumber(value)) fail(`${label} 값이 유한한 숫자가 아닙니다.`);
  return value;
}

function readPositive(value: unknown, label: string): number {
  if (!isFiniteNumber(value) || value <= 0) fail(`${label} 값은 0보다 큰 숫자여야 합니다.`);
  return value;
}

function readVec2(value: unknown, label: string): Vec2 {
  if (!Array.isArray(value) || value.length !== 2 || !isFiniteNumber(value[0]) || !isFiniteNumber(value[1])) {
    fail(`${label} 좌표는 유한한 숫자 [x, y]여야 합니다.`);
  }
  return [value[0], value[1]];
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} 목록이 없습니다.`);
  return value;
}

/**
 * 평면도 데이터(version 1, cm)를 검증하고 정규화한다.
 * JSON.parse 결과뿐 아니라 파일에서 읽은 객체에도 쓴다.
 */
export function parseFloorPlan(value: unknown): FloorPlan {
  if (!isRecord(value)) fail('평면도 파일이 객체 형식이 아닙니다.');
  if (value.version !== 1) fail('평면도 파일 버전이 1이 아닙니다.');
  if (value.unit !== 'cm') fail('평면도 단위는 cm여야 합니다.');

  const id = readString(value.id, '평면도 id');
  const name = readString(value.name, '평면도 이름');
  const wallHeight = readPositive(value.wallHeight, '벽 높이');

  if (!isRecord(value.thickness)) fail('벽 두께 정보가 없습니다.');
  const thickness = {
    exterior: readPositive(value.thickness.exterior, '외벽 두께'),
    interior: readPositive(value.thickness.interior, '내벽 두께'),
  };

  const rooms = readArray(value.rooms, '방').map((raw, i): Room => {
    if (!isRecord(raw)) fail(`${i + 1}번째 방이 객체가 아닙니다.`);
    const label = `${i + 1}번째 방`;
    const roomId = readString(raw.id, `${label} id`);
    const floor = raw.floor;
    if (typeof floor !== 'string' || !FLOOR_KINDS.includes(floor as FloorKind)) {
      fail(`${label}의 바닥 종류 "${String(floor)}"를 알 수 없습니다.`);
    }
    const polygon = readArray(raw.polygon, `${label} 외곽선`).map((p, j) =>
      readVec2(p, `${label} 외곽선 ${j + 1}번 점`),
    );
    if (polygon.length < 3) fail(`${label}의 외곽선 점이 3개보다 적습니다.`);
    return {
      id: roomId,
      name: readString(raw.name, `${label} 이름`),
      floor: floor as FloorKind,
      polygon,
      ...(raw.labelAt === undefined ? {} : { labelAt: readVec2(raw.labelAt, `${label} 라벨 위치`) }),
    };
  });
  checkDuplicateIds(rooms, '방');

  const walls = readArray(value.walls, '벽').map((raw, i): Wall => {
    if (!isRecord(raw)) fail(`${i + 1}번째 벽이 객체가 아닙니다.`);
    const label = `${i + 1}번째 벽`;
    const from = readVec2(raw.from, `${label} 시작점`);
    const to = readVec2(raw.to, `${label} 끝점`);
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) === 0) fail(`${label}의 길이가 0입니다.`);
    if (raw.exterior !== undefined && typeof raw.exterior !== 'boolean') {
      fail(`${label}의 외벽 여부는 true 또는 false여야 합니다.`);
    }
    return {
      id: readString(raw.id, `${label} id`),
      from,
      to,
      ...(raw.exterior === undefined ? {} : { exterior: raw.exterior }),
      ...(raw.thickness === undefined ? {} : { thickness: readPositive(raw.thickness, `${label} 두께`) }),
    };
  });
  checkDuplicateIds(walls, '벽');

  const openings = readArray(value.openings, '개구부').map((raw, i): Opening => {
    if (!isRecord(raw)) fail(`${i + 1}번째 개구부가 객체가 아닙니다.`);
    const label = `${i + 1}번째 개구부`;
    const type = raw.type;
    if (typeof type !== 'string' || !OPENING_TYPES.includes(type as OpeningType)) {
      fail(`${label}의 종류 "${String(type)}"를 알 수 없습니다.`);
    }
    if (raw.hinge !== undefined && !HINGES.includes(raw.hinge as (typeof HINGES)[number])) {
      fail(`${label}의 경첩 위치는 start 또는 end여야 합니다.`);
    }
    return {
      id: readString(raw.id, `${label} id`),
      type: type as OpeningType,
      at: readVec2(raw.at, `${label} 중심`),
      width: readPositive(raw.width, `${label} 폭`),
      ...(raw.height === undefined ? {} : { height: readNumber(raw.height, `${label} 높이`) }),
      ...(raw.sill === undefined ? {} : { sill: readNumber(raw.sill, `${label} 아랫변 높이`) }),
      ...(raw.opensToward === undefined
        ? {}
        : { opensToward: readVec2(raw.opensToward, `${label} 열리는 방향`) }),
      ...(raw.hinge === undefined ? {} : { hinge: raw.hinge as 'start' | 'end' }),
    };
  });
  checkDuplicateIds(openings, '개구부');

  const fixtures = readArray(value.fixtures, '붙박이 가구').map((raw, i): Fixture => {
    if (!isRecord(raw)) fail(`${i + 1}번째 붙박이 가구가 객체가 아닙니다.`);
    const label = `${i + 1}번째 붙박이 가구`;
    if (raw.kind !== 'counter') fail(`${label}의 종류 "${String(raw.kind)}"를 알 수 없습니다.`);
    const size = readArray(raw.size, `${label} 크기`);
    if (size.length !== 3) fail(`${label}의 크기는 [가로, 깊이, 높이] 세 숫자여야 합니다.`);
    return {
      id: readString(raw.id, `${label} id`),
      name: readString(raw.name, `${label} 이름`),
      kind: 'counter',
      at: readVec2(raw.at, `${label} 중심`),
      size: [
        readPositive(size[0], `${label} 가로`),
        readPositive(size[1], `${label} 깊이`),
        readPositive(size[2], `${label} 높이`),
      ],
      ...(raw.rotation === undefined ? {} : { rotation: readNumber(raw.rotation, `${label} 회전`) }),
    };
  });
  checkDuplicateIds(fixtures, '붙박이 가구');

  if (value.notes !== undefined && (!Array.isArray(value.notes) || value.notes.some((n) => typeof n !== 'string'))) {
    fail('해석 메모(notes)는 문자열 목록이어야 합니다.');
  }
  if (value.source !== undefined && typeof value.source !== 'string') {
    fail('평면도 출처(source)는 문자열이어야 합니다.');
  }

  return {
    version: 1,
    id,
    name,
    ...(value.source ? { source: value.source } : {}),
    unit: 'cm',
    wallHeight,
    thickness,
    rooms,
    walls,
    openings,
    fixtures,
    notes: value.notes === undefined ? [] : (value.notes as string[]),
  };
}

function checkDuplicateIds(items: { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${label} id "${item.id}"가 여러 번 나옵니다.`);
    seen.add(item.id);
  }
}
