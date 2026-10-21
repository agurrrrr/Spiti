/** 평면도 좌표: cm 단위, x는 오른쪽, y는 아래쪽(종이 기준). 3D에서는 x → X, y → Z로 그대로 옮긴다. */
export type Vec2 = [number, number];

export type FloorKind = 'wood' | 'tile' | 'kitchen';

export interface Room {
  id: string;
  name: string;
  floor: FloorKind;
  polygon: Vec2[];
  /** 라벨 위치. 생략하면 다각형 무게중심을 쓴다. */
  labelAt?: Vec2;
}

export interface Wall {
  id: string;
  from: Vec2;
  to: Vec2;
  /** 외벽은 안쪽 면이 선 위에 오도록 바깥으로 밀어낸다. 내벽은 선을 중심으로 세운다. */
  exterior?: boolean;
  thickness?: number;
}

/** sash: 바닥까지 내려오는 유리 미닫이 샷시 (두 짝이 벽 안에서 엇갈려 미끄러진다) */
export type OpeningType = 'door' | 'entrance' | 'opening' | 'window' | 'sash';

export interface Opening {
  id: string;
  type: OpeningType;
  /** 개구부 중심. 가장 가까운 벽에 붙는다. */
  at: Vec2;
  width: number;
  /** 개구부 윗변 높이 (문은 기본 210) */
  height?: number;
  /** 창문 아랫변 높이 (문은 0) */
  sill?: number;
  /** 문짝이 열리는 쪽에 있는 아무 점 */
  opensToward?: Vec2;
  /** 경첩 위치: 벽 from 쪽 끝(start) 또는 to 쪽 끝(end) */
  hinge?: 'start' | 'end';
}

export interface Fixture {
  id: string;
  name: string;
  kind: 'counter';
  /** 바닥 중심 */
  at: Vec2;
  /** [가로, 깊이, 높이] */
  size: [number, number, number];
  /** 도 단위, 위에서 볼 때 반시계 방향 (three.js rotation.y와 같다) */
  rotation?: number;
}

export interface FloorPlan {
  version: 1;
  id: string;
  name: string;
  source?: string;
  unit: 'cm';
  wallHeight: number;
  thickness: { exterior: number; interior: number };
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
  fixtures: Fixture[];
  notes: string[];
}

/** 위에서 본 회전 사각형. angle은 평면도 좌표에서 로컬 u축이 +x에서 +y 쪽으로 돈 각(rad). */
export interface OBB {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  angle: number;
}
