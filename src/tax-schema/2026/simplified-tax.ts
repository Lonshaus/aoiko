// 簡易課税制度のみなし仕入率（事業区分別）。
// 出典：消費税法第 37 条、消費税法施行令第 57 条。
// 第 1 種：卸売業（仕入れた商品をその性質・形状を変更しないで他の事業者に販売）
// 第 2 種：小売業（一般消費者に販売）、農業・林業・漁業（飲食料品の譲渡に係る部分）
// 第 3 種：製造業・建設業・農業・林業・漁業（第 2 種以外）・電気・ガス・熱供給・水道業
// 第 4 種：その他（飲食店業、第 1〜3・5・6 種以外）
// 第 5 種：サービス業（運輸通信・金融・保険・サービス業）
// 第 6 種：不動産業

export type SimplifiedTaxCategory = 1 | 2 | 3 | 4 | 5 | 6;

export const DEEMED_INPUT_RATES: Record<SimplifiedTaxCategory, number> = {
  1: 0.9, // 卸売
  2: 0.8, // 小売・農林漁業（飲食料品譲渡）
  3: 0.7, // 製造・建設・農林漁業（その他）等
  4: 0.6, // その他（飲食店業など）
  5: 0.5, // サービス・金融・運輸通信
  6: 0.4, // 不動産
};
// みなし仕入率を取得。
export function deemedInputRate(category: SimplifiedTaxCategory): number {
  return DEEMED_INPUT_RATES[category];
}
// 事業区分の人間可読ラベル（UI 表示用）。
export function simplifiedTaxCategoryLabel(
  category: SimplifiedTaxCategory
): string {
  switch (category) {
    case 1:
      return '第 1 種（卸売業、90%）';
    case 2:
      return '第 2 種（小売業・農林漁業の飲食料品譲渡、80%）';
    case 3:
      return '第 3 種（製造・建設・農林漁業の他、70%）';
    case 4:
      return '第 4 種（その他・飲食店業、60%）';
    case 5:
      return '第 5 種（運輸通信・金融保険・サービス業、50%）';
    case 6:
      return '第 6 種（不動産業、40%）';
  }
}