// e-Tax .xtx 2 段式 ID/IDREF 文書モデルの核。
//
// 入力：様式 schema（xtx-schema-*.generated.json）+ 値マップ（定義名→値）
// 出力：エンベロープ付き .xtx XML 文字列
//
// 構造は e-Tax 自身が「切り出し」た実ファイル（PJ_aoiko/etax-reference-koa210.xtx）に
// 準拠する。判定 A（実機取込）が SC00X010 で fail した根因＝旧封包の構造誤りを修正：
//   <DATA id="DATA" xmlns=…/shotoku xmlns:gen xmlns:kyo xmlns:xlink xmlns:xsi>
//     <RKO0010 VR="25.0.0" id="RKO0010">          手続ID 要素（id＝手続コード）
//       <CATALOG id="CATALOG">                     管理用部分（RDF マニフェスト）
//         <rdf:RDF><rdf:description id="REPORT">
//           SEND_DATA / IT_SEC(#IT) / FORM_SEC(各様式) / …各 SEC / SOFUSHO_SEC(#TEA060-1)
//       <CONTENTS id="CONTENTS">                   内容部分
//         <IT VR="1.5" id="IT"> … </IT>            ①IT部＝定義側（値＋ID属性）
//         <{様式ID} VR id="{様式ID}-1" page="1" …>   ②帳票個別部分＝参照側（IDREF配線）
//           <{様式ID}-N page="N"> … </{様式ID}-N>     各ページを子に持つ単一様式要素
//         <SOFUSHO VR="15.0" fid="TEA060" … xmlns=…/kyotsu/>  送信票（必須）
//
// 様式要素は官公式 xsd（KOA210-011.xsd 等）の定義どおり「単一 <KOA210> がページ
// 子要素 KOA210-1..4 を内包する」モデル。id は様式インスタンスID＝`{様式ID}-1`。

import type { XtxSchema } from './xtx-schema';
import { todayISO } from '../../lib/date';
/** 定義名（例 NENBUN, ZEIMUSHO）→ 値文字列。Sub C/D の mapping が生成する */
export type XtxValues = Record<string, string>;
// 申告者情報（IT部 定義側の必須・任意項目）。複合型（ZEIMUSHO・NOZEISHA_ZIP）を
// 含むため XtxValues とは別に構造化して渡す。第一表の氏名/住所/税務署は
// この IT部 ID を参照側 IDREF で引くため、ここに値があれば自動的に帳票へ反映される。
export interface XtxFilerInfo {
  /** 提出先税務署コード（5桁、gen:zeimusho_CD、IT部 必須） */
  zeimushoCode?: string;
  /** 提出先税務署名（gen:zeimusho_NM、任意） */
  zeimushoName?: string;
  /** 利用者識別番号（16桁、NOZEISHA_ID、IT部 必須） */
  riyoshaId?: string;
  /** 氏名・名称（NOZEISHA_NM、IT部 必須） */
  name?: string;
  /** 郵便番号（7桁・ハイフン無し、NOZEISHA_ZIP、任意） */
  zip?: string;
  /** 住所（NOZEISHA_ADR、IT部 必須） */
  address?: string;
}

