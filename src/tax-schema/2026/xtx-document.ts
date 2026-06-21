// e-Tax .xtx 2 段式 ID/IDREF 文書モデルの核。
//
// 入力：様式 schema（xtx-schema-*.generated.json）+ 値マップ（定義名→値）
// 出力：エンベロープ付き .xtx XML 文字列
//
// 構造（e-tax01「データ形式仕様」図1-3 より）：
//   <DATA id="DATA">                       手続部分（root）
//     <{手続ID} VR="1.0" id="手続ID">        手続ID 要素
//       <CATALOG id="CATALOG"></CATALOG>     管理用部分
//       <CONTENTS id="CONTENTS">             内容部分
//         <IT VR="1.0" id="IT"> … </IT>     ①IT部＝定義側（値＋ID属性）
//         <{様式ID} VR="x.x" id=… page="1"> … </>  ②帳票個別部分＝参照側（IDREF配線）
//       </CONTENTS>
//     </{手続ID}>
//   </DATA>

import type { XtxSchema } from './xtx-schema';
import { todayISO } from '../../lib/date';
/** 定義名（例 NENBUN, ZEIMUSHO）→ 値文字列。Sub C/D の mapping が生成する */
export type XtxValues = Record<string, string>;

export interface XtxDocumentOptions {
  /**
   * 手続ID 要素のタグ名（手続コード）。既定は所得税確定申告（青色・決算書同梱）の
   * `RKO0010`（e-tax07「手続一覧」由来、#22 / #33 で確定）。
   * 他の手続を流用する場合のみ上書きする。
   */
  procedureTag?: string;
  /**
   * 手続ID 要素の VR（手続バージョン）。データ形式等仕様書 表1-1-1：2005 年度以降の
   * 手続は年度バージョンを先頭に付した 3 桁体系（例「25.0.0」）が必須で、旧初期値
   * 「1.0」は不可。RKO0010 の値は e-tax07「手続一覧」の手続バージョン列より取得する。
   */
  procedureVersion?: string;
  /** 作成ソフト名（gen:FormAttribute softNM、必須）。既定 'aoiko' */
  softwareName?: string;
  /** 作成者名（gen:FormAttribute sakuseiNM、必須）。通常は屋号/事業者名 */
  creatorName?: string;
  /** 作成日（gen:FormAttribute sakuseiDay、必須、xsd:date YYYY-MM-DD） */
  creationDate?: string;
}
// e-tax07「01手続一覧」Ver250x より：所得税及び復興特別所得税申告。
// 確定申告書(KOA020)+青色申告決算書(KOA210) はこの手続で送信する。
const DEFAULT_PROCEDURE_TAG = 'RKO0010';
// RKO0010 の手続バージョン。e-tax07「手続一覧」Ver250x で RKO0010＝25.0.0
// （様式 KOA020＝23.0 と対）。データ形式等仕様書の 3 桁年度バージョン体系に従う。
const DEFAULT_PROCEDURE_VERSION = '25.0.0';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface DefInstance {
  id: string;
  name: string;
  value: string;
}
// 定義側：値が与えられた定義項目を出力。
// xsd:ID は定義名そのもの（ITreference.xsd の *ref 型は IDREF を
// fixed="<定義名>" で固定しているため、参照側 IDREF＝定義名＝定義側 ID）。
function buildDefinitionInstances(
  schema: XtxSchema,
  values: XtxValues
): { instances: DefInstance[]; idByName: Map<string, string> } {
  const instances: DefInstance[] = [];
  const idByName = new Map<string, string>();
  for (const def of schema.definitions) {
    const v = values[def.name];
    if (v === undefined || v === '') {
      continue;
    }
    const id = def.name;
    instances.push({ id, name: def.name, value: v });
    idByName.set(def.name, id);
  }
  return { instances, idByName };
}

