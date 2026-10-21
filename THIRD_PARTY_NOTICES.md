# 서드파티 고지

Spiti는 아래 오픈소스 라이브러리를 사용합니다. 각 라이브러리의 저작권과 라이선스는 해당 프로젝트에 있습니다.

## 런타임 의존성

| 라이브러리 | 버전 | 라이선스 | 용도 |
|---|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | 0.186 | MIT | 3D 렌더링 |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | 0.15 | MIT | 방 다각형 병합·교차 계산 |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | 0.0.18 | MIT | 벽 개구부 CSG |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | 0.9 | MIT | 메시 충돌 가속 |

## 개발 의존성

| 라이브러리 | 라이선스 |
|---|---|
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| [Vite](https://github.com/vitejs/vite) | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | MIT |
| [@types/three](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT |

전체 의존성 트리와 정확한 버전은 `web/package-lock.json`에서 확인할 수 있습니다.
