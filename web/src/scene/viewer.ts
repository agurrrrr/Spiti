import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export type ViewMode = '3d' | 'plan';

interface PlanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 렌더러, 카메라 두 대(원근/평면), 조명, 라벨 레이어를 묶는다. 월드 좌표는 평면도 cm 좌표 그대로다. */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer = new CSS2DRenderer();
  readonly scene = new THREE.Scene();
  readonly perspective = new THREE.PerspectiveCamera(45, 1, 5, 20000);
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  readonly controls3d: OrbitControls;
  readonly controlsPlan: OrbitControls;
  mode: ViewMode = '3d';
  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly frameCallbacks = new Set<() => void>();
  private center = new THREE.Vector3();
  private extent = 1000;
  private planHalf = { w: 500, h: 300 };
  private planWorld: THREE.Object3D[] = [];

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    const labels = this.labelRenderer.domElement;
    labels.className = 'label-layer';
    container.appendChild(labels);

    this.scene.background = new THREE.Color('#e9ecef');

    this.controls3d = new OrbitControls(this.perspective, this.renderer.domElement);
    this.controls3d.enableDamping = true;
    this.controls3d.dampingFactor = 0.12;
    this.controls3d.maxPolarAngle = THREE.MathUtils.degToRad(85);
    this.controls3d.minDistance = 120;
    this.controls3d.maxDistance = 4000;

    this.controlsPlan = new OrbitControls(this.ortho, this.renderer.domElement);
    this.controlsPlan.enableRotate = false;
    this.controlsPlan.screenSpacePanning = true;
    this.controlsPlan.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controlsPlan.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controlsPlan.minZoom = 0.3;
    this.controlsPlan.maxZoom = 8;
    this.controlsPlan.enabled = false;

    const resize = new ResizeObserver(() => this.resize());
    resize.observe(container);
    this.resize();

    const loop = () => {
      this.activeControls.update();
      this.frameCallbacks.forEach((fn) => fn());
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.mode === '3d' ? this.perspective : this.ortho;
  }

  get activeControls(): OrbitControls {
    return this.mode === '3d' ? this.controls3d : this.controlsPlan;
  }

  /** 매 프레임 콜백. 돌려받은 함수를 부르면 등록을 해제한다. */
  onFrame(fn: () => void): () => void {
    this.frameCallbacks.add(fn);
    return () => this.frameCallbacks.delete(fn);
  }

  /** 조명, 그림자 범위, 바닥, 카메라를 평면도 크기에 맞춘다 */
  setupForPlan(b: PlanBounds): void {
    this.clearPlanWorld();
    this.center.set((b.minX + b.maxX) / 2, 0, (b.minY + b.maxY) / 2);
    this.planHalf = { w: (b.maxX - b.minX) / 2 + 40, h: (b.maxY - b.minY) / 2 + 40 };
    this.extent = Math.max(b.maxX - b.minX, b.maxY - b.minY);

    const hemi = new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.15);
    const sun = new THREE.DirectionalLight('#fff7ea', 2.2);
    sun.position.copy(this.center).add(new THREE.Vector3(-this.extent * 0.35, this.extent * 1.1, -this.extent * 0.55));
    sun.target.position.copy(this.center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = this.extent * 0.75;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: this.extent * 3 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 1.2;
    this.scene.add(hemi, sun, sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.extent * 6, this.extent * 6),
      new THREE.MeshStandardMaterial({ color: '#dfe3e7', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.copy(this.center).setY(-0.6);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(this.extent * 3, Math.round((this.extent * 3) / 50), '#c3c9cf', '#d3d8dd');
    grid.position.copy(this.center).setY(-0.4);
    this.scene.add(grid);
    this.planWorld = [hemi, sun, sun.target, ground, grid];

    this.resetView();
  }

  /** 이전 평면도의 조명·바닥·그리드를 씬에서 걷어내고 자원을 해제한다 */
  private clearPlanWorld(): void {
    for (const root of this.planWorld) {
      this.scene.remove(root);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (material) (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
        const light = o as THREE.Light;
        if (light.isLight) {
          (o as THREE.DirectionalLight).shadow?.map?.dispose();
          light.dispose();
        }
      });
    }
    this.planWorld = [];
  }

  resetView(): void {
    const c = this.center;
    this.perspective.position.set(c.x + this.extent * 0.1, this.extent * 1.15, c.z + this.extent * 0.62);
    this.controls3d.target.copy(c);
    this.controls3d.update();

    this.ortho.position.set(c.x, 3000, c.z);
    this.ortho.up.set(0, 0, -1);
    this.ortho.zoom = 1;
    this.controlsPlan.target.copy(c);
    this.ortho.lookAt(c);
    this.updateOrtho();
    this.controlsPlan.update();
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.controls3d.enabled = mode === '3d';
    this.controlsPlan.enabled = mode === 'plan';
    this.resize();
  }

  /** 화면 좌표에서 바닥(y=0) 위의 점 */
  floorPoint(clientX: number, clientY: number, y = 0): THREE.Vector3 | null {
    this.setRay(clientX, clientY);
    this.floorPlane.constant = -y;
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.floorPlane, out) ? out : null;
  }

  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    this.setRay(clientX, clientY);
    return this.raycaster.intersectObjects(objects, true);
  }

  isInside(clientX: number, clientY: number): boolean {
    const r = this.renderer.domElement.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  /** 화면 중앙 아래 바닥 점 */
  centerFloorPoint(): THREE.Vector3 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return this.floorPoint(r.left + r.width / 2, r.top + r.height / 2) ?? this.center.clone();
  }

  private setRay(clientX: number, clientY: number): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    this.updateOrtho();
  }

  private updateOrtho(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const aspect = w / h;
    const halfH = Math.max(this.planHalf.h, this.planHalf.w / aspect) * 1.08;
    this.ortho.left = -halfH * aspect;
    this.ortho.right = halfH * aspect;
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.updateProjectionMatrix();
  }
}
