import type { PresetKind } from '../plan/presets';
import { h } from './dom';
import { createPresetPicker } from './presets';

export interface StartScreenDeps {
  onPickPreset: (kind: PresetKind) => void;
  onOpenFile: (file: File) => void;
}

/** 앱을 열었을 때 보여 주는 시작 화면. 프로젝트 파일과 프리셋 자리를 둔다. */
export function createStartScreen(dialog: HTMLDialogElement, deps: StartScreenDeps): { open: () => void } {
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) deps.onOpenFile(file);
  });

  const openCard = h(
    'button',
    { class: 'start-card start-card-add', type: 'button', onclick: () => fileInput.click() },
    h('span', { class: 'start-card-title' }, '프로젝트 파일 열기'),
    h('span', { class: 'start-card-meta' }, '내보낸 spiti-project-*.json 파일에서 평면도와 배치를 함께 엽니다'),
  );

  dialog.classList.add('start-dialog');
  dialog.replaceChildren(
    h(
      'div',
      { class: 'start-panel' },
      h(
        'header',
        { class: 'start-head' },
        h('h2', {}, 'Spiti'),
        h('p', {}, '도면을 고르고, 가구를 놓아 보세요.'),
      ),
      h('h3', {}, '프로젝트 파일'),
      h('div', { class: 'start-grid' }, openCard),
      h('h3', {}, '프리셋'),
      createPresetPicker({ onPick: deps.onPickPreset }),
      h(
        'footer',
        { class: 'start-foot' },
        h('span', { class: 'muted' }, '고른 구조는 이 브라우저에 마지막 구조로 기억됩니다.'),
      ),
      fileInput,
    ),
  );

  return {
    open: () => {
      if (!dialog.open) dialog.showModal();
    },
  };
}
