import { CATALOG, CATEGORY_LABELS, type Category } from '../furniture/catalog';
import type { Interaction } from '../scene/interaction';
import type { LayoutStore } from '../state/layout';
import { dims, h, isTouchUI } from './dom';

interface SidebarDeps {
  store: LayoutStore;
  interaction: Interaction;
  thumbs: Map<string, string>;
}

export function mountSidebar(root: HTMLElement, { store, interaction, thumbs }: SidebarDeps): void {
  let category: Category | 'all' = 'all';
  let query = '';

  const search = h('input', {
    class: 'search',
    type: 'search',
    placeholder: '가구 이름 검색',
    oninput: () => {
      query = search.value.trim();
      renderCards();
    },
  });

  const chips = h('div', { class: 'chips' });
  const renderChips = () => {
    chips.replaceChildren(
      ...(['all', ...Object.keys(CATEGORY_LABELS)] as (Category | 'all')[]).map((c) =>
        h(
          'button',
          {
            class: `chip${c === category ? ' active' : ''}`,
            onclick: () => {
              category = c;
              renderChips();
              renderCards();
            },
          },
          c === 'all' ? '전체' : CATEGORY_LABELS[c],
        ),
      ),
    );
  };

  const grid = h('div', { class: 'cards' });
  const renderCards = () => {
    const defs = CATALOG.filter(
      (d) => (category === 'all' || d.category === category) && (!query || d.name.includes(query)),
    );
    grid.replaceChildren(
      ...defs.map((def) => {
        const thumb = thumbs.get(def.id);
        const card = h(
          'div',
          { class: 'card', title: `${def.name}: 끌어다 놓거나, 누르면 화면 가운데에 놓입니다` },
          h(
            'div',
            { class: 'thumb', style: thumb ? '' : `background:${def.color}` },
            thumb ? h('img', { src: thumb, alt: '', draggable: 'false' }) : null,
          ),
          h('div', { class: 'meta' }, h('b', {}, def.name), h('span', {}, `${dims(def.w, def.d, def.h)} cm`)),
        );
        card.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          interaction.startCardDrag(def, e, thumb);
        });
        return card;
      }),
    );
    if (defs.length === 0) grid.append(h('p', { class: 'empty' }, '찾는 가구가 없습니다.'));
  };

  const placedTitle = h('h3', {});
  const placedList = h('ul', { class: 'placed' });
  const renderPlaced = () => {
    const n = store.items.length;
    const hits = interaction.collisions.size;
    placedTitle.replaceChildren(
      `배치한 가구 ${n}개`,
      hits ? h('span', { class: 'badge warn' }, `겹침 ${hits}`) : '',
    );
    placedList.replaceChildren(
      ...store.items.map((item) =>
        h(
          'li',
          {
            class: `${item.uid === store.selected ? 'selected' : ''}${interaction.collisions.has(item.uid) ? ' warn' : ''}`,
            onclick: () => store.select(item.uid),
          },
          h('i', { class: 'dot', style: `background:${item.color}` }),
          h('span', { class: 'name' }, item.name),
          h('span', { class: 'size' }, dims(item.w, item.d, item.h)),
          h(
            'button',
            {
              class: 'icon',
              title: '삭제',
              onclick: (e: Event) => {
                e.stopPropagation();
                store.remove(item.uid);
              },
            },
            '×',
          ),
        ),
      ),
    );
    if (n === 0) placedList.append(h('li', { class: 'empty' }, '아직 배치한 가구가 없습니다.'));
  };

  root.replaceChildren(
    h(
      'div',
      { class: 'sidebar-head' },
      h('h2', {}, '가구'),
      h(
        'p',
        { class: 'hint' },
        isTouchUI()
          ? '카드를 3D 화면으로 끌어다 놓거나, 누르면 화면 가운데에 놓입니다.'
          : '카드를 왼쪽 3D 화면으로 끌어다 놓으세요. 끄는 중에 R을 누르면 돌아갑니다.',
      ),
      search,
      chips,
    ),
    grid,
    h('section', { class: 'placed-section' }, placedTitle, placedList),
  );
  renderChips();
  renderCards();
  renderPlaced();
  interaction.onChange(renderPlaced);
}
