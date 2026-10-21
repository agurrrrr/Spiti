import './styles.css';
import { CATALOG } from './furniture/catalog';
import { renderThumbnails } from './furniture/thumbnails';
import { PlanView } from './plan/build3d';
import { parseFloorPlan } from './plan/planFile';
import {
  buildPresetPlan,
  parsePresetSpec,
  PRESETS,
  type PresetKind,
  type PresetSpec,
} from './plan/presets';
import { resolvePlan, type ResolvedPlan } from './plan/resolve';
import { StructureEditor } from './plan/structureEditor';
import { Interaction } from './scene/interaction';
import { Viewer } from './scene/viewer';
import { LayoutStore, type PlacedItem } from './state/layout';
import type { FloorPlan } from './types';
import { isTouchUI } from './ui/dom';
import { mountInspector } from './ui/inspector';
import { openProjectText } from './ui/projectOpen';
import { mountSidebar } from './ui/sidebar';
import { createStartScreen } from './ui/startScreen';
import { mountTopbar } from './ui/topbar';

const LAST_PLAN_KEY = 'spiti:plan:v1';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Session {
  plan: FloorPlan;
  rp: ResolvedPlan;
  store: LayoutStore;
  planView: PlanView;
  interaction: Interaction;
  /** 프리셋 구조일 때만 있다. 경계 손잡이와 현재 격자 파라미터를 담는다. */
  structure: StructureEditor | null;
  preset?: PresetSpec;
}

const viewer = new Viewer($('viewport'));
const thumbs = renderThumbnails(CATALOG);
const startDialog = $<HTMLDialogElement>('start-dialog');
let session: Session | null = null;

const startScreen = createStartScreen(startDialog, {
  onPickPreset: (kind) => pickPreset(kind),
  onOpenFile: async (file) => {
    if (openProjectText(await file.text(), projectOpenContext())) startDialog.close();
  },
});

function projectOpenContext() {
  return {
    currentPlan: session?.plan ?? null,
    currentItems: session?.store.items ?? [],
    applyItems: (items: PlacedItem[]) => session?.store.replaceAll(items),
    switchPlan: (plan: FloorPlan, items: PlacedItem[], preset?: PresetSpec) =>
      switchPlan(plan, items, preset),
  };
}

/** 지금 화면의 3D·상호작용·배치 상태를 모두 정리한다 */
function disposeSession(): void {
  if (!session) return;
  session.structure?.dispose();
  session.interaction.dispose();
  session.planView.dispose();
  session = null;
}

/** 앱을 처음 열 때 평면도 위에 배치를 올린다 */
function startPlan(plan: FloorPlan, items?: PlacedItem[]): void {
  switchPlan(plan, items);
}

/** 프리셋 구조를 골랐을 때. 현재 배치가 있으면 한 번 확인한다. */
function pickPreset(kind: PresetKind): void {
  if (
    session?.store.items.length &&
    !confirm(
      '이 구조로 바꾸면 가구가 새 방 경계와 맞지 않을 수 있습니다. 현재 배치는 이전 구조에 저장됩니다.',
    )
  ) {
    return;
  }
  const spec = PRESETS[kind].spec;
  startDialog.close();
  switchPlan(buildPresetPlan(spec), undefined, spec);
}

/** 평면도를 바꾸고 상단 막대·사이드바·선택 패널을 새 상태로 다시 붙인다 */
function switchPlan(plan: FloorPlan, items?: PlacedItem[], preset?: PresetSpec): void {
  disposeSession();
  const rp = resolvePlan(plan);
  rp.warnings.forEach((w) => console.warn(w));
  $('plan-name').textContent = plan.name;

  viewer.setupForPlan(rp.bounds);
  const planView = new PlanView(rp);
  viewer.scene.add(planView.group);

  // 배치는 평면도 id별로 localStorage에 남는다. 다른 구조로 바꿔도 이전 배치는 지워지지 않는다.
  const store = new LayoutStore(`spiti:layout:v1:${plan.id}`);
  if (items) store.replaceAll(items);

  // Interaction보다 먼저 등록해 평면도 손잡이 클릭을 가구 조작과 분리한다
  const structure = preset
    ? new StructureEditor(viewer, preset, {
        onApply: (spec, save) => applyPresetStructure(spec, save),
      })
    : null;
  const interaction = new Interaction(viewer, store, rp);

  session = { plan, rp, store, planView, interaction, structure, ...(preset ? { preset } : {}) };
  saveLastPlan(plan, preset);
  mountSessionUI();
  exposeWindow();
}

/**
 * 프리셋 격자를 바꿔 평면도를 다시 만든다. 카메라와 배치 상태는 유지하고,
 * 새 외곽을 벗어난 가구 중심은 안쪽 5cm로 당긴다.
 */
