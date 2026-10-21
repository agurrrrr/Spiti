import type { Interaction } from '../scene/interaction';
import { DIM_LIMITS, NAME_MAX, NOTE_MAX, type LayoutStore, type PlacedItem } from '../state/layout';
import { h } from './dom';

/** 선택한 가구의 이름·라벨 메모·치수·회전·색을 고치는 떠 있는 패널 */
export function mountInspector(root: HTMLElement, store: LayoutStore, interaction: Interaction): void {
  const field = (label: string, key: 'w' | 'd' | 'h') => {
    const [min, max] = DIM_LIMITS[key];
    const input = h('input', { type: 'number', min, max, step: 1, class: 'num' });
    input.addEventListener('change', () => {
      const item = store.get(store.selected);
      const v = Math.round(Number(input.value));
      if (!item || !Number.isFinite(v)) return;
      store.update(item.uid, { [key]: Math.min(max, Math.max(min, v)) } as Partial<PlacedItem>);
    });
    return { input, el: h('label', { class: 'field' }, h('span', {}, label), input) };
  };

  const name = h('input', { class: 'name-input', maxlength: NAME_MAX, title: '이름 (가구 라벨에 표시됩니다)' });
  name.addEventListener('change', () => {
    const item = store.get(store.selected);
    if (item && name.value.trim()) store.update(item.uid, { name: name.value.trim() });
  });
  const note = h('input', {
    class: 'note-input',
    maxlength: NOTE_MAX,
    placeholder: '예: 분해 후 이동, 새로 구매',
    title: '가구 라벨에 이름 아래 한 줄로 표시됩니다',
  });
  note.addEventListener('change', () => {
    const item = store.get(store.selected);
    const v = note.value.trim();
    if (item && v !== (item.note ?? '')) store.update(item.uid, { note: v || undefined });
  });
  const w = field('가로', 'w');
  const d = field('깊이', 'd');
  const hh = field('높이', 'h');
  const rot = h('input', { type: 'number', step: 1, class: 'num' });
  rot.addEventListener('change', () => {
    const item = store.get(store.selected);
    const v = Number(rot.value);
    if (item && Number.isFinite(v)) store.update(item.uid, { rot: v });
  });
  const color = h('input', { type: 'color', class: 'color' });
  color.addEventListener('change', () => {
    const item = store.get(store.selected);
    if (item) store.update(item.uid, { color: color.value });
  });
  const warn = h('div', { class: 'inspector-warn' }, '벽이나 다른 가구와 겹칩니다');

  root.replaceChildren(
    h(
      'div',
      { class: 'row' },
      name,
      w.el,
      d.el,
      hh.el,
      h('span', { class: 'unit' }, 'cm'),
      h('span', { class: 'sep' }),
      h('label', { class: 'field' }, h('span', {}, '회전'), rot),
      h('button', { class: 'btn', title: '반시계 90° (Shift+R)', onclick: () => interaction.rotateSelected(90) }, '⟲ 90°'),
      h('button', { class: 'btn', title: '시계 90° (R)', onclick: () => interaction.rotateSelected(-90) }, '⟳ 90°'),
      h('span', { class: 'sep' }),
      color,
      h('button', { class: 'btn', title: '복제 (Ctrl+D)', onclick: () => store.selected && store.duplicate(store.selected) }, '복제'),
      h(
        'button',
        { class: 'btn danger', title: '삭제 (Delete)', onclick: () => store.selected && store.remove(store.selected) },
        '삭제',
      ),
    ),
    h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, '라벨 메모'), note)),
    warn,
  );

  const set = (input: HTMLInputElement, value: string) => {
    if (document.activeElement !== input) input.value = value;
  };
  const render = () => {
    const item = store.get(store.selected);
    root.hidden = !item;
    if (!item) return;
    set(name, item.name);
    set(note, item.note ?? '');
    set(w.input, String(item.w));
    set(d.input, String(item.d));
    set(hh.input, String(item.h));
    set(rot, String(Math.round(item.rot)));
    set(color, item.color);
    warn.hidden = !interaction.collisions.has(item.uid);
  };
  interaction.onChange(render);
  render();
}