export interface XtxDocumentOptions {
  /**
   * 手続ID 要素のタグ名・id（手続コード）。既定は所得税確定申告（青色・決算書同梱）の
   * `RKO0010`（e-tax07「手続一覧」由来、#22 / #33 で確定）。
   * 他の手続を流用する場合のみ上書きする。
   */
  procedureTag?: string;
  /**
   * 手続ID 要素の VR（手続バージョン）。データ形式等仕様書 表1-1-1：2005 年度以降の
   * 手続は年度バージョンを先頭に付した 3 桁体系（例「25.0.0」）が必須。
   */
  procedureVersion?: string;
  /** 手続名称（IT部 TETSUZUKI/procedure_NM）。既定は所得税確定申告の名称 */
  procedureName?: string;
  /** 作成ソフト名（gen:FormAttribute softNM、必須）。既定 'aoiko' */
  softwareName?: string;
  /** 作成者名（gen:FormAttribute sakuseiNM、必須）。通常は屋号/事業者名 */
  creatorName?: string;
  /** 作成日（gen:FormAttribute sakuseiDay、必須、xsd:date YYYY-MM-DD） */
  creationDate?: string;
  /** 申告者情報（IT部 定義側の必須項目）。未指定だと IT部 必須項目が欠落する */
  filer?: XtxFilerInfo;
  /**
   * 送信票（SOFUSHO/TEA060）を CONTENTS に含めるか。既定 true（所得税 RKO0010 は必須）。
   * 手続によっては CONTENTS 型が SOFUSHO を許可しない（例：消費税 RSH0010/RSH0030、
   * 2026-07-05 実機組み込みで発覚：CONTENTS の xsd:sequence に SOFUSHO が定義されて
   * いない）。その場合は false を指定する。
   */
  includeSofusho?: boolean;
  /**
   * IT部 SHINKOKU_KBN（申告の種類）の kubun_CD。既定 '1'（確定）。
   * 消費税の中間申告（仮決算方式）を送信する場合のみ '2'（中間）を指定する
   * （e-tax11.CAB「帳票フィールド仕様書(消費-申告)」で確認：1:確定 2:中間
   * 3:修正確定 4:修正中間。所得税 KOA020 とも共有する IT部 定義のため、
   * 所得税側の呼び出しは既定値のまま変更しない）。
   */
  shinkokuKbn?: string;
}
// e-tax07「01手続一覧」Ver250x より：所得税及び復興特別所得税申告。
// 確定申告書(KOA020)+青色申告決算書(KOA210) はこの手続で送信する。
const DEFAULT_PROCEDURE_TAG = 'RKO0010';
// RKO0010 の手続バージョン。e-tax07「手続一覧」Ver250x で RKO0010＝25.0.0。
const DEFAULT_PROCEDURE_VERSION = '25.0.0';
// IT部 TETSUZUKI/procedure_NM（参照ファイル準拠）。
const DEFAULT_PROCEDURE_NAME = '所得税及び復興特別所得税申告';
// e-Tax 共通名前空間（参照ファイル準拠）。既定 ns は様式 schema の meta.namespace。
const NS_GENERAL = 'http://xml.e-tax.nta.go.jp/XSD/general';
const NS_KYOTSU = 'http://xml.e-tax.nta.go.jp/XSD/kyotsu';
const NS_XLINK = 'http://www.w3.org/1999/xlink';
const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const NS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
// IT部 VR（参照ファイル＝1.5）。
const IT_VERSION = '1.5';
// 送信票（汎用送信票 TEA060）。所得税申告でも必須。kyotsu ns で自閉出力。
const SOFUSHO_VR = '15.0';
const SOFUSHO_FID = 'TEA060';
const SOFUSHO_ID = 'TEA060-1';
// NENBUN は IT部で複合型 <gen:era><gen:yy>。era=5＝令和（参照ファイル準拠）。
const NENBUN_ERA_REIWA = '5';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface RefNode {
  no: number;
  level: number;
  tag: string;
  kind: 'branch' | 'leaf';
  idref: string;
  children: RefNode[];
}
// フラット refTree（level 付き）をネスト木へ再構成
function buildRefTreeNodes(schema: XtxSchema): RefNode {
  const root: RefNode = {
    no: 0,
    level: -1,
    tag: '',
    kind: 'branch',
    idref: '',
    children: [],
  };
  const stack: RefNode[] = [root];
  for (const e of schema.refTree) {
    const node: RefNode = {
      no: e.no,
      level: e.level,
      tag: e.tag,
      kind: e.kind,
      idref: e.idref,
      children: [],
    };
    while (stack.length > 1 && stack[stack.length - 1]!.level >= e.level) {
      stack.pop();
    }
    stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  return root.children[0]!;
}

interface FormAttrs {
  softNM: string;
  sakuseiNM: string;
  sakuseiDay: string;
}
// 直接値 leaf（idref 無し）の値マップ：leaf tag → 値文字列。
// KOA210 決算書の金額等はこちら（IT部を経由しない）。
export type XtxLeafValues = Record<string, string>;
// 繰り返しブロック（xsd:maxOccurs > 1、例：KOA110 の減価償却資産明細 AIM00010）の値。
// ブランチ tag → その繰り返し 1 件分の直接値 leaf マップの配列。
// 各エントリは独立した leafValues として子要素を解決する（他の繰り返しや外側の
// leafValues とは混ざらない）。エントリが 0 件ならそのブランチ自体を出力しない。
export type XtxRepeatedValues = Record<string, XtxLeafValues[]>;
// 「区分」型（gen:kubun、例：SHA020 の ABY00000「税額控除に係る経過措置の適用
// （２割特例）」）は kubun_CD 子要素を持つが、buildRefTree の型解決では子として
// 展開されない（KOA020 の SHINKOKU_KBN 等、IT部側の同種フィールドが buildItPart
// で生 XML を直書きしているのと同じ理由）。ブランチ tag → 内側の生 XML
// （例：'<kubun_CD>1</kubun_CD>'）を直接指定する対応。
export type XtxRawValues = Record<string, string>;
// gen:yymmdd（複合型：<gen:era>/<gen:yy>/<gen:mm>/<gen:dd>）の raw XML を組み立てる。
// 中間申告の対象期間（AAI00170/180 等）のように、kind:'leaf' だが実際は複合型な項目は
// leafValues の単純文字列では表現できないため、XtxRawValues 経由で渡す。
// era/yy/mm/dd は General.xsd 由来の要素（gen: 名前空間）のため、NENBUN（同じく
// gen:era/gen:yy を使う複合型）と同様に gen: 接頭辞が必須——kubun_CD（各様式の
// ローカル型）と異なりプレフィックス無しでは xmllint 検証に失敗する（実際に発覚・修正済み）。
// 令和 = 西暦 − 2018（xtx-mapping-koa020.ts の toReiwa と同じ規約）。
export function toYymmdd(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number];
  const reiwa = y - 2018;
  return `<gen:era>5</gen:era><gen:yy>${reiwa}</gen:yy><gen:mm>${m}</gen:mm><gen:dd>${d}</gen:dd>`;
}

