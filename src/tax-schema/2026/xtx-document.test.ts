import { describe, expect, test } from 'vitest';
import {
  buildXtxDocument,
  type XtxLeafValues,
  type XtxValues,
} from './xtx-document';
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
// 第一ページの最初の直接値 leaf に値を入れる。様式出力はページに直接値が有る場合のみ
// 行われる（ヘッダ IDREF だけのページは出力されない）ため、出力を促すために使う。
function firstPageLeaf(s: XtxSchema): XtxLeafValues {
  let pages = 0;
  let inFirstPage = false;
  for (const e of s.refTree) {
    if (e.level === 1) {
      pages += 1;
      inFirstPage = pages === 1;
      if (pages > 1) {
        break;
      }
    }
    if (inFirstPage && e.kind === 'leaf' && !e.idref) {
      return { [e.tag]: '100' };
    }
  }
  return {};
}

describe('buildXtxDocument (2 段式 ID/IDREF 文書モデル / 参照ファイル準拠)', () => {
  test('エンベロープ骨格（DATA+名前空間/CATALOG(RDF)/CONTENTS/IT/SOFUSHO）を持つ', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 5));
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8" standalone="no" \?>/);
    expect(xml).toContain(
      '<DATA id="DATA" xmlns="http://xml.e-tax.nta.go.jp/XSD/shotoku"'
    );
    expect(xml).toContain('xmlns:gen="http://xml.e-tax.nta.go.jp/XSD/general"');
    expect(xml).toContain('<RKO0010 VR="25.0.0" id="RKO0010">');
    expect(xml).toContain('<CATALOG id="CATALOG"><rdf:RDF');
    expect(xml).toContain('<CONTENTS id="CONTENTS">');
    expect(xml).toContain('<IT VR="1.5" id="IT">');
    expect(xml).toContain('<SOFUSHO VR="15.0" fid="TEA060" id="TEA060-1"');
    expect(xml).toContain('</DATA>');
  });

  test('整形式 XML（名前空間付き・パース可能）', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 8));
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  test('定義側：値が入った項目だけ ID=定義名 付きで IT 部に出る', () => {
    const xml = buildXtxDocument(k210, { ZEIMUSHO: '渋谷' });
    expect(xml).toContain('<ZEIMUSHO ID="ZEIMUSHO">渋谷</ZEIMUSHO>');
    // 値の無い定義は出ない
    expect(xml).not.toContain('<TEISYUTSU_DAY');
  });

  test('NENBUN は IT部で複合型 <gen:era>5</gen:era><gen:yy> として出る', () => {
    const xml = buildXtxDocument(k210, { NENBUN: '08' });
    expect(xml).toContain(
      '<NENBUN ID="NENBUN"><gen:era>5</gen:era><gen:yy>08</gen:yy></NENBUN>'
    );
  });

  test('IT部に手続(TETSUZUKI)・申告区分(SHINKOKU_KBN)が構造項目として常に出る', () => {
    const xml = buildXtxDocument(k210, {});
    expect(xml).toContain(
      '<TETSUZUKI ID="TETSUZUKI"><procedure_CD>RKO0010</procedure_CD><procedure_NM>所得税及び復興特別所得税申告</procedure_NM></TETSUZUKI>'
    );
    expect(xml).toContain('<SHINKOKU_KBN ID="SHINKOKU_KBN"><kubun_CD>1</kubun_CD></SHINKOKU_KBN>');
  });

  test('参照側 IDREF は必ず定義側の ID（定義名）に解決する', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 20), {}, firstPageLeaf(k210));
    const ids = new Set(
      [...xml.matchAll(/\sID="([A-Z_0-9]+)"/g)].map((m) => m[1])
    );
    const idrefs = [...xml.matchAll(/\sIDREF="([A-Z_0-9]+)"/g)].map(
      (m) => m[1]
    );
    expect(idrefs.length).toBeGreaterThan(0);
    for (const ref of idrefs) {
      expect(ids.has(ref)).toBe(true);
    }
  });

  test('参照側ルートは様式インスタンスID(KOA210-1)＋page＋FormAttribute（参照ファイル順）', () => {
    const xml = buildXtxDocument(
      k210,
      dummyValues(k210, 10),
      { creatorName: '青井事務所', creationDate: '2026-05-16' },
      firstPageLeaf(k210)
    );
    expect(xml).toMatch(
      /<KOA210 VR="11\.0" id="KOA210-1" page="1" sakuseiDay="2026-05-16" sakuseiNM="青井事務所" softNM="aoiko">/
    );
    // ページ子要素は page 属性を持つ
    expect(xml).toContain('<KOA210-1 page="1">');
  });

  test('CATALOG FORM_SEC に出力様式が登録される（about="#KOA210-1"）', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 10), {}, firstPageLeaf(k210));
    expect(xml).toContain('<FORM_SEC><rdf:Seq><rdf:li><rdf:description about="#KOA210-1"/></rdf:li></rdf:Seq></FORM_SEC>');
  });

  test('KOA020 でもエンベロープが組める', () => {
    const xml = buildXtxDocument(k020, { NENBUN: '08' }, {}, firstPageLeaf(k020));
    expect(xml).toContain('<DATA id="DATA"');
    expect(xml).toMatch(/<KOA020 VR="23\.0" id="KOA020-1" page="1"/);
    expect(xml).toContain(
      '<NENBUN ID="NENBUN"><gen:era>5</gen:era><gen:yy>08</gen:yy></NENBUN>'
    );
  });

  test('XML 特殊文字を定義側でエスケープ（NENBUN 複合型内）', () => {
    const xml = buildXtxDocument(k210, { NENBUN: 'A & B <x>' });
    expect(xml).toContain('<gen:yy>A &amp; B &lt;x&gt;</gen:yy>');
  });

  test('参照側に出力対象データが無ければその様式は出力されない', () => {
    const xml = buildXtxDocument(k210, {});
    expect(xml).not.toMatch(/<KOA210 VR=/);
    expect(xml).toContain('<DATA id="DATA"');
  });

  test('手続ID タグ・手続バージョンは差し替え可能', () => {
    const xml = buildXtxDocument(k210, { NENBUN: '08' }, {
      procedureTag: 'RSH0001',
      procedureVersion: '12.0.0',
    });
    expect(xml).toContain('<RSH0001 VR="12.0.0" id="RSH0001">');
  });

  test('手続バージョンの既定は 25.0.0（RKO0010・令和8年分）', () => {
    const xml = buildXtxDocument(k210, { NENBUN: '08' });
    expect(xml).toContain('<RKO0010 VR="25.0.0" id="RKO0010">');
  });
});