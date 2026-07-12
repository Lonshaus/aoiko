import { describe, expect, test } from 'vitest';
import {
  buildFormFragment,
  buildXtxDocument,
  toYymmdd,
  type XtxLeafValues,
  type XtxValues,
} from './xtx-document';
import koa210 from './xtx-schema-koa210.generated.json';
import koa020 from './xtx-schema-koa020.generated.json';
import koa110 from './xtx-schema-koa110.generated.json';
import sha020 from './xtx-schema-sha020.generated.json';
import type { XtxSchema } from './xtx-schema';

const k210 = koa210 as XtxSchema;
const k020 = koa020 as XtxSchema;
const k110 = koa110 as XtxSchema;
const s020 = sha020 as XtxSchema;
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
    expect(xml).toContain('<DATA id="DATA" xmlns="http://xml.e-tax.nta.go.jp/XSD/shotoku"');
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
    const xml = buildXtxDocument(k210, { NOZEISHA_YAGO: '青井商店' });
    expect(xml).toContain('<NOZEISHA_YAGO ID="NOZEISHA_YAGO">青井商店</NOZEISHA_YAGO>');
    // 値の無い定義は出ない
    expect(xml).not.toContain('<TEISYUTSU_DAY');
  });

  test('申告者情報(filer)から ZEIMUSHO(複合)・NOZEISHA_ID/NM/ADR が IT部に出る', () => {
    const xml = buildXtxDocument(
      k210,
      {},
      {
        filer: {
          zeimushoCode: '01101',
          zeimushoName: '麹町',
          riyoshaId: '1234567890123456',
          name: '青井 太郎',
          zip: '1800001',
          address: '東京都武蔵野市〇〇1-2-3',
        },
      },
    );
    expect(xml).toContain(
      '<ZEIMUSHO ID="ZEIMUSHO"><gen:zeimusho_CD>01101</gen:zeimusho_CD><gen:zeimusho_NM>麹町</gen:zeimusho_NM></ZEIMUSHO>',
    );
    expect(xml).toContain('<NOZEISHA_ID ID="NOZEISHA_ID">1234567890123456</NOZEISHA_ID>');
    expect(xml).toContain('<NOZEISHA_NM ID="NOZEISHA_NM">青井 太郎</NOZEISHA_NM>');
    expect(xml).toContain(
      '<NOZEISHA_ZIP ID="NOZEISHA_ZIP"><gen:zip1>180</gen:zip1><gen:zip2>0001</gen:zip2></NOZEISHA_ZIP>',
    );
    expect(xml).toContain('<NOZEISHA_ADR ID="NOZEISHA_ADR">東京都武蔵野市〇〇1-2-3</NOZEISHA_ADR>');
  });

  test('NENBUN は IT部で複合型 <gen:era>5</gen:era><gen:yy> として出る', () => {
    const xml = buildXtxDocument(k210, { NENBUN: '08' });
    expect(xml).toContain('<NENBUN ID="NENBUN"><gen:era>5</gen:era><gen:yy>08</gen:yy></NENBUN>');
  });

  test('IT部に手続(TETSUZUKI)・申告区分(SHINKOKU_KBN)が構造項目として常に出る', () => {
    const xml = buildXtxDocument(k210, {});
    expect(xml).toContain(
      '<TETSUZUKI ID="TETSUZUKI"><procedure_CD>RKO0010</procedure_CD><procedure_NM>所得税及び復興特別所得税申告</procedure_NM></TETSUZUKI>',
    );
    expect(xml).toContain('<SHINKOKU_KBN ID="SHINKOKU_KBN"><kubun_CD>1</kubun_CD></SHINKOKU_KBN>');
  });

  test('options.shinkokuKbn で申告区分を上書きできる（消費税の中間申告＝2）', () => {
    const xml = buildXtxDocument(k210, {}, { shinkokuKbn: '2' });
    expect(xml).toContain('<SHINKOKU_KBN ID="SHINKOKU_KBN"><kubun_CD>2</kubun_CD></SHINKOKU_KBN>');
  });

  test('toYymmdd は西暦を令和の era/yy/mm/dd 複合型に変換する', () => {
    expect(toYymmdd('2026-06-30')).toBe(
      '<gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>6</gen:mm><gen:dd>30</gen:dd>',
    );
    expect(toYymmdd('2027-01-01')).toBe(
      '<gen:era>5</gen:era><gen:yy>9</gen:yy><gen:mm>1</gen:mm><gen:dd>1</gen:dd>',
    );
  });

  test('参照側 IDREF は必ず定義側の ID（定義名）に解決する', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 20), {}, firstPageLeaf(k210));
    const ids = new Set([...xml.matchAll(/\sID="([A-Z_0-9]+)"/g)].map((m) => m[1]));
    const idrefs = [...xml.matchAll(/\sIDREF="([A-Z_0-9]+)"/g)].map((m) => m[1]);
    expect(idrefs.length).toBeGreaterThan(0);
    for (const ref of idrefs) {
      expect(ids.has(ref)).toBe(true);
    }
  });

  test('参照側ルートは様式インスタンスID(KOA210-1)＋page＋FormAttribute（参照ファイル順）', () => {
    const xml = buildXtxDocument(
      k210,
      dummyValues(k210, 10),
      { creatorName: '青井事務所', creationDate: '2026-05-13' },
      firstPageLeaf(k210),
    );
    expect(xml).toMatch(
      /<KOA210 VR="11\.0" id="KOA210-1" page="1" sakuseiDay="2026-05-13" sakuseiNM="青井事務所" softNM="aoiko">/,
    );
    // ページ子要素は page 属性を持つ
    expect(xml).toContain('<KOA210-1 page="1">');
  });

  test('CATALOG FORM_SEC に出力様式が登録される（about="#KOA210-1"）', () => {
    const xml = buildXtxDocument(k210, dummyValues(k210, 10), {}, firstPageLeaf(k210));
    expect(xml).toContain(
      '<FORM_SEC><rdf:Seq><rdf:li><rdf:description about="#KOA210-1"/></rdf:li></rdf:Seq></FORM_SEC>',
    );
  });

  test('KOA020 でもエンベロープが組める', () => {
    const xml = buildXtxDocument(k020, { NENBUN: '08' }, {}, firstPageLeaf(k020));
    expect(xml).toContain('<DATA id="DATA"');
    expect(xml).toMatch(/<KOA020 VR="23\.0" id="KOA020-1" page="1"/);
    expect(xml).toContain('<NENBUN ID="NENBUN"><gen:era>5</gen:era><gen:yy>08</gen:yy></NENBUN>');
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
    const xml = buildXtxDocument(
      k210,
      { NENBUN: '08' },
      {
        procedureTag: 'RSH0001',
        procedureVersion: '12.0.0',
      },
    );
    expect(xml).toContain('<RSH0001 VR="12.0.0" id="RSH0001">');
  });

  test('手続バージョンの既定は 25.0.0（RKO0010・令和8年分）', () => {
    const xml = buildXtxDocument(k210, { NENBUN: '08' });
    expect(xml).toContain('<RKO0010 VR="25.0.0" id="RKO0010">');
  });
});

