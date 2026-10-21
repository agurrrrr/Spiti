import { LayoutFileError, parseLayout } from '../state/layoutFile';
import type { PlacedItem } from '../state/layout';
import type { PresetSpec } from '../plan/presets';
import type { FloorPlan } from '../types';

export interface ProjectOpenContext {
  /** 지금 열려 있는 평면도. 시작 화면에서는 null */
  currentPlan: FloorPlan | null;
  currentItems: PlacedItem[];
  /** 평면도는 그대로 두고 배치만 바꾼다 */
  applyItems: (items: PlacedItem[]) => void;
  /** 평면도와 배치를 함께 바꾼다. 파일이 프리셋 구조면 격자 파라미터도 넘긴다. */
  switchPlan: (plan: FloorPlan, items: PlacedItem[], preset?: PresetSpec) => void;
}

const samePlan = (a: FloorPlan, b: FloorPlan) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 프로젝트 파일(v2)·v1 배치 파일·localStorage 배열을 읽어 적용한다.
 * 적용했으면 true, 사용자가 취소했거나 파일이 잘못되었으면 false.
 */
export function openProjectText(text: string, ctx: ProjectOpenContext): boolean {
  let parsed;
  try {
    parsed = parseLayout(text);
  } catch (e) {
    alert(`프로젝트 파일을 열지 못했습니다.\n${e instanceof LayoutFileError ? e.message : String(e)}`);
    return false;
  }

  const { items, skipped } = parsed;

  if (parsed.plan) {
    // v2: 평면도 전체가 들어 있다. 구조가 다르면 한 번만 확인하고 구조+배치를 함께 연다.
    if (!ctx.currentPlan) {
      ctx.switchPlan(parsed.plan, items, parsed.preset ?? undefined);
      if (skipped) alert(`가구 ${items.length}개를 가져왔습니다. 형식이 맞지 않는 항목 ${skipped}개는 건너뛰었습니다.`);
      return true;
    }
    if (samePlan(parsed.plan, ctx.currentPlan)) {
      // 프리셋 파일이면 구조 편집 손잡이를 붙이기 위해 평면도를 다시 연다
      if (parsed.preset) {
        ctx.switchPlan(parsed.plan, items, parsed.preset);
        if (skipped) alert(`가구 ${items.length}개를 가져왔습니다. 형식이 맞지 않는 항목 ${skipped}개는 건너뛰었습니다.`);
        return true;
      }
      return replaceItems(items, skipped, parsed.planRef, ctx);
    }
    const ask =
      `이 파일의 구조 "${parsed.plan.name}"로 바꿀까요?\n\n` +
      '지금 구조의 배치는 브라우저에 그대로 남아 있어서 나중에 다시 열 수 있습니다.' +
      (ctx.currentItems.length ? `\n지금 배치한 가구 ${ctx.currentItems.length}개는 화면에서 사라집니다.` : '');
    if (!confirm(ask)) return false;
    ctx.switchPlan(parsed.plan, items, parsed.preset ?? undefined);
    if (skipped) alert(`가구 ${items.length}개를 가져왔습니다. 형식이 맞지 않는 항목 ${skipped}개는 건너뛰었습니다.`);
    return true;
  }

  if (!ctx.currentPlan) {
    alert('이 파일에는 평면도 구조가 없습니다. 먼저 시작 화면에서 평면도를 골라 주세요.');
    return false;
  }
  return replaceItems(items, skipped, parsed.planRef, ctx);
}

function replaceItems(
  items: PlacedItem[],
  skipped: number,
  planRef: { id: string; name: string } | null,
  ctx: ProjectOpenContext,
): boolean {
  if (items.length === 0) {
    alert(skipped ? '파일에 가져올 수 있는 가구가 없습니다.' : '파일에 배치된 가구가 없습니다.');
    return false;
  }

  const questions: string[] = [];
  if (planRef && planRef.id !== ctx.currentPlan!.id) {
    questions.push(`이 파일은 다른 평면도("${planRef.name}")에서 만든 배치라서 가구 위치가 맞지 않을 수 있습니다.`);
  }
  if (ctx.currentItems.length) {
    questions.push(
      `지금 배치한 가구 ${ctx.currentItems.length}개를 파일의 가구 ${items.length}개로 바꿉니다. 되돌리기로 이전 배치를 복구할 수 있습니다.`,
    );
  }
  if (questions.length && !confirm(`${questions.join('\n\n')}\n\n가져올까요?`)) return false;

  ctx.applyItems(items);
  if (skipped) alert(`가구 ${items.length}개를 가져왔습니다. 형식이 맞지 않는 항목 ${skipped}개는 건너뛰었습니다.`);
  return true;
}

