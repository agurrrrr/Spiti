import type { PlanView } from '../plan/build3d';
import type { PresetSpec } from '../plan/presets';
import type { ResolvedPlan } from '../plan/resolve';
import type { StructureEditor } from '../plan/structureEditor';
import type { Interaction } from '../scene/interaction';
import type { Viewer, ViewMode } from '../scene/viewer';
import type { LayoutStore, PlacedItem } from '../state/layout';
import type { FloorPlan } from '../types';
import { h } from './dom';
import { layoutTransferButtons } from './layoutTransfer';

interface TopbarDeps {
  viewer: Viewer;
  planView: PlanView;
  store: LayoutStore;
  interaction: Interaction;
  rp: ResolvedPlan;
  structure: StructureEditor | null;
  /** 지금 화면의 평면도. 구조 드래그로 바뀐 최신 값을 돌려줘야 내보내기가 맞다. */
  getPlan: () => FloorPlan;
  dialog: HTMLDialogElement;
  onOpenStart: () => void;
  onSwitchPlan: (plan: FloorPlan, items: PlacedItem[], preset?: PresetSpec) => void;
}

const LOW_WALL = 100;

function segmented<T extends string>(options: [T, string][], initial: T, onPick: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'segmented' });
  const buttons = options.map(([value, label]) =>
    h(
      'button',
      {
        class: value === initial ? 'active' : '',
        onclick: () => {
          buttons.forEach((b) => b.classList.remove('active'));
          button(value).classList.add('active');
          onPick(value);
        },
      },
      label,
    ),
  );
  const button = (v: T) => buttons[options.findIndex(([value]) => value === v)];
  wrap.append(...buttons);
  return wrap;
}

function toggle(label: string, initial: boolean, onToggle: (on: boolean) => void): HTMLButtonElement {
  let on = initial;
  const b = h('button', {
    class: `toggle${on ? ' active' : ''}`,
    onclick: () => {
      on = !on;
      b.classList.toggle('active', on);
      onToggle(on);
    },
  });
  b.textContent = label;
  return b;
}

export function mountTopbar(root: HTMLElement, deps: TopbarDeps): void {
  const { viewer, planView, store, rp, dialog } = deps;

  const undo = h('button', { class: 'btn', title: '되돌리기 (Ctrl+Z)', onclick: () => store.undo() }, '↶');
  const redo = h('button', { class: 'btn', title: '다시 실행 (Ctrl+Shift+Z)', onclick: () => store.redo() }, '↷');
  const syncHistory = () => {
    undo.disabled = !store.canUndo;
    redo.disabled = !store.canRedo;
  };
  deps.interaction.onChange(syncHistory);
  syncHistory();

  dialog.replaceChildren(
    h(
      'form',
      { method: 'dialog' },
      h('h2', {}, '구조 해석 메모'),
      h('p', { class: 'muted' }, rp.plan.source ? `${rp.plan.name} (${rp.plan.source})` : rp.plan.name),
      h('ol', {}, ...rp.plan.notes.map((n) => h('li', {}, n))),
      rp.warnings.length ? h('ul', { class: 'warn' }, ...rp.warnings.map((w) => h('li', {}, w))) : null,
      h(
        'p',
        { class: 'muted' },
        '치수나 방 이름이 다르면 알려 주세요. 프리셋 구조는 src/plan/presets.ts의 격자 정의에서 바꿀 수 있습니다.',
      ),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary' }, '닫기')),
    ),
  );

  root.replaceChildren(
    segmented<ViewMode>(
      [
        ['3d', '3D'],
        ['plan', '평면도'],
      ],
      '3d',
      (m) => viewer.setMode(m),
    ),
    segmented<'full' | 'low'>(
      [
        ['full', `벽 ${rp.plan.wallHeight}`],
        ['low', `벽 ${LOW_WALL}`],
      ],
      'full',
      (v) => planView.setWallHeight(v === 'full' ? rp.plan.wallHeight : LOW_WALL),
    ),
    toggle('와이어프레임', false, (on) => planView.setWireframe(on)),
    toggle('방 이름', true, (on) => planView.setLabelsVisible(on)),
    toggle('가구 라벨', true, (on) => deps.interaction.layer.setLabelsVisible(on)),
    h('span', { class: 'sep' }),
    h('button', { class: 'btn', title: '평면도 구조를 다시 고릅니다', onclick: () => deps.onOpenStart() }, '구조'),
    ...(deps.structure
      ? [
          h(
            'button',
            {
              class: 'btn',
              title: '끌어서 바꾼 구조를 이 프리셋의 처음 격자로 되돌립니다',
              onclick: () => deps.structure?.reset(),
            },
            '구조 기본값으로',
          ),
        ]
      : []),
    h('button', { class: 'btn', title: '시점 초기화', onclick: () => viewer.resetView() }, '시점 초기화'),
    undo,
    redo,
    ...layoutTransferButtons({
      store,
      interaction: deps.interaction,
      getPlan: deps.getPlan,
      getPreset: () => deps.structure?.spec ?? null,
      onSwitchPlan: deps.onSwitchPlan,
    }),
    h(
      'button',
      {
        class: 'btn',
        onclick: () => {
          if (store.items.length && confirm('배치한 가구를 모두 지울까요? (되돌리기로 복구할 수 있습니다)')) store.clear();
        },
      },
      '모두 지우기',
    ),
    h('button', { class: 'btn', onclick: () => dialog.showModal() }, '해석 메모'),
  );
}
