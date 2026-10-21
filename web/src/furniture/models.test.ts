import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { buildModel } from './models';

describe('가구 모델', () => {
  // 충돌 판정은 가로×깊이 사각형으로 하므로 모델이 그 밖으로 크게 나가면 안 된다. 손잡이 정도는 봐준다.
  it.each(CATALOG.map((d) => [d.name, d] as const))('%s 모델이 치수 안에 들어간다', (_name, def) => {
    const box = new THREE.Box3().setFromObject(buildModel(def.model, def, def.color));
    const tol = 4;
    expect(box.min.x).toBeGreaterThanOrEqual(-def.w / 2 - tol);
    expect(box.max.x).toBeLessThanOrEqual(def.w / 2 + tol);
    expect(box.min.z).toBeGreaterThanOrEqual(-def.d / 2 - tol);
    expect(box.max.z).toBeLessThanOrEqual(def.d / 2 + tol);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(box.max.y).toBeLessThanOrEqual(Math.max(def.h, 1) + tol);
  });
});
