export type ModelKind =
  | 'bed'
  | 'sofa'
  | 'table'
  | 'roundTable'
  | 'island'
  | 'chair'
  | 'desk'
  | 'wardrobe'
  | 'drawer'
  | 'bookshelf'
  | 'shelf'
  | 'tv'
  | 'tvStand'
  | 'fridge'
  | 'fridge1'
  | 'washer'
  | 'rug'
  | 'plant'
  | 'aircon'
  | 'hanger'
  | 'box';

export type Category = 'bedroom' | 'living' | 'study' | 'appliance' | 'etc';

export const CATEGORY_LABELS: Record<Category, string> = {
  bedroom: '침실',
  living: '거실',
  study: '주방·서재',
  appliance: '가전',
  etc: '기타',
};

export interface FurnitureDef {
  id: string;
  name: string;
  category: Category;
  model: ModelKind;
  /** 가로(w) × 깊이(d) × 높이(h), cm */
  w: number;
  d: number;
  h: number;
  color: string;
  /** 바닥에 까는 물건은 다른 가구와 겹쳐도 된다 */
  flat?: boolean;
}

/** 한국 가정에서 흔한 제품 치수를 기본값으로 둔다. 배치 후 치수를 바꿀 수 있다. */
export const CATALOG: FurnitureDef[] = [
  { id: 'bed-queen', name: '퀸 침대', category: 'bedroom', model: 'bed', w: 160, d: 210, h: 90, color: '#9fb4c7' },
  { id: 'bed-ss', name: '슈퍼싱글 침대', category: 'bedroom', model: 'bed', w: 120, d: 210, h: 90, color: '#c7b39f' },
  { id: 'wardrobe', name: '옷장 (2도어)', category: 'bedroom', model: 'wardrobe', w: 120, d: 60, h: 200, color: '#e8e2d6' },
  { id: 'drawer', name: '서랍장', category: 'bedroom', model: 'drawer', w: 80, d: 45, h: 90, color: '#d8c3a5' },
  { id: 'hanger', name: '행거', category: 'bedroom', model: 'hanger', w: 120, d: 50, h: 180, color: '#4b5563' },
  { id: 'sofa-3', name: '3인 소파', category: 'living', model: 'sofa', w: 210, d: 90, h: 85, color: '#7c8a99' },
  { id: 'sofa-2', name: '2인 소파', category: 'living', model: 'sofa', w: 160, d: 85, h: 85, color: '#a88f74' },
  { id: 'tv', name: 'TV + 거실장', category: 'living', model: 'tv', w: 180, d: 45, h: 130, color: '#efe9df' },
  { id: 'tv-stand', name: 'TV장 (TV 없음)', category: 'living', model: 'tvStand', w: 180, d: 40, h: 45, color: '#efe9df' },
  { id: 'rug', name: '러그', category: 'living', model: 'rug', w: 200, d: 150, h: 1, color: '#c9b79c', flat: true },
  { id: 'plant', name: '화분', category: 'living', model: 'plant', w: 45, d: 45, h: 120, color: '#5f8f5a' },
  { id: 'dining-4', name: '4인 식탁', category: 'study', model: 'table', w: 120, d: 80, h: 75, color: '#b08a62' },
  { id: 'dining-round', name: '원형 식탁', category: 'study', model: 'roundTable', w: 100, d: 100, h: 75, color: '#c49a6c' },
  { id: 'island', name: '아일랜드 식탁', category: 'study', model: 'island', w: 160, d: 90, h: 90, color: '#f1ede6' },
  { id: 'chair', name: '의자', category: 'study', model: 'chair', w: 45, d: 50, h: 85, color: '#8b6b4a' },
  { id: 'desk', name: '책상', category: 'study', model: 'desk', w: 120, d: 60, h: 74, color: '#e4dccd' },
  { id: 'bookshelf', name: '책장', category: 'study', model: 'bookshelf', w: 80, d: 30, h: 180, color: '#cdb391' },
  { id: 'bookshelf-wide', name: '와이드 책장', category: 'study', model: 'bookshelf', w: 120, d: 30, h: 180, color: '#e8e2d6' },
  { id: 'shelf', name: '오픈 선반', category: 'study', model: 'shelf', w: 90, d: 45, h: 180, color: '#4b5563' },
  { id: 'fridge', name: '양문형 냉장고', category: 'appliance', model: 'fridge', w: 91, d: 92, h: 180, color: '#d9dde2' },
  { id: 'fridge-1door', name: '단문형 냉장고', category: 'appliance', model: 'fridge1', w: 60, d: 70, h: 185, color: '#d9dde2' },
  { id: 'washer', name: '드럼 세탁기', category: 'appliance', model: 'washer', w: 60, d: 65, h: 85, color: '#f4f5f6' },
  { id: 'aircon', name: '스탠드 에어컨', category: 'appliance', model: 'aircon', w: 50, d: 35, h: 180, color: '#f7f7f7' },
  { id: 'box', name: '직접 입력 (상자)', category: 'etc', model: 'box', w: 100, d: 50, h: 50, color: '#93a3b8' },
];

export const catalogById = new Map(CATALOG.map((d) => [d.id, d]));
