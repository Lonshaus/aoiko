// aoiko の業務データ → 確定申告書（KOA020 / Ver23）要素タグのマッピング。
// キーは xtx-schema.generated.json の element.tag（共通ボキャブラリ ID）。
// 値は「その leaf 要素の attrName に入れる文字列」を返す関数。undefined を返すと
// その要素は出力されない（KOA020 第一表/第二表は全要素 minOccurs=0 なので省略可）。
//
// ⚠ aoiko は確定申告書本体に必要な個人情報（住所・氏名・個人番号・各種所得控除・
// 税額計算）を収集しない設計のため、現状マッピングできるのは「年分」と「屋号」のみ。
// 損益・貸借の数値は青色申告決算書（別様式・Sub 3）の領域であり KOA020 ではない。

import type { XtxContext } from './xtx';

export type XtxValueResolver = (ctx: XtxContext) => string | undefined;

/** 西暦 → 令和年（2 桁ゼロ詰め）。令和 1 年 = 2019。 */
function toReiwa2(year: number): string {
  const reiwa = year - 2018;
  if (reiwa < 1) {
    return '';
  }
  return String(reiwa).padStart(2, '0');
}

export const KOA020_MAPPING: Record<string, XtxValueResolver> = {
  // ABA00010 年分（dataType: yy）令和年 2 桁
  ABA00010: (ctx) => toReiwa2(ctx.year) || undefined,
  // ABA00170 屋号・雅号（dataType: yago）
  ABA00170: (ctx) => ctx.businessName.trim() || undefined,
};

// 未マッピングだが将来対応候補（aoiko が入力 UI を持てば対応可能）：
//   ABA00020 SHINKOKU_KBN 申告の種類（青色区分）— 帳票フィールド仕様書で値定義要確認
//   ABA00030 ZEIMUSHO 税務署名
//   ABA00090 NOZEISHA_ADR 住所
//   ABA00140 NOZEISHA_NM 氏名
//   ABA00125 NOZEISHA_BANGO 個人番号
//   ABA00200 BIRTHDAY 生年月日
//   ABA00220 NOZEISHA_TEL 電話番号
// これらは個人情報のため aoiko の BYOK・ローカル方針と要すり合わせ。