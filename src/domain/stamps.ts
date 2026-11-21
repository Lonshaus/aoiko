// スタンプ帳の並べ方だけを持つ。保存もここには無い（画面と store の仕事）。
// 絵柄は猫のおもちゃ 7 種 × 淡い虹 7 色。スタンプは販売を終えており、過去に押した分の表示にだけ使う。
export const STAMP_SHAPES = [
  'yarn',
  'mouse',
  'bell',
  'feather',
  'fish',
  'butterfly',
  'teaser',
] as const;
export const STAMP_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'indigo',
  'violet',
] as const;

export type StampShape = (typeof STAMP_SHAPES)[number];
export type StampColor = (typeof STAMP_COLORS)[number];

export type Stamp = {
  id: string;
  shape: StampShape;
  color: StampColor;
  // 押した日（ローカル暦の YYYY-MM-DD）。画面に出るのはこちらだけ。時刻を出さないのは、
  // 何時に支援したかが利用者にとって意味を持たないため。
  at: string;
  // 並べ替え用の通し時刻（epoch ミリ秒）。画面には出さない。at は日付までしか無く、
  // id は UUID v4 なので、at だけで並べると同じ日の分が読み込みのたびに入れ替わる。
  // 絵柄の選び方が「直前の何個」を見るため、順序が崩れると 7 種の一巡も崩れる。
  createdAt: number;
};
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
