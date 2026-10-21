import { describe, expect, it } from 'vitest';
import { buildPresetPlan, PRESETS } from '../plan/presets';
import { LayoutStore, type PlacedItem } from './layout';
import { LayoutFileError, layoutFileName, parseLayout, serializeLayout } from './layoutFile';

const plan = buildPresetPlan(PRESETS['villa-10-two'].spec);
const bed: PlacedItem = {
  uid: 'a1',
  typeId: 'bed-queen',
  name: '퀸 침대',
  x: 100.5,
  z: 220,
  rot: 90,
  w: 160,
  d: 210,
  h: 90,
  color: '#9fb4c7',
};
const sofa: PlacedItem = {
  ...bed,
  uid: 'a2',
  typeId: 'sofa-3',
  name: '3인 소파',
  x: 300,
  rot: 0,
  w: 210,
  d: 90,
  h: 85,
  note: '다리 분리 후 이동',
};

describe('프로젝트 파일 v2', () => {
  it('평면도 전체와 배치를 함께 내보내고 그대로 다시 읽는다', () => {
    const text = serializeLayout(plan, [bed, sofa], new Date('2026-10-18T13:00:00Z'));
    const file = JSON.parse(text);
    expect(file).toMatchObject({ format: 'spiti-layout', version: 2, exportedAt: '2026-10-18T13:00:00.000Z' });
    expect(file.plan).toEqual(plan);

    const parsed = parseLayout(text);
    expect(parsed.plan).toEqual(plan);
    expect(parsed.preset).toBeNull();
    expect(parsed.planRef).toEqual({ id: plan.id, name: plan.name });
    expect(parsed.items).toEqual([bed, sofa]);
    expect(parsed.skipped).toBe(0);
  });

  it('프리셋 구조 파일은 격자 파라미터를 함께 저장하고, 가져올 때 평면도를 다시 만든다', () => {
    const base = PRESETS['apt-30-84a'].spec;
    const stretched = { ...base, columns: [base.columns[0] + 30, ...base.columns.slice(1)], width: base.width + 30 };
    const presetPlan = buildPresetPlan(stretched);
    const text = serializeLayout(presetPlan, [bed], new Date('2026-10-20T10:00:00Z'), stretched);
    const file = JSON.parse(text);
    expect(file.preset).toEqual(stretched);

    const parsed = parseLayout(text);
    expect(parsed.preset).toEqual(stretched);
    expect(parsed.plan).toEqual(buildPresetPlan(stretched));
    expect(parsed.plan!.id).toBe('preset-apt-30-84a');
    expect(parsed.items).toEqual([bed]);
  });

  it('잘못된 프리셋 파라미터는 무시하고 파일의 평면도를 그대로 쓴다', () => {
    const text = JSON.stringify({
      format: 'spiti-layout',
      version: 2,
      plan,
      preset: { ...PRESETS['apt-20-59a'].spec, columns: [1], width: 999 },
      items: [bed],
    });
    const parsed = parseLayout(text);
    expect(parsed.preset).toBeNull();
    expect(parsed.plan).toEqual(plan);
  });

  it('v1 파일은 평면도 참조만 읽고 배치는 그대로 받는다', () => {
    const text = JSON.stringify({
      format: 'spiti-layout',
      version: 1,
      plan: { id: 'old-plan', name: '옛 구조' },
      exportedAt: '2026-10-18T13:00:00.000Z',
      items: [bed],
    });
    const parsed = parseLayout(text);
    expect(parsed.plan).toBeNull();
    expect(parsed.planRef).toEqual({ id: 'old-plan', name: '옛 구조' });
    expect(parsed.items).toEqual([bed]);
  });

  it('localStorage에 저장된 가구 배열도 읽는다', () => {
    const parsed = parseLayout(JSON.stringify([bed]));
    expect(parsed.plan).toBeNull();
    expect(parsed.planRef).toBeNull();
    expect(parsed.items).toEqual([bed]);
  });

  it('v2 파일의 평면도가 잘못되었으면 이유를 담아 거부한다', () => {
    const broken = { ...plan, rooms: [{ ...plan.rooms[0], polygon: [[0, 0]] }] };
    const text = JSON.stringify({ format: 'spiti-layout', version: 2, plan: broken, items: [] });
    expect(() => parseLayout(text)).toThrow(LayoutFileError);
    expect(() => parseLayout(text)).toThrow('평면도 구조를 읽지 못했습니다');
  });

  it('프로젝트 파일이 아니거나 더 새로운 버전이면 거부한다', () => {
    expect(() => parseLayout('{not json')).toThrow(LayoutFileError);
    expect(() => parseLayout('{"version":1,"rooms":[]}')).toThrow('배치 파일이 아닙니다');
    expect(() => parseLayout('{"format":"spiti-layout","version":3,"items":[]}')).toThrow('새로운 버전');
    expect(() => parseLayout('{"format":"spiti-layout","version":2,"items":[]}')).toThrow('평면도 정보가 없습니다');
    expect(() => parseLayout('{"format":"spiti-layout","version":2,"plan":{"id":"x"},"items":[]}')).toThrow(
      '평면도 구조를 읽지 못했습니다',
    );
    expect(() => parseLayout('{"format":"spiti-layout","version":1}')).toThrow('가구 목록이 없습니다');
  });

  it('위치가 없는 항목은 버리고 나머지 값은 기본값과 허용 범위로 맞춘다', () => {
    const parsed = parseLayout(
      JSON.stringify({
        format: 'spiti-layout',
        version: 1,
        plan: { id: plan.id, name: plan.name },
        items: [
          { typeId: 'bed-queen', x: 10, z: 20 },
          { typeId: 'desk', x: 0, z: 0, rot: -90, w: 9999, d: 0, h: 1.4, name: '  ', color: 'red' },
          { typeId: 'unknown-thing', x: 5, z: 5, w: 50, d: 50, h: 50 },
          { typeId: 'unknown-thing', x: 5, z: 5 },
          { typeId: 'chair', z: 3 },
          'garbage',
        ],
      }),
    );
    expect(parsed.skipped).toBe(3);
    const [queen, desk, custom] = parsed.items;
    expect(queen).toMatchObject({ name: '퀸 침대', w: 160, d: 210, h: 90, rot: 0, color: '#9fb4c7' });
    expect(queen.uid).toMatch(/^f/);
    expect(desk).toMatchObject({ name: '책상', rot: 270, w: 600, d: 60, h: 1, color: '#e4dccd' });
    expect(custom).toMatchObject({ name: 'unknown-thing', w: 50, color: '#93a3b8' });
  });

  it('라벨 메모는 앞뒤 공백을 지우고 길이를 자르며, 비어 있으면 넣지 않는다', () => {
    const parsed = parseLayout(
      JSON.stringify([
        { ...bed, note: '  안방 창가 쪽  ' },
        { ...bed, uid: 'b2', note: '   ' },
        { ...bed, uid: 'b3', note: 'ㄱ'.repeat(60) },
        { ...bed, uid: 'b4', note: 42 },
      ]),
    );
    const [trimmed, blank, long, wrongType] = parsed.items;
    expect(trimmed.note).toBe('안방 창가 쪽');
    expect('note' in blank).toBe(false);
    expect(long.note).toHaveLength(40);
    expect('note' in wrongType).toBe(false);
  });

  it('겹치는 uid는 새로 만든다', () => {
    const parsed = parseLayout(JSON.stringify([bed, { ...bed, x: 0 }]));
    expect(parsed.items[0].uid).toBe('a1');
    expect(parsed.items[1].uid).not.toBe('a1');
  });

  it('파일 이름에 프로젝트와 평면도 id, 현지 시각을 넣는다', () => {
    expect(layoutFileName('preset-villa-10-two', new Date(2026, 9, 18, 9, 5))).toBe(
      'spiti-project-preset-villa-10-two-20261018-0905.json',
    );
  });

  it('가져온 배치로 통째로 바꾸고, 되돌리기 한 번으로 이전 배치로 돌아간다', () => {
    const s = new LayoutStore(null);
    const old = s.add({ ...bed, uid: undefined });
    s.replaceAll(parseLayout(serializeLayout(plan, [bed, sofa])).items);
    expect(s.items.map((i) => i.uid)).toEqual(['a1', 'a2']);
    expect(s.selected).toBeNull();

    s.undo();
    expect(s.items.map((i) => i.uid)).toEqual([old.uid]);
  });
});