interface ItPart {
  /** <IT VR="1.5" id="IT"> … </IT> */
  xml: string;
  /** 参照側 IDREF 解決用：定義名 → ID（＝定義名） */
  idByName: Map<string, string>;
}
// 定義側（IT部）を出力。
//  - NENBUN は複合型 <gen:era>5</gen:era><gen:yy>{年}</gen:yy>（純文字ではない）
//  - ZEIMUSHO / NOZEISHA_ZIP も複合型（gen:zeimusho_CD/_NM、gen:zip1/zip2）
//  - NOZEISHA_ID / NOZEISHA_NM / NOZEISHA_ADR は申告者情報（filer）から（IT部 必須）
//  - TETSUZUKI / SHINKOKU_KBN は所得税申告の構造項目として常に出力（個資ではない）
//  - その他は値が与えられた定義のみ <名> ID="名">値</名> で出力
// xsd:ID は定義名そのもの（ITreference.xsd の *ref 型は IDREF を fixed="<定義名>" で
// 固定するため、参照側 IDREF＝定義名＝定義側 ID）。出力順は ITdefinition.xsd の
// sequence 順（＝ schema.definitions の並び）に従う。
function buildItPart(
  schema: XtxSchema,
  values: XtxValues,
  procedureTag: string,
  procedureName: string,
  filer: XtxFilerInfo,
  shinkokuKbn: string
): ItPart {
  const idByName = new Map<string, string>();
  const parts: string[] = [];
  const push = (name: string, xml: string): void => {
    parts.push(xml);
    idByName.set(name, name);
  };
  for (const def of schema.definitions) {
    const name = def.name;
    if (name === 'TETSUZUKI') {
      push(
        'TETSUZUKI',
        `<TETSUZUKI ID="TETSUZUKI"><procedure_CD>${escapeXml(procedureTag)}</procedure_CD>` +
          `<procedure_NM>${escapeXml(procedureName)}</procedure_NM></TETSUZUKI>`
      );
      continue;
    }
    if (name === 'SHINKOKU_KBN') {
      push(
        'SHINKOKU_KBN',
        `<SHINKOKU_KBN ID="SHINKOKU_KBN"><kubun_CD>${escapeXml(shinkokuKbn)}</kubun_CD></SHINKOKU_KBN>`
      );
      continue;
    }
    if (name === 'ZEIMUSHO') {
      if (filer.zeimushoCode) {
        const nm = filer.zeimushoName
          ? `<gen:zeimusho_NM>${escapeXml(filer.zeimushoName)}</gen:zeimusho_NM>`
          : '';
        push(
          'ZEIMUSHO',
          `<ZEIMUSHO ID="ZEIMUSHO"><gen:zeimusho_CD>${escapeXml(filer.zeimushoCode)}</gen:zeimusho_CD>${nm}</ZEIMUSHO>`
        );
      }
      continue;
    }
    if (name === 'NOZEISHA_ID') {
      if (filer.riyoshaId) {
        push('NOZEISHA_ID', `<NOZEISHA_ID ID="NOZEISHA_ID">${escapeXml(filer.riyoshaId)}</NOZEISHA_ID>`);
      }
      continue;
    }
    if (name === 'NOZEISHA_NM') {
      if (filer.name) {
        push('NOZEISHA_NM', `<NOZEISHA_NM ID="NOZEISHA_NM">${escapeXml(filer.name)}</NOZEISHA_NM>`);
      }
      continue;
    }
    if (name === 'NOZEISHA_ZIP') {
      const zip = (filer.zip ?? '').replace(/[^0-9]/g, '');
      if (zip.length === 7) {
        push(
          'NOZEISHA_ZIP',
          `<NOZEISHA_ZIP ID="NOZEISHA_ZIP"><gen:zip1>${zip.slice(0, 3)}</gen:zip1>` +
            `<gen:zip2>${zip.slice(3)}</gen:zip2></NOZEISHA_ZIP>`
        );
      }
      continue;
    }
    if (name === 'NOZEISHA_ADR') {
      if (filer.address) {
        push('NOZEISHA_ADR', `<NOZEISHA_ADR ID="NOZEISHA_ADR">${escapeXml(filer.address)}</NOZEISHA_ADR>`);
      }
      continue;
    }
    const v = values[name];
    if (v === undefined || v === '') {
      continue;
    }
    if (name === 'NENBUN') {
      push(
        'NENBUN',
        `<NENBUN ID="NENBUN"><gen:era>${NENBUN_ERA_REIWA}</gen:era>` +
          `<gen:yy>${escapeXml(v)}</gen:yy></NENBUN>`
      );
    } else {
      push(name, `<${name} ID="${name}">${escapeXml(v)}</${name}>`);
    }
  }
  return { xml: `<IT VR="${IT_VERSION}" id="IT">${parts.join('')}</IT>`, idByName };
}
// 参照側 leaf/branch（level >= 2）を描画。
//  - leaf.idref 有：対応 IT部 ID があるとき IDREF 空要素
//  - leaf.idref 無：leafValues に値があるとき <TAG>値</TAG>
//  - branch：repeats[tag] があれば繰り返しブロックとして 1 件ごとに独立した
//    leafValues で子要素を解決し、<TAG>...</TAG> をエントリ数だけ並べて出力する
//  - branch（通常）：出力対象の子があるときのみ自身を出力
function renderNode(
  node: RefNode,
  idByName: Map<string, string>,
  leafValues: XtxLeafValues,
  repeats: XtxRepeatedValues,
  raw: XtxRawValues
): string | null {
  if (node.kind === 'leaf') {
    if (node.idref) {
      const id = idByName.get(node.idref);
      return id ? `<${node.tag} IDREF="${id}"/>` : null;
    }
    const v = leafValues[node.tag];
    if (v === undefined || v === '') {
      return null;
    }
    return `<${node.tag}>${escapeXml(v)}</${node.tag}>`;
  }
  const rawInner = raw[node.tag];
  if (rawInner !== undefined) {
    return rawInner === '' ? null : `<${node.tag}>${rawInner}</${node.tag}>`;
  }
  const entries = repeats[node.tag];
  if (entries) {
    const rendered = entries
      .map((entry) => {
        const inner: string[] = [];
        for (const c of node.children) {
          const r = renderNode(c, idByName, entry, repeats, raw);
          if (r !== null) {
            inner.push(r);
          }
        }
        return inner.length > 0 ? `<${node.tag}>${inner.join('')}</${node.tag}>` : null;
      })
      .filter((s): s is string => s !== null);
    return rendered.length > 0 ? rendered.join('') : null;
  }
  const inner: string[] = [];
  for (const c of node.children) {
    const r = renderNode(c, idByName, leafValues, repeats, raw);
    if (r !== null) {
      inner.push(r);
    }
  }
  if (inner.length === 0) {
    return null;
  }
  return `<${node.tag}>${inner.join('')}</${node.tag}>`;
}
// 様式インスタンスID（id 属性・CATALOG about 参照）。様式は 1 度しか現れないため -1 固定。
function formInstanceId(formId: string): string {
  return `${formId}-1`;
}
// ページ要素タグ（KOA210-2 等）から面番号を取り出す（末尾連番）。
function pageNumberOf(tag: string): string {
  const m = /-(\d+)$/.exec(tag);
  return m ? m[1]! : '1';
}

