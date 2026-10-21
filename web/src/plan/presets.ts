import * as polygonClippingNS from 'polygon-clipping';
import type { FloorKind, FloorPlan, Fixture, Opening, Room, Vec2, Wall } from '../types';
import { polygonArea } from './geometry';

// polygon-clipping은 런타임에는 default export만 있고, 타입 선언은 named export만 있다
const polygonClipping = ((polygonClippingNS as unknown as { default?: typeof polygonClippingNS }).default ??
  polygonClippingNS) as typeof polygonClippingNS;

export type PresetKind = string;

export type PresetCollection = 'apartment' | 'villa' | 'house';
export type PyeongBand = 10 | 20 | 30 | 40;

/** 격자 칸. 같은 room의 칸들은 합집합 다각형 하나가 된다. */
export interface GridCell {
  room: string;
  col: number;
  colSpan: number;
  row: number;
  rowSpan: number;
}

/**
 * 프리셋 정의. columns/rows는 방 경계선의 간격(cm)이고, cells는 어느 칸이 어느 방인지 정한다.
 * 좌표를 상수로 두지 않고 이 세 값만으로 방·벽·문·창을 다시 계산하므로, 열·행 값을 바꾸면 구조가 따라 움직인다.
 */
export interface PresetSpec {
  kind: PresetKind;
  /** 욕실을 뺀 방 수(거실·주방·복도·침실·서재 등을 모두 포함) */
  rooms: number;
  baths: number;
  width: number;
  depth: number;
  columns: number[];
  rows: number[];
  cells: GridCell[];
}

export interface PresetEntry {
  label: string;
  collection: PresetCollection;
  collectionLabel: string;
  band: PyeongBand;
  /** 카드에 보여 주는 평형. 아파트는 공급면적 기준, 빌라·단독주택은 실제 바닥면적 기준이다. */
  pyeong: number;
  /** 방 폴리곤이 덮는 실제 바닥면적(㎡) */
  areaM2: number;
  /** 검색에서 참고한 평면 유형 설명 */
  reference: string;
  /** 방 → 문을 낼 이웃 방. 생성 규칙보다 먼저 쓰고, 경계가 너무 짧으면 규칙으로 돌아간다. */
  doors?: Record<string, string>;
  spec: PresetSpec;
}

export const PYEONG_M2 = 3.3058;

const EPS = 0.01;
const WALL_HEIGHT = 240;
const EXTERIOR = 20;
const INTERIOR = 10;

const COLLECTION_LABELS: Record<PresetCollection, string> = {
  apartment: '아파트',
  villa: '빌라',
  house: '단독주택',
};

type CellTuple = readonly [room: string, col: number, row: number, colSpan?: number, rowSpan?: number];

