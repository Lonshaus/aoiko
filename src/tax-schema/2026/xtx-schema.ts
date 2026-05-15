// .xtx 出力スキーマの型定義。
// scripts/build-xtx-schema.ts が国税庁 Ver23 xlsx 仕様書から本ファイルの構造に従う JSON
// （xtx-schema.generated.json）を生成し、xtx.ts がそれを消費して .xtx XML を出力する。
// xtx-schema.generated.json はビルド成果物として git にコミットされる
// （CI で xlsx パース環境が無くても build を回せるようにするため）。

export interface XtxFormMeta {
  /** 様式 ID（例：KOA020 = 確定申告書 第一表/第二表） */
  formId: string;
  /** 帳票名称（例：「申告書第一表」） */
  formName: string;
  /** 名前空間プレフィクス（例：shotoku） */
  namespace: string;
  /** 仕様書バージョン（例：23.0 = 令和8年分） */
  version: string;
  /** 仕様書取得日 ISO（例：2026-05-14） */
  fetchedAt: string;
}

/** 1 要素の定義。Ver23 仕様書 1 行 = 1 element */
export interface XtxElement {
  /** 項番（仕様書での出現順、1 始まり） */
  no: number;
  /** XML ネスト深さ（3 = ルート、4 = 子、5 = 孫… 元 xlsx は "03" "04" 形式） */
  level: number;
  /** 要素内容（日本語名）。中間 wrapper の場合は親要素名のみ */
  ja: string;
  /** XML 要素タグ名（共通ボキャブラリ ID。例：KOA020, ABA00000, ABA00010） */
  tag: string;
  /**
   * 値を保持する属性名（英大文字 SNAKE_CASE。例：NENBUN, NOZEISHA_NM）。
   * e-Tax .xtx は値を子要素ではなく属性で運ぶため、leaf 要素は <ABA00010 NENBUN="2026"/> となる。
   * 中間要素では空文字。
   */
  attrName: string;
  /** 追加属性名（複数可、改行区切り。例：page / VR / softNM） */
  extraAttrs: string[];
  /** データ型（例：yy, yymmdd, kubun, address, name, zipcode, n-kana, page, ...） */
  dataType: string;
  /** 最小出現回数（0 = 任意、1 = 必須） */
  minOccurs: number;
  /** 最大出現回数（数値、または "unbounded"） */
  maxOccurs: number | 'unbounded';
  /** 順位（兄弟間の出現順、仕様書原文） */
  order: string;
  /** 備考（仕様書原文） */
  note: string;
}

export interface XtxSchema {
  meta: XtxFormMeta;
  elements: XtxElement[];
}