// ページが「実質データ（直接値 leaf）」を持つか。年分・申告区分・屋号等のヘッダは
// IT部 IDREF で全ページに現れるため、それだけのページは出力対象外とする
// （例：KOA020 第三表＝分離課税・第四表＝損失申告は該当データが無ければ出力しない）。
function pageHasDirectValue(
  node: RefNode,
  leafValues: XtxLeafValues,
  repeats: XtxRepeatedValues,
  raw: XtxRawValues
): boolean {
  if (node.kind === 'leaf') {
    if (node.idref) {
      return false;
    }
    const v = leafValues[node.tag];
    return v !== undefined && v !== '';
  }
  if ((repeats[node.tag]?.length ?? 0) > 0) {
    return true;
  }
  if ((raw[node.tag] ?? '') !== '') {
    return true;
  }
  return node.children.some((c) => pageHasDirectValue(c, leafValues, repeats, raw));
}

interface RenderedForm {
  formId: string;
  xml: string;
}
// 様式（参照側）を単一様式要素として描画。公式 xsd モデルどおり、ルート様式要素
// <KOA210 …> がページ子要素 <KOA210-N page="N"> を内包する。出力対象データを持つ
// ページのみ出力。全ページ空なら null（その様式は CONTENTS/CATALOG に載せない）。
// 様式ルートの子要素が「{様式ID}-{面番号}」のページラッパになっているか
// （KOA020/KOA210/KOA110 等の複数頁様式）。付表6 等の単頁様式は子要素が
// 意味のあるタグ（AYB00000 等）で、ページラッパを持たない。
function isPageWrapperTag(formId: string, tag: string): boolean {
  return new RegExp(`^${formId}-\\d+$`).test(tag);
}