interface PresetDefinition {
  kind: PresetKind;
  label: string;
  collection: PresetCollection;
  /** 아파트는 공급면적 평형. 생략하면 실제 바닥면적으로 계산한다. */
  pyeong?: number;
  reference: string;
  columns: number[];
  rows: number[];
  cells: CellTuple[];
  /** columns와 cells를 좌우로 뒤집어 같은 구조의 반대 방향 평면을 만든다. */
  mirror?: boolean;
  doors?: Record<string, string>;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function definePreset(def: PresetDefinition): PresetEntry {
  const columns = def.mirror ? def.columns.slice().reverse() : def.columns.slice();
  const rows = def.rows.slice();
  const cells = def.cells.map(([room, col, row, colSpan = 1, rowSpan = 1]) => ({
    room,
    col: def.mirror ? columns.length - col - colSpan : col,
    row,
    colSpan,
    rowSpan,
  }));
  const keySet = new Set(cells.map((cell) => cell.room));
  const baths = [...keySet].filter((room) => room.startsWith('bath')).length;
  const rooms = keySet.size - baths;
  const width = columns.reduce((sum, value) => sum + value, 0);
  const depth = def.rows.reduce((sum, value) => sum + value, 0);
  const areaM2 = round1((width * depth) / 10000);
  const pyeong = def.pyeong ?? round1(areaM2 / PYEONG_M2);
  return {
    label: def.label,
    collection: def.collection,
    collectionLabel: COLLECTION_LABELS[def.collection],
    band: (Math.floor(pyeong / 10) * 10) as PyeongBand,
    pyeong,
    areaM2,
    reference: def.reference,
    ...(def.doors ? { doors: { ...def.doors } } : {}),
    spec: { kind: def.kind, rooms, baths, width, depth, columns, rows, cells },
  };
}

/**
 * 2026-10-20 검색으로 확인한 대한민국 주거 평면의 평형대별 구성이다.
 * - 아파트: 전용 84㎡(공급 34평) 국평, 59㎡(공급 25평), 74·101~118㎡ 판상형·타워형
 * - 빌라: 복도형·계단실형 소형 공동주택
 * - 단독주택: LDK 개방형 단층, 전원주택
 * 카드에는 아파트는 공급면적 평형, 빌라·단독주택은 실제 바닥면적 평형을 보여 준다.
 *
 * 공통 규칙: 위쪽(행 0)이 북쪽이다. 복도는 집 밖(공용 복도·계단실)에 있다고 보고 실내에 따로 두지 않는다.
 * 현관에서 들어오면 거실·주방이 바로 이어지고, 방으로 가는 통로는 거실 칸을 L자로 이어 만든다.
 * 거실·주방·식당은 벽 없이 트여 있고, 부부욕실(bath2 이상)과 드레스룸은 안방(bed1)으로 드나든다.
 */
const PRESET_DEFINITIONS: PresetDefinition[] = [
  // ── 10평대 ──────────────────────────────────────────────────────────────
  {
    kind: 'apt-10-studio',
    label: '소형 아파트 · 원룸',
    collection: 'apartment',
    pyeong: 16,
    reference: '10평대 소형 아파트 원룸, 현관에서 주방을 지나 방으로 들어가고 욕실을 현관 옆에 둔 구조',
    columns: [170, 350],
    rows: [170, 210, 330],
    cells: [
      ['foyer', 0, 0],
      ['kitchen', 1, 0],
      ['bath1', 0, 1],
      ['living', 1, 1],
      ['living', 0, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-10-one',
    label: '소형 아파트 · 1침실',
    collection: 'apartment',
    pyeong: 17,
    reference: '10평대 1룸 아파트, 현관 옆 욕실과 북쪽 주방, 남쪽에 침실과 거실을 나란히 둔 구조',
    columns: [170, 150, 400],
    rows: [210, 340],
    cells: [
      ['bath1', 0, 0],
      ['foyer', 1, 0],
      ['kitchen', 2, 0],
      ['bed1', 0, 1, 2, 1],
      ['living', 2, 1],
    ],
  },
  {
    kind: 'apt-10-onehalf',
    label: '소형 아파트 · 1.5룸',
    collection: 'apartment',
    pyeong: 19,
    reference: '10평대 후반 1.5룸, 주방 옆 다용도실과 거실에 붙은 작은 방을 더한 구조',
    columns: [170, 150, 300, 240],
    rows: [200, 340],
    cells: [
      ['bath1', 0, 0],
      ['foyer', 1, 0],
      ['kitchen', 2, 0],
      ['utility', 3, 0],
      ['bed1', 0, 1, 2, 1],
      ['living', 2, 1],
      ['bed2', 3, 1],
    ],
  },
  {
    kind: 'apt-10-two',
    label: '소형 아파트 · 투룸',
    collection: 'apartment',
    pyeong: 19,
    reference: '10평대 투룸, 작은 방 문을 주방 쪽으로 내고 현관을 거실에 바로 이은 구조',
    columns: [260, 290, 170],
    rows: [160, 130, 320],
    cells: [
      ['bed2', 0, 0, 1, 2],
      ['kitchen', 1, 0, 1, 2],
      ['bath1', 2, 0],
      ['foyer', 2, 1],
      ['bed1', 0, 2],
      ['living', 1, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-10-studio',
    label: '빌라 원룸 · 복도형',
    collection: 'villa',
    reference: '복도형 빌라 원룸, 건물 외부 복도에서 현관으로 들어와 욕실·주방·방이 앞뒤로 이어지는 구조',
    columns: [200, 220],
    rows: [190, 210, 420],
    cells: [
      ['foyer', 0, 0],
      ['bath1', 1, 0],
      ['kitchen', 0, 1, 2, 1],
      ['living', 0, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-10-two',
    label: '빌라 투룸 · 복도형',
    collection: 'villa',
    reference: '복도형 빌라 투룸, 현관이 주방으로 바로 열리고 두 방이 거실에 붙은 구조',
    columns: [200, 160, 270],
    rows: [170, 220, 330],
    cells: [
      ['bath1', 0, 0],
      ['foyer', 1, 0],
      ['bed2', 2, 0, 1, 2],
      ['kitchen', 0, 1, 2, 1],
      ['bed1', 0, 2],
      ['living', 1, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-10-long',
    label: '빌라 투룸 · 계단실형',
    collection: 'villa',
    reference: '계단실형 빌라 투룸, 북쪽에 욕실·현관·다용도실을 모으고 긴 주방을 거실과 터 놓은 구조',
    columns: [270, 160, 170, 210],
    rows: [170, 190, 340],
    mirror: true,
    cells: [
      ['bed2', 0, 0, 1, 2],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['utility', 3, 0],
      ['kitchen', 1, 1, 3, 1],
      ['bed1', 0, 2],
      ['living', 1, 2, 3, 1],
    ],
  },
  {
    kind: 'villa-10-veranda',
    label: '빌라 투룸 · 베란다형',
    collection: 'villa',
    reference: '서쪽 베란다가 거실로 열리고 현관 옆 남쪽에 다용도실을 둔 빌라 투룸 구조',
    columns: [100, 187, 153, 143, 120, 281],
    rows: [120, 90, 240, 110],
    cells: [
      ['bed1', 0, 0, 2, 2],
      ['kitchen', 2, 0, 2, 2],
      ['bath1', 4, 0, 1, 2],
      ['bed2', 5, 0, 1, 3],
      ['living', 1, 2, 4, 1],
      ['living', 1, 3, 2, 1],
      ['balcony', 0, 2, 1, 2],
      ['foyer', 3, 3],
      ['utility', 4, 3, 2, 1],
    ],
    // 작은방 문은 주방 쪽 벽에 낸다
    doors: { bed1: 'kitchen' },
  },
  {
    kind: 'house-10-tiny',
    label: '단독주택 · 소형',
    collection: 'house',
    reference: '10평대 소형 단독주택, 남쪽 모서리 현관이 거실로 바로 열리고 주방 뒤에 욕실·다용도실을 둔 구조',
    columns: [290, 170, 180],
    rows: [170, 200, 120, 180],
    cells: [
      ['bed1', 0, 0, 1, 2],
      ['bath1', 1, 0],
      ['utility', 2, 0],
      ['kitchen', 1, 1, 2, 1],
      ['living', 0, 2, 2, 2],
      ['living', 2, 2],
      ['foyer', 2, 3],
    ],
  },
  {
    kind: 'house-10-two',
    label: '단독주택 · 2침실',
    collection: 'house',
    reference: '10평대 후반 단독주택, 넓은 주방·식당과 침실 두 개, 남쪽 모서리 현관',
    columns: [280, 360, 180],
    rows: [170, 160, 160, 180],
    cells: [
      ['bed2', 0, 0, 1, 2],
      ['kitchen', 1, 0, 1, 2],
      ['bath1', 2, 0],
      ['utility', 2, 1],
      ['bed1', 0, 2, 1, 2],
      ['living', 1, 2, 1, 2],
      ['living', 2, 2],
      ['foyer', 2, 3],
    ],
  },
  {
    kind: 'house-10-garden',
    label: '단독주택 · 마당형',
    collection: 'house',
    reference: '10평대 후반 마당형 단독주택, 주방·식당·거실을 하나로 트고 마당 쪽 모서리에 현관을 둔 구조',
    columns: [280, 170, 190, 200],
    rows: [180, 170, 170, 170],
    mirror: true,
    cells: [
      ['bed2', 0, 0, 1, 2],
      ['bath1', 1, 0],
      ['utility', 2, 0],
      ['kitchen', 3, 0, 1, 2],
      ['dining', 1, 1, 2, 1],
      ['bed1', 0, 2, 1, 2],
      ['living', 1, 2, 2, 2],
      ['living', 3, 2],
      ['foyer', 3, 3],
    ],
  },

  // ── 20평대 ──────────────────────────────────────────────────────────────
  {
    kind: 'apt-20-59a',
    label: '59㎡ 아파트 · 3베이',
    collection: 'apartment',
    pyeong: 25,
    reference: '전용 59㎡(공급 25평) 3베이 판상형, 침실 3·욕실 2, 안방 드레스룸 안쪽에 부부욕실',
    columns: [260, 140, 160, 120, 160, 160],
    rows: [220, 110, 350],
    cells: [
      ['bed3', 0, 0, 1, 2],
      ['foyer', 1, 0],
      ['bath1', 2, 0],
      ['kitchen', 3, 0, 2, 2],
      ['bath2', 5, 0],
      ['living', 1, 1, 2, 1],
      ['dress', 5, 1],
      ['bed2', 0, 2],
      ['living', 1, 2, 3, 1],
      ['bed1', 4, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-20-59b',
    label: '59㎡ 아파트 · 2베이',
    collection: 'apartment',
    pyeong: 25,
    reference: '전용 59㎡ 2베이 구축 판상형, 거실·안방이 남향이고 가운데에 주방·식당을 둔 구조',
    columns: [270, 140, 170, 250],
    rows: [240, 200, 340],
    cells: [
      ['bed2', 0, 0],
      ['foyer', 1, 0],
      ['bath1', 2, 0],
      ['bed3', 3, 0],
      ['kitchen', 0, 1],
      ['dining', 1, 1, 3, 1],
      ['living', 0, 2, 2, 1],
      ['bed1', 2, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-20-66a',
    label: '66㎡ 아파트 · 쓰리룸',
    collection: 'apartment',
    pyeong: 28,
    reference: '전용 66㎡(공급 28평) 3베이, ㄱ자 주방 뒤에 다용도실, 안방 드레스룸·부부욕실',
    columns: [270, 140, 160, 170, 130, 170],
    rows: [230, 110, 360],
    cells: [
      ['bed3', 0, 0, 1, 2],
      ['foyer', 1, 0],
      ['bath1', 2, 0],
      ['kitchen', 3, 0],
      ['utility', 4, 0],
      ['bath2', 5, 0],
      ['living', 1, 1, 2, 1],
      ['kitchen', 3, 1, 2, 1],
      ['dress', 5, 1],
      ['bed2', 0, 2],
      ['living', 1, 2, 3, 1],
      ['bed1', 4, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-20-66b',
    label: '66㎡ 아파트 · 식당형',
    collection: 'apartment',
    pyeong: 28,
    reference: '전용 66㎡ 3베이, 주방 앞에 식당을 두어 거실과 한 공간으로 튼 구조',
    columns: [270, 140, 160, 160, 140, 180],
    rows: [220, 150, 340],
    cells: [
      ['bed3', 0, 0, 1, 2],
      ['foyer', 1, 0],
      ['bath1', 2, 0],
      ['kitchen', 3, 0, 2, 1],
      ['bath2', 5, 0],
      ['living', 1, 1],
      ['dining', 2, 1, 3, 1],
      ['dress', 5, 1],
      ['bed2', 0, 2],
      ['living', 1, 2, 3, 1],
      ['bed1', 4, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-20-a',
    label: '빌라 쓰리룸 · 거실 중심형',
    collection: 'villa',
    reference: '20평대 빌라 쓰리룸, 계단실 현관이 거실로 열리고 방 세 개가 거실을 둘러싼 구조',
    columns: [280, 160, 150, 300],
    rows: [250, 150, 350],
    cells: [
      ['bed2', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['kitchen', 3, 0, 1, 2],
      ['living', 0, 1, 3, 1],
      ['bed1', 0, 2],
      ['living', 1, 2, 2, 1],
      ['bed3', 3, 2],
    ],
  },
  {
    kind: 'villa-20-b',
    label: '빌라 쓰리룸 · 욕실 2개',
    collection: 'villa',
    reference: '20평대 중반 빌라, 주방 옆에 두 번째 욕실을 두고 식당을 거실과 이은 구조',
    columns: [270, 160, 150, 240, 170],
    rows: [240, 150, 370],
    cells: [
      ['bed2', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['kitchen', 3, 0],
      ['bath2', 4, 0],
      ['living', 0, 1, 3, 1],
      ['dining', 3, 1, 2, 1],
      ['bed3', 0, 2],
      ['living', 1, 2, 2, 1],
      ['bed1', 3, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-20-c',
    label: '빌라 쓰리룸 · 안방 욕실형',
    collection: 'villa',
    reference: '20평대 후반 빌라, 안방 드레스룸 안쪽에 부부욕실을 두고 주방 앞을 식당으로 쓴 구조',
    columns: [280, 160, 150, 230, 170, 170],
    rows: [240, 150, 370],
    cells: [
      ['bed3', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['kitchen', 3, 0],
      ['bath2', 4, 0, 2, 1],
      ['living', 0, 1, 3, 1],
      ['dining', 3, 1],
      ['dress', 4, 1, 2, 1],
      ['bed2', 0, 2],
      ['living', 1, 2, 3, 1],
      ['bed1', 4, 2, 2, 1],
    ],
  },
  {
    kind: 'house-20-a',
    label: '단독주택 · LDK 2침실',
    collection: 'house',
    reference: '20평대 단독주택, 주방·식당·거실을 한 공간으로 튼 LDK와 침실 두 개, 남쪽 모서리 현관',
    columns: [300, 170, 180, 330],
    rows: [220, 160, 220, 150],
    cells: [
      ['bed2', 0, 0, 1, 2],
      ['bath1', 1, 0],
      ['utility', 2, 0],
      ['kitchen', 3, 0, 1, 2],
      ['dining', 1, 1, 2, 1],
      ['bed1', 0, 2, 1, 2],
      ['living', 1, 2, 3, 1],
      ['living', 1, 3, 2, 1],
      ['foyer', 3, 3],
    ],
  },
  {
    kind: 'house-20-b',
    label: '단독주택 · 북쪽 현관형',
    collection: 'house',
    reference: '20평대 중반 단독주택, 북쪽 현관이 거실로 이어지고 주방·식당을 남향 거실과 튼 구조',
    columns: [280, 160, 150, 180, 290],
    rows: [240, 160, 380],
    cells: [
      ['bed2', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['utility', 3, 0],
      ['kitchen', 4, 0],
      ['living', 0, 1, 3, 1],
      ['dining', 3, 1, 2, 1],
      ['bed3', 0, 2],
      ['living', 1, 2, 3, 1],
      ['bed1', 4, 2],
    ],
  },
  {
    kind: 'house-20-c',
    label: '단독주택 · 침실동 분리형',
    collection: 'house',
    reference: '20평대 후반 전원주택, 서쪽에 침실 세 개를 모으고 동쪽에 주방·다용도실·욕실·현관을 둔 구조',
    columns: [300, 180, 180, 240, 170],
    rows: [290, 280, 300],
    cells: [
      ['bed1', 0, 0],
      ['dining', 1, 0, 2, 1],
      ['kitchen', 3, 0],
      ['utility', 4, 0],
      ['bed2', 0, 1],
      ['living', 1, 1, 3, 1],
      ['bath1', 4, 1],
      ['bed3', 0, 2],
      ['living', 1, 2, 3, 1],
      ['foyer', 4, 2],
    ],
  },

  // ── 30평대 ──────────────────────────────────────────────────────────────
  {
    kind: 'apt-30-74',
    label: '74㎡ 아파트 · 3베이',
    collection: 'apartment',
    pyeong: 30,
    reference: '전용 74㎡(공급 30평) 3베이, 주방 옆 다용도실과 식당, 안방 드레스룸·부부욕실',
    columns: [280, 140, 160, 260, 130, 190],
    rows: [230, 150, 350],
    cells: [
      ['bed3', 0, 0, 1, 2],
      ['foyer', 1, 0],
      ['bath1', 2, 0],
      ['kitchen', 3, 0],
      ['utility', 4, 0],
      ['bath2', 5, 0],
      ['living', 1, 1],
      ['dining', 2, 1, 2, 1],
      ['dress', 4, 1, 2, 1],
      ['bed2', 0, 2],
      ['living', 1, 2, 3, 1],
      ['bed1', 4, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-30-84a',
    label: '84㎡ 국평 아파트 · 4베이',
    collection: 'apartment',
    pyeong: 34,
    reference: '국평 84㎡(공급 34평) 4베이 판상형, 남쪽에 침실 2·3·거실·안방, 북쪽에 현관·욕실·다용도실·주방',
    columns: [170, 90, 60, 190, 200, 200, 160, 170],
    rows: [230, 130, 350],
    cells: [
      ['bath1', 0, 0],
      ['foyer', 1, 0, 2, 1],
      ['utility', 3, 0],
      ['kitchen', 4, 0, 2, 1],
      ['bath2', 6, 0, 2, 1],
      ['living', 0, 1, 6, 1],
      ['dress', 6, 1, 2, 1],
      ['bed2', 0, 2, 2, 1],
      ['bed3', 2, 2, 2, 1],
      ['living', 4, 2, 2, 1],
      ['bed1', 6, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-30-84b',
    label: '84㎡ 국평 아파트 · 타워형',
    collection: 'apartment',
    pyeong: 34,
    reference: '국평 84㎡ 타워형, 모서리 거실과 주방을 남쪽에 나란히 두고 안방을 서쪽 끝에 둔 구조',
    columns: [180, 180, 170, 170, 270, 270],
    rows: [230, 120, 340],
    cells: [
      ['bath2', 0, 0],
      ['dress', 1, 0],
      ['foyer', 2, 0],
      ['bath1', 3, 0],
      ['bed3', 4, 0],
      ['bed2', 5, 0],
      ['bed1', 0, 1, 2, 2],
      ['living', 2, 1, 4, 1],
      ['kitchen', 2, 2, 2, 1],
      ['living', 4, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-30-92',
    label: '92㎡ 아파트 · 포룸',
    collection: 'apartment',
    pyeong: 39,
    reference: '전용 92㎡(공급 39평) 4베이, 북쪽에 침실 하나를 더한 침실 4·욕실 2 구조',
    columns: [270, 150, 140, 180, 240, 160, 180],
    rows: [240, 130, 360],
    cells: [
      ['bed4', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['utility', 3, 0],
      ['kitchen', 4, 0],
      ['bath2', 5, 0, 2, 1],
      ['living', 0, 1, 5, 1],
      ['dress', 5, 1, 2, 1],
      ['bed2', 0, 2],
      ['bed3', 1, 2, 2, 1],
      ['living', 3, 2, 2, 1],
      ['bed1', 5, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-30-a',
    label: '빌라 쓰리룸 · 베란다형',
    collection: 'villa',
    reference: '30평대 빌라, 남쪽 전면 베란다를 거실 샷시로 드나드는 비확장형 구조',
    columns: [300, 170, 150, 260, 180, 180],
    rows: [250, 160, 360, 130],
    cells: [
      ['bed3', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['kitchen', 3, 0],
      ['bath2', 4, 0, 2, 1],
      ['living', 0, 1, 3, 1],
      ['dining', 3, 1],
      ['dress', 4, 1, 2, 1],
      ['bed2', 0, 2],
      ['living', 1, 2, 3, 1],
      ['bed1', 4, 2, 2, 1],
      ['balcony', 0, 3, 6, 1],
    ],
  },
  {
    kind: 'villa-30-b',
    label: '빌라 쓰리룸 · 중형',
    collection: 'villa',
    reference: '30평대 빌라, 주방 옆 다용도실과 식당을 두고 안방에 드레스룸·부부욕실을 붙인 구조',
    columns: [300, 150, 170, 300, 150, 220],
    rows: [260, 170, 400],
    cells: [
      ['bed3', 0, 0, 1, 2],
      ['foyer', 1, 0],
      ['bath1', 2, 0],
      ['kitchen', 3, 0],
      ['utility', 4, 0],
      ['bath2', 5, 0],
      ['living', 1, 1],
      ['dining', 2, 1, 2, 1],
      ['dress', 4, 1, 2, 1],
      ['bed2', 0, 2],
      ['living', 1, 2, 3, 1],
      ['bed1', 4, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-30-c',
    label: '빌라 포룸 · 30평',
    collection: 'villa',
    reference: '30평대 후반 빌라, 북쪽에 침실 하나를 더해 침실 4·욕실 2로 나눈 구조',
    columns: [290, 160, 150, 190, 260, 170, 190],
    rows: [260, 150, 400],
    cells: [
      ['bed4', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['utility', 3, 0],
      ['kitchen', 4, 0],
      ['bath2', 5, 0, 2, 1],
      ['living', 0, 1, 5, 1],
      ['dress', 5, 1, 2, 1],
      ['bed2', 0, 2],
      ['bed3', 1, 2, 2, 1],
      ['living', 3, 2, 2, 1],
      ['bed1', 5, 2, 2, 1],
    ],
  },
  {
    kind: 'house-30-a',
    label: '단독주택 · 서재형',
    collection: 'house',
    reference: '30평 단독주택, 서쪽에 침실 두 개와 서재를 모으고 동쪽에 주방·욕실·현관을 둔 구조',
    columns: [330, 200, 200, 260, 180],
    rows: [300, 280, 310],
    cells: [
      ['bed1', 0, 0],
      ['dining', 1, 0, 2, 1],
      ['kitchen', 3, 0],
      ['utility', 4, 0],
      ['study', 0, 1],
      ['living', 1, 1, 3, 1],
      ['bath1', 4, 1],
      ['bed2', 0, 2],
      ['living', 1, 2, 3, 1],
      ['foyer', 4, 2],
    ],
  },
  {
    kind: 'house-30-b',
    label: '단독주택 · 남향 현관형',
    collection: 'house',
    reference: '30평대 단독주택, 마당 쪽 현관이 거실로 열리고 안방에 드레스룸·부부욕실을 둔 구조',
    columns: [300, 160, 170, 280, 160, 190],
    rows: [260, 160, 230, 170],
    cells: [
      ['bed3', 0, 0],
      ['bath1', 1, 0],
      ['utility', 2, 0],
      ['kitchen', 3, 0],
      ['bath2', 4, 0, 2, 1],
      ['living', 0, 1, 2, 1],
      ['dining', 2, 1, 2, 1],
      ['dress', 4, 1, 2, 1],
      ['bed2', 0, 2, 1, 2],
      ['living', 1, 2, 3, 1],
      ['foyer', 1, 3],
      ['living', 2, 3, 2, 1],
      ['bed1', 4, 2, 2, 2],
    ],
  },
  {
    kind: 'house-30-c',
    label: '전원주택 · 4베이',
    collection: 'house',
    reference: '30평대 전원주택, 남쪽에 방 셋과 거실을 나란히 둔 4베이 단층',
    columns: [180, 100, 60, 200, 230, 230, 170, 180],
    rows: [260, 160, 400],
    cells: [
      ['bath1', 0, 0],
      ['foyer', 1, 0, 2, 1],
      ['utility', 3, 0],
      ['kitchen', 4, 0, 2, 1],
      ['bath2', 6, 0, 2, 1],
      ['living', 0, 1, 6, 1],
      ['dress', 6, 1, 2, 1],
      ['bed2', 0, 2, 2, 1],
      ['bed3', 2, 2, 2, 1],
      ['living', 4, 2, 2, 1],
      ['bed1', 6, 2, 2, 1],
    ],
  },

  // ── 40평대 ──────────────────────────────────────────────────────────────
  {
    kind: 'apt-40-101',
    label: '101㎡ 아파트 · 4베이',
    collection: 'apartment',
    pyeong: 41,
    reference: '전용 101㎡(공급 41평) 4베이 판상형, 주방 앞 식당과 다용도실, 드레스룸을 지나는 부부욕실',
    columns: [180, 100, 60, 200, 220, 220, 180, 190],
    rows: [240, 180, 370],
    cells: [
      ['bath1', 0, 0],
      ['foyer', 1, 0, 2, 1],
      ['utility', 3, 0],
      ['kitchen', 4, 0, 2, 1],
      ['bath2', 6, 0, 2, 1],
      ['living', 0, 1, 5, 1],
      ['dining', 5, 1],
      ['dress', 6, 1, 2, 1],
      ['bed2', 0, 2, 2, 1],
      ['bed3', 2, 2, 2, 1],
      ['living', 4, 2, 2, 1],
      ['bed1', 6, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-40-105',
    label: '105㎡ 아파트 · 포룸',
    collection: 'apartment',
    pyeong: 42,
    reference: '전용 105㎡(공급 42평) 4베이, 침실 4와 식당, 드레스룸을 지나는 부부욕실',
    columns: [280, 160, 150, 190, 240, 200, 180],
    rows: [240, 170, 370],
    cells: [
      ['bed4', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['utility', 3, 0],
      ['kitchen', 4, 0],
      ['bath2', 5, 0, 2, 1],
      ['living', 0, 1, 4, 1],
      ['dining', 4, 1],
      ['dress', 5, 1, 2, 1],
      ['bed2', 0, 2],
      ['bed3', 1, 2, 2, 1],
      ['living', 3, 2, 2, 1],
      ['bed1', 5, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-40-114',
    label: '114㎡ 아파트 · 서재형',
    collection: 'apartment',
    pyeong: 43,
    reference: '전용 114㎡(공급 43평) 판상형, 북쪽 서재와 식당, 드레스룸을 지나는 부부욕실',
    columns: [280, 170, 150, 200, 260, 200, 200],
    rows: [250, 170, 380],
    cells: [
      ['study', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['utility', 3, 0],
      ['kitchen', 4, 0],
      ['bath2', 5, 0, 2, 1],
      ['living', 0, 1, 4, 1],
      ['dining', 4, 1],
      ['dress', 5, 1, 2, 1],
      ['bed2', 0, 2],
      ['bed3', 1, 2, 2, 1],
      ['living', 3, 2, 2, 1],
      ['bed1', 5, 2, 2, 1],
    ],
  },
  {
    kind: 'apt-40-118',
    label: '118㎡ 아파트 · 타워형',
    collection: 'apartment',
    pyeong: 45,
    reference: '전용 118㎡(공급 45평) 타워형, 모서리 거실과 주방·식당을 남쪽에 나란히 두고 안방을 서쪽 끝에 둔 구조',
    columns: [190, 190, 160, 170, 240, 290, 290],
    rows: [260, 150, 390],
    cells: [
      ['bath2', 0, 0],
      ['dress', 1, 0],
      ['foyer', 2, 0],
      ['bath1', 3, 0],
      ['utility', 4, 0],
      ['bed3', 5, 0],
      ['bed2', 6, 0],
      ['bed1', 0, 1, 2, 2],
      ['living', 2, 1, 5, 1],
      ['kitchen', 2, 2, 2, 1],
      ['dining', 4, 2],
      ['living', 5, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-40-a',
    label: '빌라 포룸 · 40평',
    collection: 'villa',
    reference: '40평대 빌라, 침실 4·욕실 2와 다용도실을 둔 4베이 구조',
    columns: [310, 170, 160, 200, 280, 180, 200],
    rows: [280, 180, 440],
    cells: [
      ['bed4', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['utility', 3, 0],
      ['kitchen', 4, 0],
      ['bath2', 5, 0, 2, 1],
      ['living', 0, 1, 5, 1],
      ['dress', 5, 1, 2, 1],
      ['bed2', 0, 2],
      ['bed3', 1, 2, 2, 1],
      ['living', 3, 2, 2, 1],
      ['bed1', 5, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-40-b',
    label: '빌라 쓰리룸 · 40평 식당형',
    collection: 'villa',
    reference: '40평대 중반 빌라, 주방 앞 식당을 거실과 튼 4베이 대형 평면',
    columns: [210, 110, 80, 230, 250, 250, 200, 210],
    rows: [280, 190, 440],
    cells: [
      ['bath1', 0, 0],
      ['foyer', 1, 0, 2, 1],
      ['utility', 3, 0],
      ['kitchen', 4, 0, 2, 1],
      ['bath2', 6, 0, 2, 1],
      ['living', 0, 1, 5, 1],
      ['dining', 5, 1],
      ['dress', 6, 1, 2, 1],
      ['bed2', 0, 2, 2, 1],
      ['bed3', 2, 2, 2, 1],
      ['living', 4, 2, 2, 1],
      ['bed1', 6, 2, 2, 1],
    ],
  },
  {
    kind: 'villa-40-c',
    label: '빌라 펜트하우스 · 40평',
    collection: 'villa',
    reference: '40평대 후반 빌라 펜트하우스, 넓은 LDK와 침실 세 개, 남쪽 전면 테라스',
    columns: [340, 190, 180, 320, 200, 220],
    rows: [290, 190, 420, 160],
    cells: [
      ['bed3', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['kitchen', 3, 0],
      ['bath2', 4, 0, 2, 1],
      ['living', 0, 1, 3, 1],
      ['dining', 3, 1],
      ['dress', 4, 1, 2, 1],
      ['bed2', 0, 2],
      ['living', 1, 2, 3, 1],
      ['bed1', 4, 2, 2, 1],
      ['balcony', 0, 3, 6, 1],
    ],
  },
  {
    kind: 'house-40-a',
    label: '단독주택 · 40평 서재형',
    collection: 'house',
    reference: '40평 단독주택, 북쪽 서재와 남쪽 방 셋, 드레스룸을 지나는 부부욕실',
    columns: [310, 180, 160, 210, 280, 190, 200],
    rows: [300, 190, 400],
    cells: [
      ['study', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['utility', 3, 0],
      ['kitchen', 4, 0],
      ['bath2', 5, 0, 2, 1],
      ['living', 0, 1, 5, 1],
      ['dress', 5, 1, 2, 1],
      ['bed2', 0, 2],
      ['bed3', 1, 2, 2, 1],
      ['living', 3, 2, 2, 1],
      ['bed1', 5, 2, 2, 1],
    ],
  },
  {
    kind: 'house-40-b',
    label: '단독주택 · 45평 남향 현관형',
    collection: 'house',
    reference: '40평대 중반 단독주택, 마당 쪽 현관이 넓은 거실로 열리고 안방에 드레스룸·부부욕실을 둔 구조',
    columns: [340, 190, 200, 330, 200, 230],
    rows: [300, 190, 290, 220],
    mirror: true,
    cells: [
      ['bed3', 0, 0],
      ['bath1', 1, 0],
      ['utility', 2, 0],
      ['kitchen', 3, 0],
      ['bath2', 4, 0, 2, 1],
      ['living', 0, 1, 2, 1],
      ['dining', 2, 1, 2, 1],
      ['dress', 4, 1, 2, 1],
      ['bed2', 0, 2, 1, 2],
      ['living', 1, 2, 3, 1],
      ['foyer', 1, 3],
      ['living', 2, 3, 2, 1],
      ['bed1', 4, 2, 2, 2],
    ],
  },
  {
    kind: 'house-40-c',
    label: '전원주택 · 48평',
    collection: 'house',
    reference: '40평대 후반 전원주택, 서재·식당을 더한 4베이 단층과 드레스룸을 지나는 부부욕실',
    columns: [300, 180, 160, 220, 280, 210, 220],
    rows: [340, 210, 440],
    cells: [
      ['study', 0, 0],
      ['bath1', 1, 0],
      ['foyer', 2, 0],
      ['utility', 3, 0],
      ['kitchen', 4, 0],
      ['bath2', 5, 0, 2, 1],
      ['living', 0, 1, 4, 1],
      ['dining', 4, 1],
      ['dress', 5, 1, 2, 1],
      ['bed2', 0, 2],
      ['bed3', 1, 2, 2, 1],
      ['living', 3, 2, 2, 1],
      ['bed1', 5, 2, 2, 1],
    ],
  },
];

export const PRESETS: Record<PresetKind, PresetEntry> = Object.fromEntries(
  PRESET_DEFINITIONS.map((def) => {
    const entry = definePreset(def);
    return [entry.spec.kind, entry];
  }),
);

export const PRESET_KINDS: PresetKind[] = PRESET_DEFINITIONS.map((def) => def.kind);

export const PRESET_BANDS: PyeongBand[] = [10, 20, 30, 40];

export function presetAreaM2(spec: PresetSpec): number {
  return round1((spec.width * spec.depth) / 10000);
}

export function actualPyeong(spec: PresetSpec): number {
  return round1(presetAreaM2(spec) / PYEONG_M2);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** localStorage·프로젝트 파일에 저장된 프리셋 spec을 검사한다. 구조가 맞지 않으면 null. */
export function parsePresetSpec(value: unknown): PresetSpec | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (typeof kind !== 'string' || !(kind in PRESETS)) return null;
  const { rooms, baths, width, depth, columns, rows, cells } = value;
  if (!Number.isInteger(rooms) || (rooms as number) < 1) return null;
  if (!Number.isInteger(baths) || (baths as number) < 1) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(depth)) return null;
  if (!Array.isArray(columns) || !columns.every(isFiniteNumber)) return null;
  if (!Array.isArray(rows) || !rows.every(isFiniteNumber)) return null;
  if (!Array.isArray(cells) || !cells.every(isGridCell)) return null;

  const spec: PresetSpec = {
    kind,
    rooms: rooms as number,
    baths: baths as number,
    width,
    depth,
    columns: columns.slice() as number[],
    rows: rows.slice() as number[],
    cells: cells.map((c) => ({ ...c })),
  };

  const roomKeys = new Set(spec.cells.map((cell) => cell.room));
  const roomBaths = [...roomKeys].filter((room) => room.startsWith('bath')).length;
  if (spec.baths !== roomBaths || spec.rooms !== roomKeys.size - roomBaths) return null;

  try {
    buildPresetPlan(spec);
  } catch {
    return null;
  }
  return spec;
}

function isGridCell(value: unknown): value is GridCell {
  if (!isRecord(value)) return false;
  const { room, col, colSpan, row, rowSpan } = value;
  return (
    typeof room === 'string' &&
    room.length > 0 &&
    Number.isInteger(col) &&
    Number.isInteger(colSpan) &&
    Number.isInteger(row) &&
    Number.isInteger(rowSpan) &&
    (col as number) >= 0 &&
    (row as number) >= 0 &&
    (colSpan as number) >= 1 &&
    (rowSpan as number) >= 1
  );
}

interface Grid {
  xs: number[];
  ys: number[];
  occ: (string | null)[][];
}

/** 열·행 합이 width/depth와 맞는지, 칸이 겹치거나 비지 않는지 확인한다. */
function buildGrid(spec: PresetSpec): Grid {
  if (!isFiniteNumber(spec.width) || spec.width <= 0) throw new Error('프리셋 폭이 올바르지 않습니다.');
  if (!isFiniteNumber(spec.depth) || spec.depth <= 0) throw new Error('프리셋 깊이가 올바르지 않습니다.');
  if (!spec.columns.length || !spec.rows.length) throw new Error('프리셋 격자가 비어 있습니다.');

  const xs = [0];
  for (const c of spec.columns) {
    if (!isFiniteNumber(c) || c <= 0) throw new Error('열 너비는 0보다 커야 합니다.');
    xs.push(xs[xs.length - 1] + c);
  }
  const ys = [0];
  for (const r of spec.rows) {
    if (!isFiniteNumber(r) || r <= 0) throw new Error('행 높이는 0보다 커야 합니다.');
    ys.push(ys[ys.length - 1] + r);
  }
  if (Math.abs(xs[xs.length - 1] - spec.width) > EPS) throw new Error('열 너비 합이 프리셋 폭과 다릅니다.');
  if (Math.abs(ys[ys.length - 1] - spec.depth) > EPS) throw new Error('행 높이 합이 프리셋 깊이와 다릅니다.');

  const cols = spec.columns.length;
  const rows = spec.rows.length;
  const occ: (string | null)[][] = Array.from({ length: cols }, () => Array<string | null>(rows).fill(null));
  for (const cell of spec.cells) {
    if (!Number.isInteger(cell.col) || !Number.isInteger(cell.row) || cell.col < 0 || cell.row < 0) {
      throw new Error('격자 칸 위치가 올바르지 않습니다.');
    }
    if (cell.colSpan < 1 || cell.rowSpan < 1 || cell.col + cell.colSpan > cols || cell.row + cell.rowSpan > rows) {
      throw new Error('격자 칸이 격자 범위를 벗어납니다.');
    }
    for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
        if (occ[c][r]) throw new Error('격자 칸이 겹칩니다.');
        occ[c][r] = cell.room;
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!occ[c][r]) throw new Error('비어 있는 격자 칸이 있습니다.');
    }
  }
  return { xs, ys, occ };
}

type Ring = [number, number][];

function rectRing(x0: number, y0: number, x1: number, y1: number): Ring {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

function roomFloor(room: string): FloorKind {
  if (room.startsWith('bath') || room === 'utility' || room === 'balcony' || room === 'foyer') return 'tile';
  if (room === 'kitchen') return 'kitchen';
  return 'wood';
}

function roomName(room: string, spec: PresetSpec): string {
  if (room === 'living') return '거실';
  if (room === 'kitchen') return '주방';
  if (room === 'dining') return '식당';
  if (room === 'hall') return '복도';
  if (room === 'foyer') return '현관';
  if (room.startsWith('bed')) return `침실 ${room.slice(3)}`;
  if (room.startsWith('bath')) return spec.baths > 1 ? `욕실 ${room.slice(4)}` : '욕실';
  if (room === 'study') return '서재';
  if (room === 'dress') return '드레스룸';
  if (room === 'utility') return '다용도실';
  if (room === 'balcony') return '베란다';
  return room;
}

interface Segment {
  a: Vec2;
  b: Vec2;
  exterior: boolean;
}

interface BoundaryUnit {
  /** 위/왼쪽 칸의 방. 바깥이면 null */
  roomA: string | null;
  /** 아래/오른쪽 칸의 방. 바깥이면 null */
  roomB: string | null;
  horizontal: boolean;
  a: Vec2;
  b: Vec2;
}

interface MergedBoundary {
  a: Vec2;
  b: Vec2;
  horizontal: boolean;
  /** 이 경계에서 room 쪽으로 향하는 단위 법선 */
  normal: Vec2;
  length: number;
}

type PassageType = 'door' | 'opening' | 'sash' | 'open';

interface DoorPlan {
  child: string;
  parent: string;
  boundary: MergedBoundary;
  width: number;
  /** open이면 두 방 사이에 벽도 문도 만들지 않는다 */
  type: PassageType;
}

/** 서로 벽 없이 트인 생활 공간. 거실·주방·식당이 맞닿은 경계에는 벽을 세우지 않는다. */
const OPEN_PLAN = new Set(['living', 'kitchen', 'dining']);

/** 싱크대 상판 높이. 창턱이 이보다 높은 창 아래에는 싱크대를 붙인다. */
const COUNTER_HEIGHT = 85;

const isOpenPlanPair = (a: string, b: string) => a !== b && OPEN_PLAN.has(a) && OPEN_PLAN.has(b);

/** 부부욕실. bath1은 공용 욕실이고 bath2부터는 안방(bed1)이나 드레스룸으로 드나든다. */
const isEnsuiteBath = (room: string) => room.startsWith('bath') && room !== 'bath1';

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 방 폴리곤(내벽 중심선, 외벽 안쪽 면 기준)과 벽·문·창을 만든다. */
export function buildPresetPlan(spec: PresetSpec): FloorPlan {
  const { xs, ys, occ } = buildGrid(spec);
  const cols = spec.columns.length;
  const rows = spec.rows.length;

  const cellsByRoom = new Map<string, GridCell[]>();
  for (const cell of spec.cells) {
    const list = cellsByRoom.get(cell.room) ?? [];
    list.push(cell);
    cellsByRoom.set(cell.room, list);
  }

  const rooms: Room[] = [];
  for (const [key, cells] of cellsByRoom) {
    const polygons: Ring[][] = cells.map((cell) => [
      rectRing(
        xs[cell.col],
        ys[cell.row],
        xs[cell.col + cell.colSpan],
        ys[cell.row + cell.rowSpan],
      ),
    ]);
    const merged = polygonClipping.union(polygons[0], ...polygons.slice(1));
    const rings = merged
      .map((poly) => poly[0].slice(0, -1) as Vec2[])
      .filter((ring) => ring.length >= 3)
      .sort((p, q) => polygonArea(q) - polygonArea(p));
    if (!rings.length) throw new Error(`방 ${key}의 다각형을 만들지 못했습니다.`);

    const cellSize = (cell: GridCell) =>
      (xs[cell.col + cell.colSpan] - xs[cell.col]) * (ys[cell.row + cell.rowSpan] - ys[cell.row]);
    const largest = cells.slice().sort((p, q) => cellSize(q) - cellSize(p))[0];
    const labelAt: Vec2 = [
      (xs[largest.col] + xs[largest.col + largest.colSpan]) / 2,
      (ys[largest.row] + ys[largest.row + largest.rowSpan]) / 2,
    ];
    rooms.push({
      id: key,
      name: roomName(key, spec),
      floor: roomFloor(key),
      polygon: rings[0],
      labelAt,
    });
  }

  // 격자 경계를 훑어 방 사이 경계와 인접 관계를 모은다.
  const boundaries: BoundaryUnit[] = [];
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const above = r > 0 ? occ[c][r - 1] : null;
      const below = r < rows ? occ[c][r] : null;
      if (above && below && above !== below) link(above, below);
      boundaries.push({ roomA: above, roomB: below, horizontal: true, a: [xs[c], ys[r]], b: [xs[c + 1], ys[r]] });
    }
  }

  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) {
      const left = c > 0 ? occ[c - 1][r] : null;
      const right = c < cols ? occ[c][r] : null;
      if (left && right && left !== right) link(left, right);
      boundaries.push({ roomA: left, roomB: right, horizontal: false, a: [xs[c], ys[r]], b: [xs[c], ys[r + 1]] });
    }
  }

  const entry = PRESETS[spec.kind];
  const doorPlans = connectRooms(boundaries, adjacency, cellsByRoom, entry?.doors);

  // 거실·주방·식당끼리, 그리고 현관과 현관이 열리는 방 사이는 벽 없이 튼다.
  const openPairs = new Set<string>();
  for (const [room, neighbors] of adjacency) {
    for (const other of neighbors) if (isOpenPlanPair(room, other)) openPairs.add(pairKey(room, other));
  }
  for (const plan of doorPlans) if (plan.type === 'open') openPairs.add(pairKey(plan.child, plan.parent));
  const isOpen = (a: string, b: string) => openPairs.has(pairKey(a, b));

  // 같은 방이거나 트인 경계에는 벽을 만들지 않는다.
  const horizontal: Segment[] = [];
  const vertical: Segment[] = [];
  for (const unit of boundaries) {
    const { roomA, roomB } = unit;
    if (!roomA && !roomB) continue;
    if (roomA && roomB && (roomA === roomB || isOpen(roomA, roomB))) continue;
    (unit.horizontal ? horizontal : vertical).push({ a: unit.a, b: unit.b, exterior: !roomA || !roomB });
  }

  const walls: Wall[] = [];
  const counters = { extH: 0, extV: 0, intH: 0, intV: 0 };
  for (const seg of mergeSegments(horizontal, true)) {
    const id = seg.exterior ? `ext-h-${counters.extH++}` : `int-h-${counters.intH++}`;
    walls.push({ id, from: seg.a, to: seg.b, ...(seg.exterior ? { exterior: true } : {}) });
  }
  for (const seg of mergeSegments(vertical, false)) {
    const id = seg.exterior ? `ext-v-${counters.extV++}` : `int-v-${counters.intV++}`;
    walls.push({ id, from: seg.a, to: seg.b, ...(seg.exterior ? { exterior: true } : {}) });
  }

  const openings: Opening[] = [];
  const openingSpans: OpeningSpan[] = [];
  for (const plan of doorPlans) {
    if (plan.type === 'open') continue;
    const at = midpoint(plan.boundary.a, plan.boundary.b);
    openings.push({
      id: plan.type === 'sash' ? `sash-inner-${plan.child}` : `${plan.type}-${plan.child}`,
      type: plan.type,
      at,
      width: plan.width,
      height: 210,
      // boundary.normal은 child 방 안쪽을 향하므로, 문이 열리는 부모 쪽은 반대다
      ...(plan.type === 'door'
        ? { opensToward: add(at, scaleVec(plan.boundary.normal, -30)), hinge: 'start' as const }
        : {}),
    });
    openingSpans.push(spanOf(plan.boundary, at, plan.width));
  }

  const entrance = chooseEntrance(boundaries, cellsByRoom);
  openings.push({
    id: 'entrance',
    type: 'entrance',
    at: entrance.at,
    width: 90,
    height: 210,
    opensToward: add(entrance.at, scaleVec(entrance.normal, 30)),
    hinge: 'start',
  });
  openingSpans.push(spanOf(entrance.boundary, entrance.at, 90));

  // 베란다로 드나드는 방은 베란다 샷시로 빛을 받으므로 바깥 창을 따로 내지 않는다
  const behindBalcony = new Set(doorPlans.filter((plan) => plan.type === 'sash').map((plan) => plan.parent));
  addWindows(openings, openingSpans, boundaries, cellsByRoom, behindBalcony);
  const fixtures = addSink(openingSpans, boundaries, adjacency, cellsByRoom, isOpen);

  const label = entry?.label ?? `프리셋 ${spec.kind}`;
  const pyeong = entry?.pyeong ?? actualPyeong(spec);
  const area = presetAreaM2(spec);
  const bedrooms = [...cellsByRoom.keys()].filter((room) => room.startsWith('bed')).length;
  const roomText = bedrooms === 0 ? '원룸' : `침실 ${bedrooms}개`;
  return {
    version: 1,
    id: `preset-${spec.kind}`,
    name: label,
    source: 'Spiti 구조 프리셋',
    unit: 'cm',
    wallHeight: WALL_HEIGHT,
    thickness: { exterior: EXTERIOR, interior: INTERIOR },
    rooms,
    walls,
    openings,
    fixtures,
    notes: [
      `${entry?.collectionLabel ?? '주거'} ${pyeong}평형(${area}㎡) · ${roomText} · 욕실 ${spec.baths}개 구조입니다.`,
    ],
  };
}

/** child 방을 parent 방에 이을 때의 우선순위. 작을수록 먼저 고른다. */
function connectionWeight(child: string, parent: string): number {
  if (isOpenPlanPair(child, parent)) return -1;
  if (child === 'foyer') {
    if (parent === 'living' || parent === 'hall') return 0;
    return OPEN_PLAN.has(parent) ? 1 : 9;
  }
  if (child === 'hall') return parent === 'living' ? 0 : 1;
  if (child === 'kitchen' || child === 'dining') return parent === 'hall' || parent === 'foyer' ? 1 : 4;
  if (child === 'utility') {
    if (parent === 'kitchen') return 0;
    if (parent === 'dining') return 1;
    return parent === 'living' || parent === 'hall' ? 2 : 9;
  }
  if (child === 'balcony') {
    if (parent === 'living') return 0;
    if (parent.startsWith('bed')) return 1;
    return OPEN_PLAN.has(parent) ? 2 : 9;
  }
  // 드레스룸은 안방으로, 부부욕실은 안방이나 드레스룸으로 드나든다
  if (child === 'dress') {
    if (parent === 'bed1') return 0;
    return parent.startsWith('bed') ? 1 : 5;
  }
  if (isEnsuiteBath(child) && (parent === 'bed1' || parent === 'dress')) return 0;
  if (parent === 'living' || parent === 'hall') return 1;
  if (parent === 'dining') return 2;
  if (parent === 'kitchen' || parent === 'foyer') return 3;
  return 9;
}

function passageType(child: string, parent: string): PassageType {
  if (isOpenPlanPair(child, parent)) return 'open';
  // 현관은 신발장 쪽 벽만 두고 거실·주방 쪽은 단차만 둔 채 튼다
  if (child === 'foyer' && (OPEN_PLAN.has(parent) || parent === 'hall')) return 'open';
  if (child === 'balcony') return 'sash';
  if (OPEN_PLAN.has(child) || child === 'hall' || child === 'foyer') return 'opening';
  return 'door';
}

/** 개구부 폭. 경계 양 끝에 10cm 이상 벽을 남긴다. relaxed면 짧은 경계에도 좁은 문을 낸다. */
function passageWidth(child: string, type: PassageType, boundaryLength: number, relaxed: boolean): number | null {
  if (type === 'open') return 0;
  const maxWidth = boundaryLength - 20;
  if (maxWidth < (relaxed ? 40 : 60)) return null;
  if (type === 'sash') return Math.min(360, maxWidth);
  if (type === 'opening') return Math.min(120, maxWidth);
  const desired = child.startsWith('bath') || child === 'utility' || child === 'dress' ? 70 : 80;
  return Math.min(desired, maxWidth);
}

/**
 * 거실에서 시작해 모든 방을 잇는 문 배치를 고른다(Prim 방식).
 * 거실·주방·식당은 벽 없이 먼저 잇고, 나머지 방은 connectionWeight가 작은 이웃에 문을 낸다.
 * 정해진 폭의 문을 낼 곳이 없을 때만 짧은 경계에 좁은 문을 낸다.
 */
function connectRooms(
  boundaries: BoundaryUnit[],
  adjacency: Map<string, Set<string>>,
  cellsByRoom: Map<string, GridCell[]>,
  doors: Record<string, string> | undefined,
): DoorPlan[] {
  if (!cellsByRoom.has('living')) throw new Error('거실이 없는 프리셋은 만들 수 없습니다.');
  const cache = new Map<string, MergedBoundary[]>();
  const between = (child: string, parent: string): MergedBoundary[] => {
    const key = `${child}|${parent}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const segs = mergeRoomBoundaries(boundaries, child, parent).sort((p, q) => q.length - p.length);
    cache.set(key, segs);
    return segs;
  };

  const visited = new Set<string>(['living']);
  const pick = (relaxed: boolean): (DoorPlan & { weight: number }) | null => {
    let best: (DoorPlan & { weight: number }) | null = null;
    for (const parent of visited) {
      for (const child of adjacency.get(parent) ?? []) {
        if (visited.has(child)) continue;
        const boundary = between(child, parent)[0];
        if (!boundary) continue;
        const type = passageType(child, parent);
        const width = passageWidth(child, type, boundary.length, relaxed);
        if (width === null) continue;
        const rank = doors?.[child] === parent ? -2 : connectionWeight(child, parent);
        const weight = rank * 1_000_000 - boundary.length;
        if (!best || weight < best.weight) best = { child, parent, boundary, width, type, weight };
      }
    }
    return best;
  };

  const plans: DoorPlan[] = [];
  while (visited.size < cellsByRoom.size) {
    const best = pick(false) ?? pick(true);
    if (!best) throw new Error('모든 방을 연결하는 문 배치를 찾지 못했습니다.');
    visited.add(best.child);
    plans.push({ child: best.child, parent: best.parent, boundary: best.boundary, width: best.width, type: best.type });
  }
  return plans;
}

function chooseEntrance(
  boundaries: BoundaryUnit[],
  cellsByRoom: Map<string, GridCell[]>,
): { at: Vec2; normal: Vec2; boundary: MergedBoundary } {
  // 현관이 따로 있으면 현관 바깥벽에 문을 낸다. 너무 좁아 문을 놓을 수 없을 때만 복도·거실로 돌아간다.
  const foyerSegs = mergeRoomBoundaries(boundaries, 'foyer', null).filter((seg) => seg.length >= 110);
  foyerSegs.sort((p, q) => q.length - p.length);
  if (foyerSegs[0]) return { at: midpoint(foyerSegs[0].a, foyerSegs[0].b), normal: foyerSegs[0].normal, boundary: foyerSegs[0] };

  const rooms = ['hall', 'living'].filter((room) => cellsByRoom.has(room));
  const candidates: MergedBoundary[] = [];
  for (const room of rooms) {
    candidates.push(...mergeRoomBoundaries(boundaries, room, null).filter((seg) => seg.length >= 110));
  }
  candidates.sort((p, q) => q.length - p.length);
  let seg = candidates[0];
  if (!seg) {
    const fallback: MergedBoundary[] = [];
    for (const room of cellsByRoom.keys()) {
      fallback.push(...mergeRoomBoundaries(boundaries, room, null).filter((s) => s.length >= 110));
    }
    fallback.sort((p, q) => q.length - p.length);
    seg = fallback[0];
  }
  if (!seg) throw new Error('현관을 놓을 바깥벽을 찾지 못했습니다.');
  return { at: midpoint(seg.a, seg.b), normal: seg.normal, boundary: seg };
}

interface OpeningSpan {
  horizontal: boolean;
  line: number;
  start: number;
  end: number;
  /** 개구부 아랫변 높이. 문·샷시는 0이다. */
  sill: number;
}

/** 경계 위에 놓인 개구부의 실제 구간. 겹침 판정과 붙박이 배치에 쓴다. */
function spanOf(seg: MergedBoundary, at: Vec2, width: number, sill = 0): OpeningSpan {
  const center = seg.horizontal ? at[0] : at[1];
  return {
    horizontal: seg.horizontal,
    line: seg.horizontal ? seg.a[1] : seg.a[0],
    start: center - width / 2,
    end: center + width / 2,
    sill,
  };
}

function overlaps(a: OpeningSpan, b: OpeningSpan): boolean {
  return (
    a.horizontal === b.horizontal &&
    Math.abs(a.line - b.line) < 1 &&
    a.start < b.end + 10 &&
    b.start < a.end + 10
  );
}

function windowSize(room: string, length: number): { width: number; type: 'sash' | 'window'; sill?: number } | null {
  if (length < 110) return null;
  const maxWidth = length - 20;
  if (room === 'living') return { width: Math.min(320, length - 40), type: 'sash' };
  if (room.startsWith('bed') || room === 'study') return { width: Math.min(180, maxWidth), type: 'sash' };
  if (room === 'kitchen' || room === 'dining') {
    return { width: Math.min(150, maxWidth), type: 'window', sill: 90 };
  }
  if (room.startsWith('bath') || room === 'utility' || room === 'dress') {
    return { width: Math.min(90, maxWidth), type: 'window', sill: 120 };
  }
  if (room === 'balcony') return { width: Math.min(360, maxWidth), type: 'sash' };
  return null;
}

/** 창을 낼 바깥벽 순서. 남쪽(아래)을 먼저, 그다음 북쪽, 옆벽은 이웃 세대와 맞붙는 경우가 많아 마지막에 쓴다. */
function windowSide(seg: MergedBoundary): number {
  if (!seg.horizontal) return 2;
  // 방이 경계 위쪽에 있으면 법선이 위(-y)를 향하고, 그 경계는 방의 남쪽 벽이다
  return seg.normal[1] < 0 ? 0 : 1;
}

function addWindows(
  openings: Opening[],
  used: OpeningSpan[],
  boundaries: BoundaryUnit[],
  cellsByRoom: Map<string, GridCell[]>,
  skip: Set<string>,
): void {
  const order = [...cellsByRoom.keys()].sort((a, b) => windowPriority(a) - windowPriority(b));
  for (const room of order) {
    if (room === 'hall' || skip.has(room)) continue;
    const candidates = mergeRoomBoundaries(boundaries, room, null).sort(
      (p, q) => windowSide(p) - windowSide(q) || q.length - p.length,
    );
    for (const seg of candidates) {
      const size = windowSize(room, seg.length);
      if (!size) continue;
      const at = midpoint(seg.a, seg.b);
      const span = spanOf(seg, at, size.width, size.sill ?? 0);
      if (used.some((existing) => overlaps(span, existing))) continue;
      used.push(span);
      openings.push({
        id: `${size.type}-${room}`,
        type: size.type,
        at,
        width: size.width,
        height: 210,
        ...(size.sill === undefined ? {} : { sill: size.sill }),
      });
      break;
    }
  }
}

function windowPriority(room: string): number {
  if (room === 'living') return 0;
  if (room.startsWith('bed')) return 1;
  if (room === 'kitchen' || room === 'dining') return 2;
  if (room === 'study') return 3;
  if (room.startsWith('bath') || room === 'utility') return 4;
  return 5;
}

function addSink(
  used: OpeningSpan[],
  boundaries: BoundaryUnit[],
  adjacency: Map<string, Set<string>>,
  cellsByRoom: Map<string, GridCell[]>,
  isOpen: (a: string, b: string) => boolean,
): Fixture[] {
  const room = cellsByRoom.has('kitchen') ? 'kitchen' : 'living';
  const exterior = mergeRoomBoundaries(boundaries, room, null).sort((p, q) => q.length - p.length);
  // 트인 경계에는 벽이 없으므로 싱크대를 붙이지 않는다
  const interior: MergedBoundary[] = [];
  for (const other of adjacency.get(room) ?? []) {
    if (isOpen(room, other)) continue;
    interior.push(...mergeRoomBoundaries(boundaries, room, other));
  }
  interior.sort((p, q) => q.length - p.length);

  for (const seg of [...exterior, ...interior]) {
    const width = Math.min(seg.length >= 250 ? 240 : 180, seg.length - 10);
    if (width < 60) continue;
    const at = add(midpoint(seg.a, seg.b), scaleVec(seg.normal, 35));
    const span = spanOf(seg, midpoint(seg.a, seg.b), width);
    // 창턱이 상판보다 높은 주방 창 아래에는 싱크대를 둔다
    if (used.some((existing) => existing.sill < COUNTER_HEIGHT && overlaps(span, existing))) continue;
    return [
      {
        id: 'sink',
        name: '싱크대',
        kind: 'counter',
        at,
        size: [width, 60, 85],
        rotation: Math.round((Math.atan2(seg.normal[0], seg.normal[1]) * 180) / Math.PI),
      },
    ];
  }
  return [];
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

function scaleVec(a: Vec2, s: number): Vec2 {
  return [a[0] * s, a[1] * s];
}

/** 같은 직선에서 이어지는 선분을 하나로 합친다. */
function mergeSegments(segs: Segment[], horizontal: boolean): Segment[] {
  const groups = new Map<number, Segment[]>();
  for (const seg of segs) {
    const key = horizontal ? seg.a[1] : seg.a[0];
    const list = groups.get(key) ?? [];
    list.push(seg);
    groups.set(key, list);
  }

  const out: Segment[] = [];
  for (const [key, list] of groups) {
    list.sort((p, q) => (horizontal ? p.a[0] - q.a[0] : p.a[1] - q.a[1]));
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
      const seg = list[i];
      const currentEnd = horizontal ? current.b[0] : current.b[1];
      const segStart = horizontal ? seg.a[0] : seg.a[1];
      if (seg.exterior === current.exterior && segStart <= currentEnd + EPS) {
        const end = Math.max(currentEnd, horizontal ? seg.b[0] : seg.b[1]);
        current = {
          a: current.a,
          b: horizontal ? [end, key] : [key, end],
          exterior: current.exterior,
        };
      } else {
        out.push(current);
        current = seg;
      }
    }
    out.push(current);
  }
  return out;
}

/**
 * 한 방과 다른 방(또는 바깥) 사이의 경계를 방향별로 합친다.
 * normal은 항상 첫 번째 방(room) 쪽을 향한다.
 */
function mergeRoomBoundaries(
  units: BoundaryUnit[],
  room: string,
  other: string | null,
): MergedBoundary[] {
  const groups = new Map<string, MergedBoundary[]>();
  for (const unit of units) {
    let normal: Vec2 | null = null;
    if (unit.horizontal) {
      // roomA가 위 칸이므로, room이 위에 있으면 방 안쪽은 아래(-y)다
      if (unit.roomA === room && unit.roomB === other) normal = [0, -1];
      else if (unit.roomB === room && unit.roomA === other) normal = [0, 1];
    } else {
      if (unit.roomA === room && unit.roomB === other) normal = [-1, 0];
      else if (unit.roomB === room && unit.roomA === other) normal = [1, 0];
    }
    if (!normal) continue;
    const line = unit.horizontal ? unit.a[1] : unit.a[0];
    const key = `${unit.horizontal ? 'h' : 'v'}:${line}:${normal[0]},${normal[1]}`;
    const list = groups.get(key) ?? [];
    list.push({
      a: unit.a,
      b: unit.b,
      horizontal: unit.horizontal,
      normal,
      length: unit.horizontal ? unit.b[0] - unit.a[0] : unit.b[1] - unit.a[1],
    });
    groups.set(key, list);
  }

  const out: MergedBoundary[] = [];
  for (const [, list] of groups) {
    list.sort((p, q) => (p.horizontal ? p.a[0] - q.a[0] : p.a[1] - q.a[1]));
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
      const seg = list[i];
      const currentEnd = current.horizontal ? current.b[0] : current.b[1];
      const segStart = seg.horizontal ? seg.a[0] : seg.a[1];
      if (segStart <= currentEnd + EPS) {
        const end = Math.max(currentEnd, seg.horizontal ? seg.b[0] : seg.b[1]);
        current = {
          ...current,
          b: current.horizontal ? [end, current.a[1]] : [current.a[0], end],
          length: end - (current.horizontal ? current.a[0] : current.a[1]),
        };
      } else {
        out.push(current);
        current = seg;
      }
    }
    out.push(current);
  }
  return out;
}