describe('繰り返しブロック（repeats、KOA110 AIM00010 減価償却資産明細）', () => {
  test('エントリ数だけ <AIM00010> を並べて出力する', () => {
    const frag = buildFormFragment(
      k110,
      {},
      {},
      {},
      {
        AIM00010: [
          { AIM00020: '資産A', AIM00060: '150000' },
          { AIM00020: '資産B', AIM00060: '180000' },
        ],
      },
    );
    expect(frag.match(/<AIM00010>/g)).toHaveLength(2);
    expect(frag).toContain('<AIM00020>資産A</AIM00020>');
    expect(frag).toContain('<AIM00060>150000</AIM00060>');
    expect(frag).toContain('<AIM00020>資産B</AIM00020>');
    expect(frag).toContain('<AIM00060>180000</AIM00060>');
  });

  test('各エントリの leafValues は独立（他エントリの値が混ざらない）', () => {
    const frag = buildFormFragment(
      k110,
      {},
      {},
      {},
      {
        AIM00010: [{ AIM00020: '資産A' }, { AIM00060: '99999' }],
      },
    );
    // 1件目は AIM00020 のみ、2件目は AIM00060 のみ持つ
    expect(frag).toContain('<AIM00010><AIM00020>資産A</AIM00020></AIM00010>');
    expect(frag).toContain('<AIM00010><AIM00060>99999</AIM00060></AIM00010>');
  });

  test('エントリが空配列/未指定なら出力されない', () => {
    const frag = buildFormFragment(k110, {}, {}, {}, { AIM00010: [] });
    expect(frag).not.toContain('AIM00010');
    const frag2 = buildFormFragment(k110, {}, {}, {}, {});
    expect(frag2).not.toContain('AIM00010');
  });

  test('中身が空のエントリ（全フィールド空文字）はそのエントリだけ省く', () => {
    const frag = buildFormFragment(k110, {}, {}, {}, { AIM00010: [{ AIM00020: '資産A' }, {}] });
    expect(frag.match(/<AIM00010>/g)).toHaveLength(1);
  });

  test('繰り返しのみのページも「実質データ有り」として出力される', () => {
    const frag = buildFormFragment(k110, {}, {}, {}, { AIM00010: [{ AIM00020: '資産A' }] });
    expect(frag).toMatch(/<KOA110-2 page="2">/);
  });
});

describe('区分（kubun）ブランチの生 XML 上書き（raw、SHA020 ABY00000 2割特例）', () => {
  test('raw で指定したブランチは内側の生 XML がそのまま出力される', () => {
    const frag = buildFormFragment(s020, {}, {}, {}, {}, { ABY00000: '<kubun_CD>1</kubun_CD>' });
    expect(frag).toContain('<ABY00000><kubun_CD>1</kubun_CD></ABY00000>');
  });

  test('raw が空文字ならブランチ自体を出力しない', () => {
    const frag = buildFormFragment(s020, {}, {}, {}, {}, { ABY00000: '' });
    expect(frag).not.toContain('ABY00000');
  });

  test('raw のみのページも「実質データ有り」として出力される', () => {
    const frag = buildFormFragment(s020, {}, {}, {}, {}, { ABY00000: '<kubun_CD>1</kubun_CD>' });
    expect(frag).toMatch(/<SHA020-1 page="1">/);
  });
});
