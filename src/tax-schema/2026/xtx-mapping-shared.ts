// KOA110／KOA210 共通：追加科目欄へ出す前の科目名整形。
// 末尾の全角括弧付き分類（個別評価／一括評価／不動産 等）は科目名の様式欄には不要な
// 内部区分のため取り除く。取り除いても文字数上限を超える場合のみ slice で
// 切り詰める（呼び出し側のバックストップ）。
export function stripClassificationSuffix(name: string): string {
  return name.replace(/（[^（）]*）$/, '');
}