function renderItBlock(instances: DefInstance[], indent: string): string {
  const lines: string[] = [];
  lines.push(`${indent}<IT VR="1.0" id="IT">`);
  for (const it of instances) {
    lines.push(
      `${indent}  <${it.name} ID="${it.id}">${escapeXml(it.value)}</${it.name}>`
    );
  }
  lines.push(`${indent}</IT>`);
  return lines.join('\n');
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
// 参照側：
//  - leaf.idref 有：対応 IT部 ID があるとき IDREF 空要素を出力（2 段式）
//  - leaf.idref 無：leafValues に値があるとき <TAG>値</TAG> を直接出力
// branch は出力対象の子があるときのみ自身を出力。
// ルート様式要素は gen:FormAttribute（softNM/sakuseiNM/sakuseiDay 必須）+ VR を付与。
function renderRefSide(
  formRoot: RefNode,
  schema: XtxSchema,
  idByName: Map<string, string>,
  leafValues: XtxLeafValues,
  indent: string,
  attrs: FormAttrs
): string {
  function render(node: RefNode, ind: string): string | null {
    if (node.kind === 'leaf') {
      if (node.idref) {
        const id = idByName.get(node.idref);
        return id ? `${ind}<${node.tag} IDREF="${id}"/>` : null;
      }
      const v = leafValues[node.tag];
      if (v === undefined || v === '') {
        return null;
      }
      return `${ind}<${node.tag}>${escapeXml(v)}</${node.tag}>`;
    }
    const inner: string[] = [];
    for (const c of node.children) {
      const r = render(c, ind + '  ');
      if (r !== null) {
        inner.push(r);
      }
    }
    if (inner.length === 0) {
      return null;
    }
    if (node.level === 0) {
      const open =
        `${ind}<${node.tag} VR="${schema.meta.version}"` +
        ` softNM="${escapeXml(attrs.softNM)}"` +
        ` sakuseiNM="${escapeXml(attrs.sakuseiNM)}"` +
        ` sakuseiDay="${attrs.sakuseiDay}" id="${node.tag}" page="1">`;
      return `${open}\n${inner.join('\n')}\n${ind}</${node.tag}>`;
    }
    return `${ind}<${node.tag}>\n${inner.join('\n')}\n${ind}</${node.tag}>`;
  }
  const out = render(formRoot, indent);
  return out ?? `${indent}<!-- 参照側：出力対象データなし -->`;
}

function resolveFormAttrs(options: XtxDocumentOptions): FormAttrs {
  return {
    softNM: options.softwareName ?? 'aoiko',
    sakuseiNM: options.creatorName ?? 'aoiko',
    sakuseiDay: options.creationDate ?? todayISO(),
  };
}
// 参照側（帳票個別部分）のみを返す。実 XSD validation 用に様式サブツリーを
// 単体で取り出すために公開する。
export function buildFormFragment(
  schema: XtxSchema,
  values: XtxValues,
  options: XtxDocumentOptions = {},
  leafValues: XtxLeafValues = {}
): string {
  const { idByName } = buildDefinitionInstances(schema, values);
  const formRoot = buildRefTreeNodes(schema);
  return renderRefSide(
    formRoot,
    schema,
    idByName,
    leafValues,
    '',
    resolveFormAttrs(options)
  );
}

export function buildXtxDocument(
  schema: XtxSchema,
  values: XtxValues,
  options: XtxDocumentOptions = {},
  leafValues: XtxLeafValues = {}
): string {
  return buildXtxBundle(
    [{ schema, values, leafValues }],
    options
  );
}
/** 1 エンベロープに併載する 1 様式分の入力 */
export interface XtxFormInput {
  schema: XtxSchema;
  /** 定義側（IT部 IDREF）値：定義名→値 */
  values: XtxValues;
  /** 直接値 leaf：leaf tag→値 */
  leafValues?: XtxLeafValues;
}
// 複数様式を 1 つの送信データ（DATA > 手続ID > CONTENTS）に併載する。
// IT部は全様式の定義側値を統合して 1 回だけ出力（ITdefinition カタログは
// 全所得税様式で共通）。各様式の参照側（帳票個別部分）を順に出力する。
export function buildXtxBundle(
  forms: XtxFormInput[],
  options: XtxDocumentOptions = {}
): string {
  const procedureTag = options.procedureTag ?? DEFAULT_PROCEDURE_TAG;
  const procedureVersion = options.procedureVersion ?? DEFAULT_PROCEDURE_VERSION;
  const attrs = resolveFormAttrs(options);
  // IT部：全様式の values を統合（同名は後勝ち）。定義カタログは共通なので
  // いずれかの schema で採番すれば全様式の IDREF が解決する。
  const mergedValues: XtxValues = {};
  for (const f of forms) {
    Object.assign(mergedValues, f.values);
  }
  const catalogSchema = forms[0]?.schema;
  if (!catalogSchema) {
    throw new Error('buildXtxBundle: forms が空です');
  }
  const { instances, idByName } = buildDefinitionInstances(
    catalogSchema,
    mergedValues
  );

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<DATA id="DATA">');
  lines.push(`  <${procedureTag} VR="${procedureVersion}" id="手続ID">`);
  lines.push('    <CATALOG id="CATALOG"></CATALOG>');
  lines.push('    <CONTENTS id="CONTENTS">');
  lines.push(renderItBlock(instances, '      '));
  for (const f of forms) {
    const formRoot = buildRefTreeNodes(f.schema);
    lines.push(
      renderRefSide(
        formRoot,
        f.schema,
        idByName,
        f.leafValues ?? {},
        '      ',
        attrs
      )
    );
  }
  lines.push('    </CONTENTS>');
  lines.push(`  </${procedureTag}>`);
  lines.push('</DATA>');
  return lines.join('\n');
}