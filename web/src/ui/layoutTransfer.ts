import type { Interaction } from '../scene/interaction';
import type { LayoutStore, PlacedItem } from '../state/layout';
import type { PresetSpec } from '../plan/presets';
import { layoutFileName, serializeLayout } from '../state/layoutFile';
import type { FloorPlan } from '../types';
import { h } from './dom';
import { openProjectText } from './projectOpen';

export interface LayoutTransferDeps {
  store: LayoutStore;
  interaction: Interaction;
  /** 지금 화면의 평면도. 구조를 드래그로 바꾼 뒤에도 최신 값을 읽도록 함수로 받는다. */
  getPlan: () => FloorPlan;
  /** 프리셋 구조면 격자 파라미터. 일반 평면도면 null */
  getPreset: () => PresetSpec | null;
  /** v2 파일의 구조가 지금 평면도와 다를 때 앱 셸이 평면도까지 바꾼다 */
  onSwitchPlan: (plan: FloorPlan, items: PlacedItem[], preset?: PresetSpec) => void;
}

/** 평면도와 배치를 JSON 프로젝트 파일로 내려받고, 그 파일로 되살리는 버튼 */
export function layoutTransferButtons({
  store,
  interaction,
  getPlan,
  getPreset,
  onSwitchPlan,
}: LayoutTransferDeps): HTMLElement[] {
  const exportBtn = h(
    'button',
    {
      class: 'btn',
      title: '평면도와 배치를 JSON 프로젝트 파일로 내려받습니다',
      onclick: () => exportLayout(store, getPlan(), getPreset()),
    },
    '내보내기',
  );
  const syncExport = () => {
    exportBtn.disabled = store.items.length === 0;
  };
  interaction.onChange(syncExport);
  syncExport();

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    // 같은 파일을 다시 골라도 change가 일어나도록 비운다
    fileInput.value = '';
    if (!file) return;
    openProjectText(await file.text(), {
      currentPlan: getPlan(),
      currentItems: store.items,
      applyItems: (items) => store.replaceAll(items),
      switchPlan: onSwitchPlan,
    });
  });
  const importBtn = h(
    'button',
    { class: 'btn', title: '내보낸 JSON 파일로 평면도와 배치를 바꿉니다', onclick: () => fileInput.click() },
    '가져오기',
  );

  return [exportBtn, importBtn, fileInput];
}

function exportLayout(store: LayoutStore, plan: FloorPlan, preset: PresetSpec | null): void {
  const now = new Date();
  const blob = new Blob([serializeLayout(plan, store.items, now, preset ?? undefined)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: layoutFileName(plan.id, now) });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
