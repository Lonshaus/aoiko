// .xtx 出力スキーマの型定義。
//
// scripts/build-xtx-schema.js が国税庁公式 W3C XSD（e-tax19.CAB「XMLスキーマ」）から
// 本ファイルの構造に従う JSON（xtx-schema-*.generated.json）を生成し、xtx.ts が
// それを消費して .xtx XML を出力する。生成 JSON はビルド成果物として git に commit する
// （CI に xsd パース環境が無くても build を回せるようにするため）。
//
// e-Tax .xtx は 2 段式 ID/IDREF モデル：
//  - 定義側（IT部）：実値を持つ要素を ID 属性付きで列挙（ITdefinition.xsd / ITtype）
//  - 参照側（帳票個別部分）：様式 xsd（KOA020 等）。各 leaf は *ref 型で、
//    IDREF 属性により定義側の ID を指す空要素
// refTree が参照側ツリー、definitions が定義側カタログ。

export interface XtxFormMeta {
  /** 様式 ID（例：KOA020=確定申告書 / KOA210=青色申告決算書一般用） */
  formId: string;
  /** 帳票名称（xsd:documentation の様式名） */
  formName: string;
  /** ターゲット名前空間 URI（例：http://xml.e-tax.nta.go.jp/XSD/shotoku） */
  namespace: string;
  /** 様式バージョン（VR enumeration 値。例：23.0 / 11.0） */
  version: string;
  /** 取得元（例：e-tax19.CAB shotoku/KOA020-023.xsd） */
  source: string;
  /** 仕様取得日 ISO（例：2026-05-16） */
  fetchedAt: string;
}

/** 参照側ツリーの 1 要素（様式 xsd を level でフラット化） */
export interface XtxRefElement {
  /** 出現順（1 始まり、xsd:sequence 順） */
  no: number;
  /** ネスト深さ（ルート様式要素 = 0） */
  level: number;
  /** XML タグ名（共通ボキャブラリ ID。例：KOA020, ABA00010） */
  tag: string;
  /** 日本語名（xsd:appinfo。引用符は除去済） */
  ja: string;
  /** 'branch'=中間要素 / 'leaf'=値参照要素 */
  kind: 'branch' | 'leaf';
  /**
   * leaf のとき：定義側の対応データ名（*ref 型の IDREF fixed 値）。
   * 例 gen:NENBUNref → 'NENBUN'。branch では空文字。
   */
  idref: string;
  /** leaf の型 QName（例：gen:NENBUNref）。branch では空文字 */
  refType: string;
  /** 最小出現回数（0=任意、1=必須） */
  minOccurs: number;
  /** 最大出現回数（数値 or 'unbounded'） */
  maxOccurs: number | 'unbounded';
}

/** 定義側（IT部）のデータ項目カタログ（ITdefinition.xsd / ITtype より） */
export interface XtxDefinition {
  /** データ名（参照側 idref と対応。例：NENBUN, ZEIMUSHO） */
  name: string;
  /** 日本語名（xsd:appinfo） */
  ja: string;
  /** 値の基底型（xsd:extension @base。例：gen:yy, gen:kingaku） */
  baseType: string;
  /** ID 属性を持つか（定義側要素は通常 true） */
  hasId: boolean;
  /** 最小出現回数 */
  minOccurs: number;
}

export interface XtxSchema {
  meta: XtxFormMeta;
  /** 参照側ツリー（level でフラット化、no 昇順） */
  refTree: XtxRefElement[];
  /** 定義側データ項目カタログ */
  definitions: XtxDefinition[];
}