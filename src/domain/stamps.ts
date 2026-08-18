// スタンプ帳の並べ方だけを持つ。購入も保存もここには無い（画面と store の仕事）。
export type StampTier = 'bronze' | 'silver' | 'gold';

export type Stamp = {
  id: string;
  tier: StampTier;
  // 押した日（ローカル暦の YYYY-MM-DD）。時刻は残さない。何時に支援したかは
  // 利用者にとって意味が無く、時刻まで持つと端末の時計設定が表示に出てしまう。
  at: string;
};

// 支援の品目とスタンプの色の対応。金額そのものは持たない——配信先が 175 地域あり、
// 通貨も価格も地域ごとに違うので、表示価格は商店が返したものを使う。
export const TIP_TIERS = {
  'tip-small': 'bronze',
  'tip-medium': 'silver',
  'tip-large': 'gold',
} as const satisfies Record<string, StampTier>;

export type TipKind = keyof typeof TIP_TIERS;

export function isTipKind(kind: string): kind is TipKind {
  return kind in TIP_TIERS;
}

// 3 列なので 3 の倍数。半端な最終行を作らない。
export const STAMPS_PER_PAGE = 9;

// 手押しらしいばらつき。位置で決めるので、同じ枠のスタンプは何度描いても同じ角度になる。
// 乱数にすると再描画のたびに傾きが変わり、紙に押した物には見えない。
const ROTATIONS = [-7, 5, -2, 4, -5, 2, 6, -4, 3, -6, 1, -3];

export function stampRotation(index: number): number {
  return ROTATIONS[((index % ROTATIONS.length) + ROTATIONS.length) % ROTATIONS.length] ?? 0;
}

// 9 個ちょうどで空の 2 頁目を作らない。次の白紙は「めくったら」出るものであって、
// 頁数表示が先に予告するものではない。
export function stampPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / STAMPS_PER_PAGE));
}

// 常に 9 枠返す。埋まっていない枠は null。枠そのものは最初から見えていて、
// 集まるにつれて埋まる——という見え方にするため、詰めて返さない。
export function stampPageSlots(stamps: readonly Stamp[], page: number): (Stamp | null)[] {
  const start = page * STAMPS_PER_PAGE;
  return Array.from({ length: STAMPS_PER_PAGE }, (_, i) => stamps[start + i] ?? null);
}
