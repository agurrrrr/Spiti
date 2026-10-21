import type { Vec2 } from '../types';
import { wallSolidRects, type ResolvedPlan } from './resolve';

/**
 * 방 사이 동선 검사. 프리셋 테스트에서 문·통로·트인 경계·내부 샷시를 한 번에 확인하려고 쓴다.
 * 프리셋 방은 축에 나란한 다각형이라 변이 겹치는지만 보면 된다.
 */

export interface SharedEdge {
  a: string;
  b: string;
  horizontal: boolean;
  /** 가로 변이면 y, 세로 변이면 x */
  line: number;
  start: number;
  end: number;
}

const near = (p: number, q: number) => Math.abs(p - q) < 0.01;

/** 두 방 폴리곤이 맞닿은 변을 모두 찾는다. */
export function sharedEdges(rp: ResolvedPlan): SharedEdge[] {
  const rooms = rp.plan.rooms;
  const edgesOf = (poly: Vec2[]) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as const);
  const out: SharedEdge[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      for (const [p1, p2] of edgesOf(rooms[i].polygon)) {
        for (const [q1, q2] of edgesOf(rooms[j].polygon)) {
          const horizontal = near(p1[1], p2[1]) && near(q1[1], q2[1]) && near(p1[1], q1[1]);
          const vertical = near(p1[0], p2[0]) && near(q1[0], q2[0]) && near(p1[0], q1[0]);
          if (!horizontal && !vertical) continue;
          const axis = horizontal ? 0 : 1;
          const start = Math.max(Math.min(p1[axis], p2[axis]), Math.min(q1[axis], q2[axis]));
          const end = Math.min(Math.max(p1[axis], p2[axis]), Math.max(q1[axis], q2[axis]));
          if (end - start < 1) continue;
          out.push({ a: rooms[i].id, b: rooms[j].id, horizontal, line: horizontal ? p1[1] : p1[0], start, end });
        }
      }
    }
  }
  return out;
}

/** 맞닿은 변 위에 벽이 막지 않은 점이 하나라도 있으면 두 방은 이어져 있다. */
export function roomGraph(rp: ResolvedPlan): Map<string, Set<string>> {
  const solids = rp.walls.flatMap(wallSolidRects);
  const blocked = ([x, y]: Vec2) =>
    solids.some((r) => {
      const dx = x - r.cx;
      const dy = y - r.cy;
      const c = Math.cos(r.angle);
      const s = Math.sin(r.angle);
      return Math.abs(dx * c + dy * s) <= r.hw + 0.01 && Math.abs(-dx * s + dy * c) <= r.hh + 0.01;
    });

  const graph = new Map<string, Set<string>>(rp.plan.rooms.map((room) => [room.id, new Set<string>()]));
  for (const edge of sharedEdges(rp)) {
    for (let t = edge.start + 5; t <= edge.end - 5; t += 5) {
      if (blocked(edge.horizontal ? [t, edge.line] : [edge.line, t])) continue;
      graph.get(edge.a)!.add(edge.b);
      graph.get(edge.b)!.add(edge.a);
      break;
    }
  }
  return graph;
}

/** from 방에서 벽에 막히지 않고 갈 수 없는 방 id 목록 */
export function unreachableRooms(rp: ResolvedPlan, from = 'living'): string[] {
  const graph = roomGraph(rp);
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    for (const next of graph.get(queue.shift()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return rp.plan.rooms.map((room) => room.id).filter((id) => !seen.has(id));
}
