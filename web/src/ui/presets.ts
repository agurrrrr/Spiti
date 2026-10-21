import {
  buildPresetPlan,
  PRESET_BANDS,
  PRESET_KINDS,
  PRESETS,
  type PresetKind,
  type PresetSpec,
} from '../plan/presets';
import { h } from './dom';

export interface PresetPickerDeps {
  onPick: (kind: PresetKind) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function roomFill(room: string): string {
  if (room.startsWith('bath')) return '#cdeee3';
  if (room.startsWith('bed')) return '#fbe3bf';
  if (room === 'kitchen' || room === 'dining') return '#fde68a';
  if (room === 'hall') return '#e5e7eb';
  if (room === 'foyer') return '#e7e5e4';
  if (room === 'utility' || room === 'balcony') return '#d9e2ec';
  if (room === 'dress') return '#f5d0e3';
  if (room === 'study') return '#ddd6fe';
  return '#dbeafe';
}

/** 방 배치와 벽을 보여 주는 작은 미리보기 */
export function presetPreview(spec: PresetSpec): SVGSVGElement {
  const plan = buildPresetPlan(spec);
  const entry = PRESETS[spec.kind];
  const svg = svgEl('svg', {
    viewBox: `0 0 ${spec.width} ${spec.depth}`,
    preserveAspectRatio: 'none',
    class: 'preset-preview',
    role: 'img',
    'aria-label': `${entry?.label ?? spec.kind} 배치 미리보기`,
  });
  for (const room of plan.rooms) {
    svg.append(
      svgEl('polygon', {
        points: room.polygon.map(([x, y]) => `${x},${y}`).join(' '),
        fill: roomFill(room.id),
      }),
    );
  }
  // 방 경계가 아니라 실제 벽만 그려서 거실·주방처럼 트인 공간이 한 덩어리로 보이게 한다
  for (const wall of plan.walls) {
    svg.append(
      svgEl('line', {
        x1: wall.from[0],
        y1: wall.from[1],
        x2: wall.to[0],
        y2: wall.to[1],
        stroke: '#64748b',
        'stroke-width': wall.exterior ? 2 : 1,
        'stroke-linecap': 'square',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  }
  return svg;
}

export function presetArea(spec: PresetSpec): string {
  return `${((spec.width * spec.depth) / 10000).toFixed(1)}㎡`;
}

function roomSummary(spec: PresetSpec): string {
  const bedrooms = new Set(
    spec.cells.map((cell) => cell.room).filter((room) => room.startsWith('bed')),
  ).size;
  return bedrooms === 0 ? '원룸' : `침실 ${bedrooms}개`;
}

function presetMeta(spec: PresetSpec): string {
  const entry = PRESETS[spec.kind];
  const pyeong = entry ? `${entry.pyeong}평형` : `${((spec.width * spec.depth) / 10000 / 3.3058).toFixed(1)}평`;
  return `${entry?.collectionLabel ?? '주거'} · ${pyeong} · ${presetArea(spec)} · ${roomSummary(spec)} · 욕실 ${spec.baths}개`;
}

/** 시작 화면의 프리셋 카드. 10·20·30·40평대별로 10장씩 묶어 보여 준다. */
export function createPresetPicker(deps: PresetPickerDeps): HTMLElement {
  const root = h('div', { class: 'preset-bands' });
  for (const band of PRESET_BANDS) {
    const kinds = PRESET_KINDS.filter((kind) => PRESETS[kind].band === band);
    if (!kinds.length) continue;
    const grid = h('div', { class: 'start-presets' });
    for (const kind of kinds) {
      const { label, spec, reference } = PRESETS[kind];
      grid.append(
        h(
          'button',
          {
            class: 'start-card preset-card',
            type: 'button',
            title: `${label} 구조로 엽니다. ${reference}`,
            onclick: () => deps.onPick(kind),
          },
          presetPreview(spec),
          h('span', { class: 'start-card-title' }, label),
          h('span', { class: 'start-card-meta' }, presetMeta(spec)),
        ),
      );
    }
    root.append(
      h(
        'section',
        { class: 'preset-band' },
        h(
          'h4',
          { class: 'preset-band-title' },
          `${band}평대`,
          h('span', { class: 'preset-band-count' }, `${kinds.length}개`),
        ),
        grid,
      ),
    );
  }
  return root;
}
