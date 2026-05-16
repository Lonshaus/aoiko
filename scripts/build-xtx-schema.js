#!/usr/bin/env node
// 国税庁公式 W3C XSD（e-tax19.CAB「XMLスキーマ」由来、docs/xtx-spec/）から
// .xtx 出力用の構造化 JSON を生成する。
//
// 出力（src/tax-schema/2026/）：
//  - xtx-schema-koa020.generated.json … 確定申告書（参照側ツリー + 定義側カタログ）
//  - xtx-schema-koa210.generated.json … 青色申告決算書(一般用)
//
// e-Tax .xtx は 2 段式 ID/IDREF モデル。詳細は src/tax-schema/2026/xtx-schema.ts 参照。

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SPEC = join(ROOT, 'docs/xtx-spec');
const OUT = join(ROOT, 'src/tax-schema/2026');
const FETCHED_AT = '2026-05-16';

const EXPECTED_SHA256 = {
  'shotoku/KOA020-023.xsd':
    '8de959bacc36112f0ae6972dadc809a9f793dd30da169af98f83ee5c91107d0d',
  'shotoku/KOA210-011.xsd':
    '806d4a5e3ee8e33ef82ec5904e12088e6c1f9e37ac0eedeb549facecadf60313',
  'general/ITdefinition.xsd':
    'b48b1afcacfc3623ad33bc0fc1c65ecf01ac9abf6587914bdde2aaaa60c30643',
  'general/ITreference.xsd':
    '09117f8c211ed60d1b86284da56593da55f1e0405c0bcd74d306ec2178e1c8d4',
};

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