function renderForm(
  schema: XtxSchema,
  idByName: Map<string, string>,
  leafValues: XtxLeafValues,
  attrs: FormAttrs,
  repeats: XtxRepeatedValues,
  raw: XtxRawValues
): RenderedForm | null {
  const formRoot = buildRefTreeNodes(schema);
  const formId = formRoot.tag;
  const hasPageWrappers =
    formRoot.children.length > 0 &&
    formRoot.children.every((c) => isPageWrapperTag(formId, c.tag));

  let bodyXml: string;
  if (hasPageWrappers) {
    const pages: string[] = [];
    for (const pageNode of formRoot.children) {
      if (!pageHasDirectValue(pageNode, leafValues, repeats, raw)) {
        continue;
      }
      const inner: string[] = [];
      for (const c of pageNode.children) {
        const r = renderNode(c, idByName, leafValues, repeats, raw);
        if (r !== null) {
          inner.push(r);
        }
      }
      if (inner.length === 0) {
        continue;
      }
      const p = pageNumberOf(pageNode.tag);
      pages.push(`<${pageNode.tag} page="${p}">${inner.join('')}</${pageNode.tag}>`);
    }
    if (pages.length === 0) {
      return null;
    }
    bodyXml = pages.join('');
  } else {
    // 単頁様式：子要素をページラッパ無しでそのまま様式ルート直下に描画する。
    const inner: string[] = [];
    for (const c of formRoot.children) {
      const r = renderNode(c, idByName, leafValues, repeats, raw);
      if (r !== null) {
        inner.push(r);
      }
    }
    if (inner.length === 0) {
      return null;
    }
    bodyXml = inner.join('');
  }
  const id = formInstanceId(formId);
  // 属性順は参照ファイル準拠：VR id page sakuseiDay sakuseiNM softNM
  const open =
    `<${formId} VR="${schema.meta.version}" id="${id}" page="1"` +
    ` sakuseiDay="${attrs.sakuseiDay}"` +
    ` sakuseiNM="${escapeXml(attrs.sakuseiNM)}"` +
    ` softNM="${escapeXml(attrs.softNM)}">`;
  return { formId, xml: `${open}${bodyXml}</${formId}>` };
}
// CATALOG（RDF マニフェスト）。出力された各様式を FORM_SEC に登録（about="#{様式ID}-1"）。
function renderCatalog(formIds: string[], includeSofusho: boolean): string {
  const formSeq = formIds
    .map((id) => `<rdf:li><rdf:description about="#${formInstanceId(id)}"/></rdf:li>`)
    .join('');
  const sofushoSec = includeSofusho
    ? `<SOFUSHO_SEC><rdf:description about="#${SOFUSHO_ID}"/></SOFUSHO_SEC>`
    : '<SOFUSHO_SEC/>';
  return (
    `<CATALOG id="CATALOG"><rdf:RDF xmlns:rdf="${NS_RDF}"><rdf:description id="REPORT">` +
    '<SEND_DATA/>' +
    '<IT_SEC><rdf:description about="#IT"/></IT_SEC>' +
    `<FORM_SEC><rdf:Seq>${formSeq}</rdf:Seq></FORM_SEC>` +
    '<TENPU_SEC/><XBRL_SEC/><XBRL2_1_SEC/>' +
    sofushoSec +
    '<ATTACH_SEC/><CSV_SEC/>' +
    '</rdf:description></rdf:RDF></CATALOG>'
  );
}

