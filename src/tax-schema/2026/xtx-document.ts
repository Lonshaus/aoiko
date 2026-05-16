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

/** 定義名（例 NENBUN, ZEIMUSHO）→ 値文字列。Sub C/D の mapping が生成する */
export type XtxValues = Record<string, string>;

export interface XtxDocumentOptions {
  /**
   * 手続ID 要素のタグ名（手続コード）。
   * TODO(#50): 所得税確定申告（青色・決算書同梱）の正確な手続コードを
   * e-tax07「手続一覧」で確定する。実申告は Sub E の e-Tax 実機検証まで不可のため
   * 現状はプレースホルダで文書モデルの検証を優先する。
   */
  procedureTag?: string;
  /** 作成ソフト名（gen:FormAttribute softNM、必須）。既定 'aoiko' */
  softwareName?: string;
  /** 作成者名（gen:FormAttribute sakuseiNM、必須）。通常は屋号/事業者名 */
  creatorName?: string;
  /** 作成日（gen:FormAttribute sakuseiDay、必須、xsd:date YYYY-MM-DD） */
  creationDate?: string;
}

const DEFAULT_PROCEDURE_TAG = 'TETSUZUKI_ID_TODO';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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
    sakuseiDay: options.creationDate ?? todayIso(),
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
  const procedureTag = options.procedureTag ?? DEFAULT_PROCEDURE_TAG;
  const { instances, idByName } = buildDefinitionInstances(schema, values);
  const formRoot = buildRefTreeNodes(schema);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<DATA id="DATA">');
  lines.push(`  <${procedureTag} VR="1.0" id="手続ID">`);
  lines.push('    <CATALOG id="CATALOG"></CATALOG>');
  lines.push('    <CONTENTS id="CONTENTS">');
  lines.push(renderItBlock(instances, '      '));
  lines.push(
    renderRefSide(
      formRoot,
      schema,
      idByName,
      leafValues,
      '      ',
      resolveFormAttrs(options)
    )
  );
  lines.push('    </CONTENTS>');
  lines.push(`  </${procedureTag}>`);
  lines.push('</DATA>');
  return lines.join('\n');
}