function fail(msg) {
  console.error(`[build-xtx-schema] ${msg}`);
  process.exit(1);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function loadXsd(rel) {
  const path = join(SPEC, rel);
  const expected = EXPECTED_SHA256[rel];
  if (expected) {
    const actual = sha256(path);
    if (actual !== expected) {
      fail(
        `SHA256 mismatch: ${rel}\n expected ${expected}\n actual   ${actual}`
      );
    }
  }
  return parser.parse(readFileSync(path, 'utf8'));
}

// preserveOrder ノードヘルパ
function tagOf(node) {
  for (const k of Object.keys(node)) {
    if (k !== ':@') {
      return k;
    }
  }
  return null;
}
const childrenOf = (node) => node[tagOf(node)] ?? [];
const attrsOf = (node) => node[':@'] ?? {};
const kids = (node, tag) => childrenOf(node).filter((c) => tagOf(c) === tag);
const kid = (node, tag) => kids(node, tag)[0];

function textOf(node) {
  for (const c of childrenOf(node)) {
    if (Object.prototype.hasOwnProperty.call(c, '#text')) {
      return String(c['#text']);
    }
  }
  return '';
}

// xsd:annotation/xsd:appinfo のテキスト（前後の引用符・空白を除去）
function appinfoOf(node) {
  const ann = kid(node, 'xsd:annotation');
  if (!ann) {
    return '';
  }
  const ai = kid(ann, 'xsd:appinfo');
  if (!ai) {
    return '';
  }
  return textOf(ai).replace(/^["'\s]+|["'\s]+$/g, '');
}

function schemaRoot(doc) {
  const s = doc.find((n) => tagOf(n) === 'xsd:schema');
  if (!s) {
    fail('xsd:schema 要素が見つかりません');
  }
  return s;
}

// 同一ファイル内の named complexType / simpleType を索引化
function indexTypes(schema) {
  const complex = new Map();
  const simple = new Map();
  for (const n of childrenOf(schema)) {
    const t = tagOf(n);
    const name = attrsOf(n)['@_name'];
    if (!name) {
      continue;
    }
    if (t === 'xsd:complexType') {
      complex.set(name, n);
    } else if (t === 'xsd:simpleType') {
      simple.set(name, n);
    }
  }
  return { complex, simple };
}

// complexType ノードから子 xsd:element 列を取り出す
// （xsd:sequence / xsd:complexContent>xsd:extension>xsd:sequence を吸収）
function sequenceElements(ctype) {
  let seq = kid(ctype, 'xsd:sequence');
  if (!seq) {
    const cc = kid(ctype, 'xsd:complexContent');
    const ext = cc && kid(cc, 'xsd:extension');
    if (ext) {
      seq = kid(ext, 'xsd:sequence');
    }
  }
  if (!seq) {
    return [];
  }
  return kids(seq, 'xsd:element');
}

function parseOccurs(attrs) {
  const min = attrs['@_minOccurs'];
  const max = attrs['@_maxOccurs'];
  return {
    minOccurs: min === undefined ? 1 : Number(min),
    maxOccurs:
      max === undefined ? 1 : max === 'unbounded' ? 'unbounded' : Number(max),
  };
}

// 様式 xsd の参照側ツリーを level でフラット化
function buildRefTree(schema, types, idrefMap) {
  const group = kid(schema, 'xsd:group');
  if (!group) {
    fail('xsd:group（ルート）が見つかりません');
  }
  const gseq = kid(group, 'xsd:sequence');
  const rootEl = kid(gseq, 'xsd:element');
  const out = [];
  let counter = 0;

  function walk(elNode, level) {
    const a = attrsOf(elNode);
    const tag = a['@_name'];
    const occ = parseOccurs(a);
    const ja = appinfoOf(elNode);
    const typeRef = a['@_type'];
    let kind = 'leaf';
    let childCtype = null;

    if (typeRef && !typeRef.includes(':') && types.complex.has(typeRef)) {
      kind = 'branch';
      childCtype = types.complex.get(typeRef);
    } else if (!typeRef) {
      const inline = kid(elNode, 'xsd:complexType');
      if (inline) {
        kind = 'branch';
        childCtype = inline;
      }
    }

    let idref = '';
    let refType = '';
    if (kind === 'leaf') {
      refType = typeRef ?? '';
      const bare = refType.includes(':') ? refType.split(':')[1] : refType;
      idref = idrefMap.get(bare) ?? '';
    }

    out.push({
      no: ++counter,
      level,
      tag,
      ja,
      kind,
      idref,
      refType,
      minOccurs: occ.minOccurs,
      maxOccurs: occ.maxOccurs,
    });

    if (childCtype) {
      for (const child of sequenceElements(childCtype)) {
        walk(child, level + 1);
      }
    }
  }

  walk(rootEl, 0);
  return out;
}

// ITreference.xsd: complexType 名 → IDREF fixed 値（例 NENBUNref → NENBUN）
function buildIdrefMap() {
  const doc = loadXsd('general/ITreference.xsd');
  const schema = schemaRoot(doc);
  const map = new Map();
  for (const n of childrenOf(schema)) {
    if (tagOf(n) !== 'xsd:complexType') {
      continue;
    }
    const name = attrsOf(n)['@_name'];
    if (!name) {
      continue;
    }
    for (const at of kids(n, 'xsd:attribute')) {
      const aa = attrsOf(at);
      if (aa['@_name'] === 'IDREF' && aa['@_fixed']) {
        map.set(name, aa['@_fixed']);
      }
    }
  }
  return map;
}

// ITdefinition.xsd の complexType name="ITtype" → 定義側カタログ
function buildDefinitions() {
  const doc = loadXsd('general/ITdefinition.xsd');
  const schema = schemaRoot(doc);
  const types = indexTypes(schema);
  const itType = types.complex.get('ITtype');
  if (!itType) {
    fail('ITdefinition.xsd に complexType ITtype が見つかりません');
  }
  const defs = [];
  for (const el of sequenceElements(itType)) {
    const a = attrsOf(el);
    const name = a['@_name'];
    if (!name) {
      continue;
    }
    const occ = parseOccurs(a);
    const ja = appinfoOf(el);
    let baseType = '';
    let hasId = false;
    const ctype = kid(el, 'xsd:complexType');
    if (ctype) {
      const cc =
        kid(ctype, 'xsd:complexContent') ?? kid(ctype, 'xsd:simpleContent');
      const ext = cc && kid(cc, 'xsd:extension');
      if (ext) {
        baseType = attrsOf(ext)['@_base'] ?? '';
        for (const at of kids(ext, 'xsd:attribute')) {
          if (attrsOf(at)['@_name'] === 'ID') {
            hasId = true;
          }
        }
      }
      for (const at of kids(ctype, 'xsd:attribute')) {
        if (attrsOf(at)['@_name'] === 'ID') {
          hasId = true;
        }
      }
    } else if (a['@_type']) {
      baseType = a['@_type'];
    }
    defs.push({ name, ja, baseType, hasId, minOccurs: occ.minOccurs });
  }
  return defs;
}

function metaOf(schema, formId, rel) {
  const ns = attrsOf(schema)['@_targetNamespace'] ?? '';
  const ann = kid(schema, 'xsd:annotation');
  const docu = ann && kid(ann, 'xsd:documentation');
  const docText = docu ? textOf(docu) : '';
  const nameLine = docText.split('\n')[0] ?? '';
  const formName = nameLine.replace(/^様式名[:：]\s*/, '').trim();
  let version = '';
  for (const n of childrenOf(schema)) {
    if (
      tagOf(n) === 'xsd:simpleType' &&
      String(attrsOf(n)['@_name']).endsWith('VRtype')
    ) {
      const r = kid(n, 'xsd:restriction');
      const e = r && kid(r, 'xsd:enumeration');
      if (e) {
        version = attrsOf(e)['@_value'] ?? '';
      }
    }
  }
  return {
    formId,
    formName,
    namespace: ns,
    version,
    source: `e-tax19.CAB ${rel}`,
    fetchedAt: FETCHED_AT,
  };
}

function buildForm(rel, formId, outFile, idrefMap, definitions) {
  const doc = loadXsd(rel);
  const schema = schemaRoot(doc);
  const types = indexTypes(schema);
  const refTree = buildRefTree(schema, types, idrefMap);
  const meta = metaOf(schema, formId, rel);
  const schemaJson = { meta, refTree, definitions };
  writeFileSync(
    join(OUT, outFile),
    JSON.stringify(schemaJson, null, 2) + '\n',
    'utf8'
  );
  const leaves = refTree.filter((e) => e.kind === 'leaf').length;
  console.log(
    `[build-xtx-schema] ${outFile}: formId=${meta.formId}` +
      ` ns=${meta.namespace} ver=${meta.version}` +
      ` refTree=${refTree.length}(leaf ${leaves}) defs=${definitions.length}`
  );
}

function main() {
  const idrefMap = buildIdrefMap();
  const definitions = buildDefinitions();
  buildForm(
    'shotoku/KOA020-023.xsd',
    'KOA020',
    'xtx-schema-koa020.generated.json',
    idrefMap,
    definitions
  );
  buildForm(
    'shotoku/KOA210-011.xsd',
    'KOA210',
    'xtx-schema-koa210.generated.json',
    idrefMap,
    definitions
  );
}

main();