import { catalogById } from '../furniture/catalog';
import { normalizeDeg } from '../plan/geometry';
import { parseFloorPlan, PlanFileError } from '../plan/planFile';
import { buildPresetPlan, parsePresetSpec, type PresetSpec } from '../plan/presets';
import type { FloorPlan } from '../types';
import { DIM_LIMITS, NAME_MAX, NOTE_MAX, newUid, type PlacedItem } from './layout';

export const LAYOUT_FORMAT = 'spiti-layout';
export const LAYOUT_VERSION = 2;

/** 내보내기 파일 형식. 평면도 전체와 그 위의 배치를 함께 담는다. */
export interface LayoutFile {
  format: typeof LAYOUT_FORMAT;
  version: typeof LAYOUT_VERSION;
  plan: FloorPlan;
  exportedAt: string;
  items: PlacedItem[];
  /** 프리셋 구조면 격자 파라미터. 가져온 뒤에도 경계를 드래그할 수 있게 함께 저장한다. */
  preset?: PresetSpec;
}

export interface ParsedLayout {
  /** 파일에 담긴 평면도 전체. v1 파일이나 localStorage 배열처럼 구조가 없으면 null */
  plan: FloorPlan | null;
  /** 프리셋 구조 파일이면 격자 파라미터. 일반 평면도면 null */
  preset: PresetSpec | null;
  /** 파일에 적힌 평면도 id/name. v1 파일의 다른 평면도 경고에 쓴다 */
  planRef: { id: string; name: string } | null;
  items: PlacedItem[];
  /** 형식이 맞지 않아 버린 항목 수 */
  skipped: number;
}

/** 사용자에게 그대로 보여 줄 수 있는 메시지를 담는다 */
export class LayoutFileError extends Error {}

const FALLBACK_COLOR = '#93a3b8';

export function serializeLayout(
  plan: FloorPlan,
  items: PlacedItem[],
  now = new Date(),
  preset?: PresetSpec,
): string {
  const file: LayoutFile = {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    plan,
    exportedAt: now.toISOString(),
    items,
    ...(preset ? { preset } : {}),
  };
  return JSON.stringify(file, null, 2);
}

/** spiti-project-<평면도 id>-<YYYYMMDD-HHmm>.json (현지 시각) */
export function layoutFileName(planId: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `spiti-project-${planId}-${stamp}.json`;
}

/**
 * 내보낸 파일을 읽는다. v1 파일과 localStorage에 저장된 형식(가구 배열)도 받는다.
 * 파일 전체가 잘못되었으면 LayoutFileError를 던지고, 일부 항목만 잘못되었으면 그 항목만 버린다.
 */
export function parseLayout(text: string): ParsedLayout {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LayoutFileError('JSON 파일이 아니거나 내용이 손상되었습니다.');
  }

  let plan: FloorPlan | null = null;
  let preset: PresetSpec | null = null;
  let planRef: ParsedLayout['planRef'] = null;
  let rawItems: unknown;
  if (Array.isArray(data)) {
    rawItems = data;
  } else if (isRecord(data) && data.format === LAYOUT_FORMAT) {
    if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
      throw new LayoutFileError('버전 정보가 없는 Spiti 프로젝트 파일입니다.');
    }
    if (data.version > LAYOUT_VERSION) {
      throw new LayoutFileError('더 새로운 버전의 Spiti에서 내보낸 파일이라 읽을 수 없습니다.');
    }
    if (data.version >= 2) {
      if (!isRecord(data.plan) || typeof data.plan.id !== 'string') {
        throw new LayoutFileError('파일에 평면도 정보가 없습니다.');
      }
      try {
        plan = parseFloorPlan(data.plan);
      } catch (e) {
        if (e instanceof PlanFileError) throw new LayoutFileError(`평면도 구조를 읽지 못했습니다. ${e.message}`);
        throw e;
      }
      // 프리셋 파일이면 격자 파라미터로 평면도를 다시 만든다. 파일 안의 plan과 어긋나도 구조 편집이 일관된다.
      preset = parsePresetSpec(data.preset);
      if (preset) plan = buildPresetPlan(preset);
      planRef = { id: plan.id, name: plan.name };
    } else if (isRecord(data.plan) && typeof data.plan.id === 'string') {
      planRef = {
        id: data.plan.id,
        name: typeof data.plan.name === 'string' ? data.plan.name : data.plan.id,
      };
    }
    rawItems = data.items;
  } else {
    throw new LayoutFileError('Spiti에서 내보낸 배치 파일이 아닙니다.');
  }
  if (!Array.isArray(rawItems)) throw new LayoutFileError('파일에 가구 목록이 없습니다.');

  const items: PlacedItem[] = [];
  const uids = new Set<string>();
  for (const raw of rawItems) {
    const item = sanitizeItem(raw);
    if (!item) continue;
    if (uids.has(item.uid)) item.uid = newUid();
    uids.add(item.uid);
    items.push(item);
  }
  return { plan, preset, planRef, items, skipped: rawItems.length - items.length };
}

/** 위치가 없으면 버리고, 치수·색·이름이 없거나 범위를 벗어나면 가구 목록의 기본값이나 허용 범위로 맞춘다 */
function sanitizeItem(raw: unknown): PlacedItem | null {
  if (!isRecord(raw)) return null;
  const { typeId, x, z } = raw;
  if (typeof typeId !== 'string' || !typeId || !isFiniteNumber(x) || !isFiniteNumber(z)) return null;
  const def = catalogById.get(typeId);

  const dim = (key: 'w' | 'd' | 'h'): number | null => {
    const v = raw[key];
    const value = isFiniteNumber(v) && v > 0 ? v : def?.[key];
    if (value === undefined) return null;
    const [min, max] = DIM_LIMITS[key];
    return Math.min(max, Math.max(min, Math.round(value)));
  };
  const w = dim('w');
  const d = dim('d');
  const h = dim('h');
  if (w === null || d === null || h === null) return null;

  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, NAME_MAX) : '';
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, NOTE_MAX) : '';
  const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : null;
  return {
    uid: typeof raw.uid === 'string' && raw.uid ? raw.uid : newUid(),
    typeId,
    name: name || def?.name || typeId,
    x,
    z,
    rot: normalizeDeg(isFiniteNumber(raw.rot) ? raw.rot : 0),
    w,
    d,
    h,
    color: color ?? def?.color ?? FALLBACK_COLOR,
    ...(note ? { note } : {}),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