function resolveFormAttrs(options: XtxDocumentOptions): FormAttrs {
  return {
    softNM: options.softwareName ?? 'aoiko',
    sakuseiNM: options.creatorName ?? 'aoiko',
    sakuseiDay: options.creationDate ?? todayISO(),
  };
}
// 参照側（帳票個別部分）のみを返す。実 XSD validation 用に様式サブツリーを
// 単体で取り出すために公開する（IT部・エンベロープは含めない）。
export function buildFormFragment(
  schema: XtxSchema,
  values: XtxValues,
  options: XtxDocumentOptions = {},
  leafValues: XtxLeafValues = {},
  repeats: XtxRepeatedValues = {},
  raw: XtxRawValues = {}
): string {
  const procedureTag = options.procedureTag ?? DEFAULT_PROCEDURE_TAG;
  const procedureName = options.procedureName ?? DEFAULT_PROCEDURE_NAME;
  const { idByName } = buildItPart(
    schema,
    values,
    procedureTag,
    procedureName,
    options.filer ?? {},
    options.shinkokuKbn ?? '1'
  );
  const r = renderForm(schema, idByName, leafValues, resolveFormAttrs(options), repeats, raw);
  return r ? r.xml : '<!-- 参照側：出力対象データなし -->';
}

export function buildXtxDocument(
  schema: XtxSchema,
  values: XtxValues,
  options: XtxDocumentOptions = {},
  leafValues: XtxLeafValues = {}
): string {
  return buildXtxBundle([{ schema, values, leafValues }], options);
}
/** 1 エンベロープに併載する 1 様式分の入力 */
export interface XtxFormInput {
  schema: XtxSchema;
  /** 定義側（IT部 IDREF）値：定義名→値 */
  values: XtxValues;
  /** 直接値 leaf：leaf tag→値 */
  leafValues?: XtxLeafValues;
  /** 繰り返しブロック（maxOccurs>1）の値：ブランチ tag→エントリ配列 */
  repeats?: XtxRepeatedValues;
  /** 区分（kubun）型ブランチの生 XML 上書き：ブランチ tag→内側の生 XML */
  raw?: XtxRawValues;
}
// 複数様式を 1 つの送信データ（DATA > 手続ID > CONTENTS）に併載する。
// IT部は全様式の定義側値を統合して 1 回だけ出力（ITdefinition カタログは全所得税
// 様式で共通）。各様式の参照側を順に出力し、CATALOG・送信票を付して封包する。
export function buildXtxBundle(
  forms: XtxFormInput[],
  options: XtxDocumentOptions = {}
): string {
  const procedureTag = options.procedureTag ?? DEFAULT_PROCEDURE_TAG;
  const procedureVersion = options.procedureVersion ?? DEFAULT_PROCEDURE_VERSION;
  const procedureName = options.procedureName ?? DEFAULT_PROCEDURE_NAME;
  const attrs = resolveFormAttrs(options);
  const catalogSchema = forms[0]?.schema;
  if (!catalogSchema) {
    throw new Error('buildXtxBundle: forms が空です');
  }
  // IT部：全様式の values を統合（同名は後勝ち）。定義カタログは共通なので
  // catalogSchema で採番すれば全様式の IDREF が解決する。
  const mergedValues: XtxValues = {};
  for (const f of forms) {
    Object.assign(mergedValues, f.values);
  }
  const it = buildItPart(
    catalogSchema,
    mergedValues,
    procedureTag,
    procedureName,
    options.filer ?? {},
    options.shinkokuKbn ?? '1'
  );
  const rendered: RenderedForm[] = [];
  for (const f of forms) {
    const r = renderForm(f.schema, it.idByName, f.leafValues ?? {}, attrs, f.repeats ?? {}, f.raw ?? {});
    if (r) {
      rendered.push(r);
    }
  }
  const includeSofusho = options.includeSofusho ?? true;
  const catalog = renderCatalog(
    rendered.map((r) => r.formId),
    includeSofusho
  );
  const sofusho = includeSofusho
    ? `<SOFUSHO VR="${SOFUSHO_VR}" fid="${SOFUSHO_FID}" id="${SOFUSHO_ID}" page="1"` +
      ` sakuseiDay="${attrs.sakuseiDay}"` +
      ` sakuseiNM="${escapeXml(attrs.sakuseiNM)}"` +
      ` softNM="${escapeXml(attrs.softNM)}"` +
      ` xmlns="${NS_KYOTSU}"/>`
    : '';
  const defaultNs = catalogSchema.meta.namespace;
  const data =
    `<DATA id="DATA" xmlns="${defaultNs}" xmlns:gen="${NS_GENERAL}"` +
    ` xmlns:kyo="${NS_KYOTSU}" xmlns:xlink="${NS_XLINK}" xmlns:xsi="${NS_XSI}">` +
    `<${procedureTag} VR="${procedureVersion}" id="${procedureTag}">` +
    catalog +
    `<CONTENTS id="CONTENTS">${it.xml}${rendered.map((r) => r.xml).join('')}${sofusho}</CONTENTS>` +
    `</${procedureTag}>` +
    '</DATA>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n${data}`;
}