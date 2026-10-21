import type { OBB } from '../types';
import { isRightAngle, obbAabb, obbOverlap, rotationToPlanAngle } from './geometry';

export interface Footprint {
  uid: string;
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  /** 러그처럼 바닥에 까는 물건은 충돌 계산에서 뺀다 */
  flat?: boolean;
  /** 모델 종류. 의자는 식탁·책상 밑으로 들어갈 수 있다 */
  model?: string;
}

const TUCK_UNDER = new Set(['table', 'roundTable', 'island', 'desk']);

/** 원래 겹쳐 놓는 조합인지 (식탁 밑 의자) */
export function canOverlap(a: Pick<Footprint, 'model'>, b: Pick<Footprint, 'model'>): boolean {
  return (a.model === 'chair' && TUCK_UNDER.has(b.model ?? '')) || (b.model === 'chair' && TUCK_UNDER.has(a.model ?? ''));
}

export function footprintRect(f: Pick<Footprint, 'x' | 'z' | 'rot' | 'w' | 'd'>): OBB {
  return { cx: f.x, cy: f.z, hw: f.w / 2, hh: f.d / 2, angle: rotationToPlanAngle(f.rot) };
}

/** 벽·붙박이·다른 가구와 겹치는 가구의 uid 목록 */
export function findCollisions(items: Footprint[], obstacles: OBB[]): Set<string> {
  const hits = new Set<string>();
  const solid = items.filter((i) => !i.flat);
  const rects = solid.map(footprintRect);
  for (let i = 0; i < solid.length; i++) {
    if (obstacles.some((o) => obbOverlap(rects[i], o))) hits.add(solid[i].uid);
    for (let j = i + 1; j < solid.length; j++) {
      if (!canOverlap(solid[i], solid[j]) && obbOverlap(rects[i], rects[j])) {
        hits.add(solid[i].uid);
        hits.add(solid[j].uid);
      }
    }
  }
  return hits;
}

/**
 * 가구 가장자리가 벽면에 threshold 이내로 다가오면 딱 붙도록 이동량을 돌려준다.
 * 가구와 장애물 모두 90도 배수로 놓여 있을 때만 동작한다.
 */
export function magnetOffset(f: Footprint, obstacles: OBB[], threshold = 10): { dx: number; dz: number } {
  if (!isRightAngle(f.rot)) return { dx: 0, dz: 0 };
  const box = obbAabb(footprintRect(f));
  let bestX = threshold + 1;
  let bestZ = threshold + 1;
  let dx = 0;
  let dz = 0;
  for (const o of obstacles) {
    if (!isRightAngle((-o.angle * 180) / Math.PI)) continue;
    const ob = obbAabb(o);
    const overlapZ = Math.min(box.maxY, ob.maxY) - Math.max(box.minY, ob.minY);
    const overlapX = Math.min(box.maxX, ob.maxX) - Math.max(box.minX, ob.minX);
    if (overlapZ > 1) {
      for (const cand of [ob.maxX - box.minX, ob.minX - box.maxX]) {
        if (Math.abs(cand) < Math.abs(bestX) && Math.abs(cand) <= threshold) {
          bestX = cand;
          dx = cand;
        }
      }
    }
    if (overlapX > 1) {
      for (const cand of [ob.maxY - box.minY, ob.minY - box.maxY]) {
        if (Math.abs(cand) < Math.abs(bestZ) && Math.abs(cand) <= threshold) {
          bestZ = cand;
          dz = cand;
        }
      }
    }
  }
  return { dx, dz };
}
