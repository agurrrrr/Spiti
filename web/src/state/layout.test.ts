import { describe, expect, it } from 'vitest';
import { LayoutStore } from './layout';

const bed = { typeId: 'bed-queen', name: '퀸 침대', x: 100, z: 100, rot: 0, w: 160, d: 210, h: 90, color: '#fff' };

describe('LayoutStore', () => {
  it('추가·이동·삭제를 되돌리고 다시 실행한다', () => {
    const s = new LayoutStore(null);
    const item = s.add(bed);
    expect(s.selected).toBe(item.uid);

    s.begin();
    s.patch(item.uid, { x: 120 });
    s.patch(item.uid, { x: 150 });
    s.end();
    expect(s.get(item.uid)?.x).toBe(150);

    s.remove(item.uid);
    expect(s.items).toHaveLength(0);
    expect(s.selected).toBeNull();

    s.undo();
    expect(s.get(item.uid)?.x).toBe(150);
    s.undo();
    expect(s.get(item.uid)?.x).toBe(100);
    s.redo();
    expect(s.get(item.uid)?.x).toBe(150);
  });

  it('드래그 중 여러 번 바뀌어도 되돌리기 한 번으로 돌아간다', () => {
    const s = new LayoutStore(null);
    const item = s.add(bed);
    s.begin();
    for (let x = 101; x <= 140; x++) s.patch(item.uid, { x });
    s.end();
    s.undo();
    expect(s.get(item.uid)?.x).toBe(100);
    expect(s.canUndo).toBe(true);
  });

  it('회전 각도를 0~360으로 정규화한다', () => {
    const s = new LayoutStore(null);
    const item = s.add({ ...bed, rot: -90 });
    expect(item.rot).toBe(270);
    s.update(item.uid, { rot: 450 });
    expect(s.get(item.uid)?.rot).toBe(90);
  });

  it('복제하면 조금 옆에 새 가구가 생기고 선택된다', () => {
    const s = new LayoutStore(null);
    const item = s.add(bed);
    const copy = s.duplicate(item.uid)!;
    expect(copy.uid).not.toBe(item.uid);
    expect([copy.x, copy.z]).toEqual([120, 120]);
    expect(s.selected).toBe(copy.uid);
  });
});