function applyPresetStructure(spec: PresetSpec, save: boolean): void {
  const s = session;
  if (!s || !s.structure) return;

  let plan: FloorPlan;
  let rp: ResolvedPlan;
  try {
    plan = buildPresetPlan(spec);
    rp = resolvePlan(plan);
  } catch (e) {
    console.warn('구조를 적용하지 못했습니다.', e);
    return;
  }
  rp.warnings.forEach((w) => console.warn(w));

  s.plan = plan;
  s.rp = rp;
  s.preset = spec;
  s.planView.reset(rp);
  s.interaction.setPlan(rp);
  clampItemsToPlan(s.store, spec.width, spec.depth);
  s.structure.setSpec(spec);
  $('plan-name').textContent = plan.name;
  if (save) saveLastPlan(plan, spec);
  exposeWindow();
}

/** 구조가 작아져 가구 중심이 외곽 밖으로 나가면 안쪽 5cm로 옮긴다. */
function clampItemsToPlan(store: LayoutStore, width: number, depth: number): void {
  store.adjustWithoutHistory((items) => {
    let changed = false;
    for (const item of items) {
      const x = Math.min(width - 5, Math.max(5, item.x));
      const z = Math.min(depth - 5, Math.max(5, item.z));
      if (x !== item.x || z !== item.z) {
        item.x = x;
        item.z = z;
        changed = true;
      }
    }
    return changed;
  });
}

function exposeWindow(): void {
  if (!session) return;
  Object.assign(window, {
    spiti: {
      viewer,
      store: session.store,
      interaction: session.interaction,
      rp: session.rp,
      planView: session.planView,
      structure: session.structure,
      startPlan,
      switchPlan,
    },
  });
}

function mountSessionUI(): void {
  if (!session) return;
  const { rp, store, planView, interaction } = session;

  mountTopbar($('view-controls'), {
    viewer,
    planView,
    store,
    interaction,
    rp,
    structure: session.structure,
    getPlan: () => session?.plan ?? rp.plan,
    dialog: $('notes-dialog'),
    onOpenStart: () => startScreen.open(),
    onSwitchPlan: (plan, items, preset) => switchPlan(plan, items, preset),
  });
  mountSidebar($('sidebar'), { store, interaction, thumbs });
  mountInspector($('inspector'), store, interaction);

  const status = $('statusbar');
  const renderStatus = () => {
    const hits = interaction.collisions.size;
    const touch = isTouchUI();
    status.classList.toggle('warn', hits > 0);
    status.textContent = hits
      ? `겹치는 가구가 ${hits}개 있습니다. 빨간색 가구를 옮겨 주세요.`
      : store.selected
        ? touch
          ? '끌기: 이동 · 파란 링: 회전 · 빈 곳 누르기: 선택 해제'
          : '드래그: 이동 · 링: 회전 · R / Shift+R: 90° · Q/E: 15° · 방향키: 1cm(Shift 10cm) · Shift 드래그: 벽 붙임 해제 · Del: 삭제'
        : touch
          ? '한 손가락: 회전 · 두 손가락: 확대·이동 · 가구 카드를 끌어다 놓아 배치하세요'
          : '왼쪽 드래그: 회전 · 오른쪽 드래그: 이동 · 휠: 확대 · 오른쪽 카드를 끌어다 놓아 가구를 배치하세요';
  };
  interaction.onChange(renderStatus);
  renderStatus();
}

/** 마지막으로 연 구조를 { plan, preset? } 형태로 기억한다 */
function saveLastPlan(plan: FloorPlan, preset?: PresetSpec): void {
  try {
    localStorage.setItem(LAST_PLAN_KEY, JSON.stringify(preset === undefined ? { plan } : { plan, preset }));
  } catch {
    // 저장 공간이 없으면 이번 세션에서만 연다
  }
}

function loadLastPlan(): { plan: FloorPlan; preset?: PresetSpec } | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LAST_PLAN_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    const value = record && 'plan' in record ? record.plan : data;
    const preset = record && 'preset' in record ? parsePresetSpec(record.preset) : null;
    if (preset) {
      try {
        // 격자 파라미터로 다시 만들어야 나중에 경계를 움직여도 같은 규칙이 적용된다
        return { plan: buildPresetPlan(preset), preset };
      } catch {
        // 저장된 프리셋이 깨졌으면 함께 저장한 평면도로 되돌아간다
      }
    }
    return { plan: parseFloorPlan(value) };
  } catch {
    return null;
  }
}

const lastPlan = loadLastPlan();
if (lastPlan) switchPlan(lastPlan.plan, undefined, lastPlan.preset);
else startScreen.open();
