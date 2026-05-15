#!/usr/bin/env node
// 国税庁 e-Tax 仕様書 xlsx を読んで、xtx 出力用の構造化 JSON を生成する。
// 入力：docs/xtx-spec/ver23-shotoku-shinkokusho.xlsx
// 出力：src/tax-schema/2026/xtx-schema.generated.json
//
// xlsx は ZIP コンテナで、中身は OOXML（sharedStrings.xml + worksheets/sheet1.xml）。
// 重い依存を避けるため、unzip(1) でファイル抽出 → 正規表現で XML をパースする方式。

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const XLSX_PATH = join(ROOT, 'docs/xtx-spec/ver23-shotoku-shinkokusho.xlsx');
const README_PATH = join(ROOT, 'docs/xtx-spec/README.md');
const OUT_PATH = join(ROOT, 'src/tax-schema/2026/xtx-schema.generated.json');

const EXPECTED_SHA256 =
  'e3869b75f49e7999f59aeee241ba3d44bb65283ca62bdfdeca30aa58991e5b51';

function fail(msg) {
  console.error(`[build-xtx-schema] ${msg}`);
  process.exit(1);
}

function unzipEntry(xlsxPath, entry) {
  const r = spawnSync('unzip', ['-p', xlsxPath, entry], { encoding: 'utf8' });
  if (r.status !== 0) {
    fail(`unzip -p failed: ${r.stderr}`);
  }
  return r.stdout;
}

function parseSharedStrings(xml) {
  const strings = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1];
    const texts = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) =>
      decodeXmlText(x[1])
    );
    strings.push(texts.join(''));
  }
  return strings;
}

function decodeXmlText(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function colLetterToIndex(letters) {
  let n = 0;
  for (const c of letters) {
    n = n * 26 + (c.charCodeAt(0) - 64);
  }
  return n;
}

function parseSheet(xml, strings) {
  const rows = new Map();
  const rowRe = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rNum = Number(rm[1]);
    const inner = rm[2];
    const cells = new Map();
    const cellRe =
      /<c\b[^>]*r="([A-Z]+)\d+"([^/>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(inner)) !== null) {
      const colRef = cm[1];
      const attrs = cm[2] ?? '';
      const body = cm[3] ?? '';
      const colIdx = colLetterToIndex(colRef);
      const isShared = /\bt="s"/.test(attrs);
      const isInline = /\bt="inlineStr"/.test(attrs);
      let val = '';
      if (isInline) {
        const tm = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (tm) {
          val = decodeXmlText(tm[1]);
        }
      } else {
        const vm = body.match(/<v>([\s\S]*?)<\/v>/);
        if (vm) {
          const raw = vm[1];
          if (isShared) {
            const idx = Number(raw);
            val = strings[idx] ?? '';
          } else {
            val = raw;
          }
        }
      }
      if (val !== '') {
        cells.set(colIdx, val);
      }
    }
    rows.set(rNum, cells);
  }
  return rows;
}

function pickJa(row) {
  for (let c = 3; c <= 12; c++) {
    const v = row.get(c);
    if (v) {
      return { ja: v, level: c };
    }
  }
  return { ja: '', level: 0 };
}

function parseMaxOccurs(raw) {
  if (!raw) {
    return 1;
  }
  if (raw === 'unbounded') {
    return 'unbounded';
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function buildSchema() {
  if (!existsSync(XLSX_PATH)) {
    fail(`xlsx not found: ${XLSX_PATH}`);
  }
  const buf = readFileSync(XLSX_PATH);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== EXPECTED_SHA256) {
    fail(
      `SHA256 mismatch.\n  expected: ${EXPECTED_SHA256}\n  actual:   ${sha}\n→ docs/xtx-spec/README.md と整合させてください`
    );
  }
  const ssXml = unzipEntry(XLSX_PATH, 'xl/sharedStrings.xml');
  const sheetXml = unzipEntry(XLSX_PATH, 'xl/worksheets/sheet1.xml');
  const strings = parseSharedStrings(ssXml);
  const rows = parseSheet(sheetXml, strings);

  const sheetMeta = rows.get(2);
  if (!sheetMeta) {
    fail('row 2 (sheet metadata) not found');
  }
  const formDesc = (sheetMeta.get(1) ?? '').trim();
  const formId = (sheetMeta.get(12) ?? '').trim() || 'UNKNOWN';
  const namespace = (sheetMeta.get(19) ?? '').trim() || 'UNKNOWN';
  const version = (sheetMeta.get(21) ?? '').trim() || 'UNKNOWN';

  const elements = [];
  const sortedRowNums = [...rows.keys()].sort((a, b) => a - b);
  for (const rNum of sortedRowNums) {
    if (rNum < 5) {
      continue;
    }
    const row = rows.get(rNum);
    const noRaw = row.get(1);
    if (!noRaw) {
      continue;
    }
    const no = Number(noRaw);
    if (!Number.isFinite(no)) {
      continue;
    }
    const levelRaw = row.get(2) ?? '';
    const level = Number(levelRaw);
    if (!Number.isFinite(level)) {
      continue;
    }
    const { ja } = pickJa(row);
    const dataType = (row.get(13) ?? '').trim();
    const minOccurs = Number(row.get(14) ?? '0');
    const maxOccursRaw = (row.get(15) ?? '').trim();
    const idAttr = (row.get(16) ?? '').trim();
    const attrName = (row.get(17) ?? '').trim();
    const extraAttrsRaw = (row.get(18) ?? '').trim();
    const tag = (row.get(19) ?? '').trim();
    const order = (row.get(20) ?? '').trim();
    const note = (row.get(21) ?? '').trim();

    const extraAttrs = extraAttrsRaw
      ? extraAttrsRaw.split(/[\n\r]+/).map((s) => s.trim()).filter(Boolean)
      : [];

    elements.push({
      no,
      level,
      ja,
      tag,
      attrName,
      idAttr: idAttr || undefined,
      extraAttrs,
      dataType,
      minOccurs: Number.isFinite(minOccurs) ? minOccurs : 0,
      maxOccurs: parseMaxOccurs(maxOccursRaw),
      order,
      note,
    });
  }

  const formName = elements[0]?.ja ?? '';

  return {
    meta: {
      formId,
      formName,
      namespace,
      version,
      fetchedAt: '2026-05-14',
    },
    elements,
  };
}

function main() {
  const schema = buildSchema();
  const json = JSON.stringify(schema, null, 2) + '\n';
  writeFileSync(OUT_PATH, json, 'utf8');
  const expectedSha = EXPECTED_SHA256;
  const readmeOk = readFileSync(README_PATH, 'utf8').includes(expectedSha);
  if (!readmeOk) {
    fail('README.md と EXPECTED_SHA256 が整合しません');
  }
  console.log(
    `[build-xtx-schema] wrote ${OUT_PATH}\n  formId=${schema.meta.formId}` +
      ` namespace=${schema.meta.namespace} version=${schema.meta.version}` +
      ` elements=${schema.elements.length}`
  );
}

main();