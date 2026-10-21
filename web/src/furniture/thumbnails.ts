import * as THREE from 'three';
import type { FurnitureDef } from './catalog';
import { buildModel, disposeModel } from './models';

/** 카드에 쓸 썸네일을 작은 WebGL 렌더러 하나로 한 번에 그린다. */
export function renderThumbnails(defs: FurnitureDef[], width = 200, height = 140): Map<string, string> {
  const out = new Map<string, string>();
  const canvas = document.createElement('canvas');
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#9a9184', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.8);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(28, width / height, 1, 5000);
  const dir = new THREE.Vector3(0.9, 0.75, 1.25).normalize();

  for (const def of defs) {
    const model = buildModel(def.model, def, def.color);
    if (def.flat) model.scale.y = 20;
    scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.82;
    camera.position.copy(sphere.center).addScaledVector(dir, distance);
    camera.lookAt(sphere.center);
    renderer.render(scene, camera);
    out.set(def.id, canvas.toDataURL('image/png'));
    scene.remove(model);
    disposeModel(model);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
