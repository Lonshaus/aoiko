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
  'shotoku/KOA020-023.xsd': '8de959bacc36112f0ae6972dadc809a9f793dd30da169af98f83ee5c91107d0d',
  'shotoku/KOA210-011.xsd': '806d4a5e3ee8e33ef82ec5904e12088e6c1f9e37ac0eedeb549facecadf60313',
  'shotoku/KOA110-012.xsd': 'cab3142f8ef4e520951010d95220ea9ef32af9c1fba678c78c590e2b6e80da3f',
  'shotoku/KOA220-008.xsd': '7de9fd5faa8437ff5fcd0439564cc534d9388f0d04eb646e47b50f7c55892d78',
  'shotoku/KOA130-009.xsd': 'e52eaa460b0f0d3ae6fc970657a57e1146bfd42dd5138fc532c25651d471ebdc',
  'shohi/SHA020-009.xsd': '977957b3407eb3b1ac0888ae86ac77cb1e2b1bf048ef0b272db98a45e8968d53',
  'shohi/SHB070-001.xsd': '25a603aa463d35803264ed2c55ad39a76146723fd6fa727b1a31a93bb6448fbc',
  'shohi/SHB047-001.xsd': 'db0fb768bd9868a26d2b3ad8639c82c8c68b8a44b964fb845795f78f19719dbe',
  'shohi/SHB067-001.xsd': '43ccd8e2d01e22ca8c705b530aef4787a43752ab2ddcf14cac1075feb9bfe452',
  'shohi/SHA010-010.xsd': '1da04ae0ceaa9608967b0f3dbf6e882bcbfbd1975c48d3e65bc376ac83ca6465',
  'shohi/SHB017-002.xsd': '177ee78a92e30c2434cc862e39a8b7d6c0c456920c1cfca57347a974ff7509c5',
  'shohi/SHB033-002.xsd': '2205915de109a05b86525c27a2e43a131d4730fdf3961b672f8733c022b51713',
  'general/ITdefinition.xsd': 'b48b1afcacfc3623ad33bc0fc1c65ecf01ac9abf6587914bdde2aaaa60c30643',
  'general/ITreference.xsd': '09117f8c211ed60d1b86284da56593da55f1e0405c0bcd74d306ec2178e1c8d4',
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
      fail(`SHA256 mismatch: ${rel}\n expected ${expected}\n actual   ${actual}`);
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

// xsd:simpleContent（例：AutoCalc 属性付き decimal/string 等）を持つ complexType か。
// これは要素の子を持たず、テキスト値＋属性のみ（gen:kingaku 等の単純 leaf と同じ扱いで良い）。
// 判定を誤ると renderNode() が「子の無い branch」として値を握り潰す（例：KOA110 の
// AIM00090 耐用年数、SHB033 の DTD00000 課税売上割合、いずれも実際に発生した不具合）。
function isSimpleContentType(ctype) {
  return Boolean(kid(ctype, 'xsd:simpleContent'));
}

function parseOccurs(attrs) {
  const min = attrs['@_minOccurs'];
  const max = attrs['@_maxOccurs'];
  return {
    minOccurs: min === undefined ? 1 : Number(min),
    maxOccurs: max === undefined ? 1 : max === 'unbounded' ? 'unbounded' : Number(max),
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
      const ctype = types.complex.get(typeRef);
      if (!isSimpleContentType(ctype)) {
        kind = 'branch';
        childCtype = ctype;
      }
    } else if (!typeRef) {
      const inline = kid(elNode, 'xsd:complexType');
      if (inline && !isSimpleContentType(inline)) {
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
      const cc = kid(ctype, 'xsd:complexContent') ?? kid(ctype, 'xsd:simpleContent');
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
    if (tagOf(n) === 'xsd:simpleType' && String(attrsOf(n)['@_name']).endsWith('VRtype')) {
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
  writeFileSync(join(OUT, outFile), JSON.stringify(schemaJson, null, 2) + '\n', 'utf8');
  const leaves = refTree.filter((e) => e.kind === 'leaf').length;
  console.log(
    `[build-xtx-schema] ${outFile}: formId=${meta.formId}` +
      ` ns=${meta.namespace} ver=${meta.version}` +
      ` refTree=${refTree.length}(leaf ${leaves}) defs=${definitions.length}`,
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
    definitions,
  );
  buildForm(
    'shotoku/KOA210-011.xsd',
    'KOA210',
    'xtx-schema-koa210.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shotoku/KOA110-012.xsd',
    'KOA110',
    'xtx-schema-koa110.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shotoku/KOA220-008.xsd',
    'KOA220',
    'xtx-schema-koa220.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shotoku/KOA130-009.xsd',
    'KOA130',
    'xtx-schema-koa130.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shohi/SHA020-009.xsd',
    'SHA020',
    'xtx-schema-sha020.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shohi/SHB070-001.xsd',
    'SHB070',
    'xtx-schema-shb070.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shohi/SHB047-001.xsd',
    'SHB047',
    'xtx-schema-shb047.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shohi/SHB067-001.xsd',
    'SHB067',
    'xtx-schema-shb067.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shohi/SHA010-010.xsd',
    'SHA010',
    'xtx-schema-sha010.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shohi/SHB017-002.xsd',
    'SHB017',
    'xtx-schema-shb017.generated.json',
    idrefMap,
    definitions,
  );
  buildForm(
    'shohi/SHB033-002.xsd',
    'SHB033',
    'xtx-schema-shb033.generated.json',
    idrefMap,
    definitions,
  );
}

main();
