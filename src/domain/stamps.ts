// スタンプ帳の並べ方と、絵柄の決め方だけを持つ。購入も保存もここには無い（画面と store の仕事）。
// 絵柄は猫のおもちゃ 7 種 × 淡い虹 7 色。押した時点で決まり、以後変わらない。
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
  // 絵柄の選び方が「直前の何個」を見るため、順序が崩れると 7 種の輪も崩れる。
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

// 7 種を使い切るまで同じものを引かない。素の無作為だと 9 枠の 1 頁に同じ絵柄が 3 回出ることが
// あり、集まっていく見え方にならない。袋の中身は保存せず、既に押した分から今の周回を割り出す。
function drawFrom<T>(
  pool: readonly [T, ...T[]],
  used: readonly T[],
  previous: T | undefined,
  random: () => number,
): T {
  const rest = pool.filter((v) => !used.includes(v));
  // 周回の切れ目。ここを見ないと、避けたかった「隣り合う重複」だけが残る。
  const choices =
    rest.length === pool.length && previous !== undefined
      ? pool.filter((v) => v !== previous)
      : rest;
  return choices[Math.floor(random() * choices.length)] ?? pool[0];
}

// 絵柄と色は独立に引く。連動させると 7 通りしか出ず、49 通りある意味が無くなる。
export function nextStampFace(
  stamps: readonly Stamp[],
  random: () => number = Math.random,
): { shape: StampShape; color: StampColor } {
  const cycle = stamps.length % STAMP_SHAPES.length;
  const current = cycle === 0 ? [] : stamps.slice(-cycle);
  const previous = stamps[stamps.length - 1];
  return {
    shape: drawFrom(
      STAMP_SHAPES,
      current.map((s) => s.shape),
      previous?.shape,
      random,
    ),
    color: drawFrom(
      STAMP_COLORS,
      current.map((s) => s.color),
      previous?.color,
      random,
    ),
  };
}
