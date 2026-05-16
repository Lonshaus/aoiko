import { describe, expect, test } from 'vitest';
import { buildXtxDocument, type XtxValues } from './xtx-document';
import koa210 from './xtx-schema-koa210.generated.json';
import koa020 from './xtx-schema-koa020.generated.json';
import type { XtxSchema } from './xtx-schema';

const k210 = koa210 as XtxSchema;
const k020 = koa020 as XtxSchema;

// 定義側カタログから先頭数件にダミー値を入れる
function dummyValues(s: XtxSchema, n: number): XtxValues {
  const v: XtxValues = {};
  for (const d of s.definitions.slice(0, n)) {
    v[d.name] = `val_${d.name}`;
  }
  return v;
}

describe('buildXtxDocument (2 段式 ID/IDREF 文書モデル)', () => {
  test('エンベロープ骨格（DATA/CATALOG/CONTENTS/IT）を持つ', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 5));
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<DATA id="DATA">');
    expect(xml).toContain('<CATALOG id="CATALOG"></CATALOG>');
    expect(xml).toContain('<CONTENTS id="CONTENTS">');
    expect(xml).toContain('<IT VR="1.0" id="IT">');
    expect(xml).toContain('</DATA>');
  });

  test('整形式 XML（パース可能）', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 8));
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  test('定義側：値が入った項目だけ ID 付きで IT 部に出る', () => {
    const xml = buildXtxDocument(k210, { NENBUN: '08', ZEIMUSHO: '渋谷' });
    expect(xml).toMatch(/<NENBUN ID="IT\d+">08<\/NENBUN>/);
    expect(xml).toMatch(/<ZEIMUSHO ID="IT\d+">渋谷<\/ZEIMUSHO>/);
    // 値の無い定義は出ない
    expect(xml).not.toContain('<TEISYUTSU_DAY');
    // ID は定義カタログ順の連番
    expect(xml).toContain('ID="IT1"');
    expect(xml).toContain('ID="IT2"');
  });

  test('参照側 IDREF は必ず定義側の ID に解決する', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 20));
    const ids = new Set(
      [...xml.matchAll(/\sID="(IT\d+)"/g)].map((m) => m[1])
    );
    const idrefs = [...xml.matchAll(/\sIDREF="(IT\d+)"/g)].map((m) => m[1]);
    expect(idrefs.length).toBeGreaterThan(0);
    for (const ref of idrefs) {
      expect(ids.has(ref)).toBe(true);
    }
  });

  test('参照側ルートは様式要素＋VR/id/page 属性', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 10));
    expect(xml).toMatch(/<KOA210 VR="11\.0" id="KOA210" page="1">/);
  });

  test('KOA020 でもエンベロープが組める', () => {
    const xml = buildXtxDocument(k020, { NENBUN: '08' });
    expect(xml).toContain('<DATA id="DATA">');
    expect(xml).toMatch(/<KOA020 VR="23\.0" /);
    expect(xml).toContain('<NENBUN ID="IT1">08</NENBUN>');
  });

  test('XML 特殊文字を定義側でエスケープ', () => {
    const xml = buildXtxDocument(k210, { NENBUN: 'A & B <x>' });
    expect(xml).toContain('<NENBUN ID="IT1">A &amp; B &lt;x&gt;</NENBUN>');
  });

  test('値が空なら参照側にも出力されない（IDREF 整合維持）', () => {
    const xml = buildXtxDocument(k210, {});
    expect(xml).not.toMatch(/\sIDREF=/);
    expect(xml).toContain('<DATA id="DATA">');
  });

  test('手続ID タグは差し替え可能', () => {
    const xml = buildXtxDocument(k210, { NENBUN: '08' }, {
      procedureTag: 'RSH0001',
    });
    expect(xml).toContain('<RSH0001 VR="1.0" id="手続ID">');
  });
});