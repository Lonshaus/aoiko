import { describe, expect, test } from 'vitest';
import { buildXtx2026, personalDeductionsToCtx, type XtxContext } from './xtx';
import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';
import type { PersonalDeductionInput } from '../../db/types';

function makeCtx(): XtxContext {
  const monthly: MonthlyReport = {
    year: 2026,
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      sales: '0',
      expense: '0',
      purchases: '0',
    })),
    totalSales: '0',
    totalExpense: '0',
  };
  const pl: PLReport = {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: '0',
    totalExpense: '0',
    netIncome: '0',
    entryCount: 0,
  };
  const bs: BSReport = {
    year: 2026,
    asOf: '2026-12-31',
    assets: [],
    liabilities: [],
    equity: [],
    netIncome: '0',
    totalAssets: '0',
    totalLiabilitiesAndEquity: '0',
    balanced: true,
  };
  return {
    year: 2026,
    businessName: 'aoikoウェブ事務所',
    invoiceNumber: 'T1234567890123',
    monthly,
    pl,
    bs,
    filer: {
      riyoshaId: '1234567890123456',
      name: '青井 太郎',
      zip: '1800001',
      address: '東京都武蔵野市〇〇1-2-3',
      zeimushoCode: '01101',
      zeimushoName: '麹町',
    },
    filingType: 'blue',
    aoiroDeductionKind: 'electronic',
    fixedAssets: [],
  };
}

describe('buildXtx2026 (KOA020+KOA210 併載 / 2 段式モデル駆動)', () => {
  test('エンベロープ骨格を持つ（手続 RKO0010）', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toMatch(/^<\?xml version="1\.0" encoding="UTF-8" standalone="no" \?>/);
    expect(x).toContain(
      '<DATA id="DATA" xmlns="http://xml.e-tax.nta.go.jp/XSD/shotoku"'
    );
    expect(x).toContain('<RKO0010 VR="25.0.0" id="RKO0010">');
    expect(x).toContain('<CONTENTS id="CONTENTS">');
    expect(x).toContain('<IT VR="1.5" id="IT">');
  });

  test('封包に CATALOG(RDF)・送信票 SOFUSHO・名前空間が揃う（参照ファイル準拠）', () => {
    const x = buildXtx2026(makeCtx());
    // DATA の 5 名前空間
    expect(x).toContain('xmlns:gen="http://xml.e-tax.nta.go.jp/XSD/general"');
    expect(x).toContain('xmlns:kyo="http://xml.e-tax.nta.go.jp/XSD/kyotsu"');
    expect(x).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(x).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    // CATALOG は RDF マニフェスト（空ではない）
    expect(x).toContain('<CATALOG id="CATALOG"><rdf:RDF');
    expect(x).toContain('<IT_SEC><rdf:description about="#IT"/></IT_SEC>');
    expect(x).toContain('<rdf:description about="#KOA020-1"/>');
    expect(x).toContain('<rdf:description about="#KOA210-1"/>');
    expect(x).toContain('<SOFUSHO_SEC><rdf:description about="#TEA060-1"/></SOFUSHO_SEC>');
    // 送信票 SOFUSHO（kyotsu ns で自閉）
    expect(x).toMatch(
      /<SOFUSHO VR="15\.0" fid="TEA060" id="TEA060-1" page="1" [^>]*xmlns="http:\/\/xml\.e-tax\.nta\.go\.jp\/XSD\/kyotsu"\/>/
    );
    // IT部 構造項目（手続・申告区分）
    expect(x).toContain(
      '<TETSUZUKI ID="TETSUZUKI"><procedure_CD>RKO0010</procedure_CD><procedure_NM>所得税及び復興特別所得税申告</procedure_NM></TETSUZUKI>'
    );
    expect(x).toContain('<SHINKOKU_KBN ID="SHINKOKU_KBN"><kubun_CD>1</kubun_CD></SHINKOKU_KBN>');
  });

  test('1 エンベロープに申告書 KOA020 と決算書 KOA210 を併載', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toMatch(/<KOA020 VR="23\.0"/);
    expect(x).toMatch(/<KOA210 VR="11\.0"/);
    // CONTENTS / IT部 は 1 つだけ
    expect(x.match(/<CONTENTS id="CONTENTS">/g)).toHaveLength(1);
    expect(x.match(/<IT VR="1\.5" id="IT">/g)).toHaveLength(1);
  });

  test('年分が令和（2026→8）で定義側 NENBUN が複合型で入る', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toContain(
      '<NENBUN ID="NENBUN"><gen:era>5</gen:era><gen:yy>8</gen:yy></NENBUN>'
    );
  });

  test('屋号が businessName から NOZEISHA_YAGO に入る', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toContain(
      '<NOZEISHA_YAGO ID="NOZEISHA_YAGO">aoikoウェブ事務所</NOZEISHA_YAGO>'
    );
  });

  test('参照側ルートは様式インスタンスID＋page＋FormAttribute（参照ファイル順）', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toMatch(
      /<KOA020 VR="23\.0" id="KOA020-1" page="1" sakuseiDay="\d{4}-\d{2}-\d{2}" sakuseiNM="aoikoウェブ事務所" softNM="aoiko">/
    );
    // ページ子要素は page 属性を持つ
    expect(x).toContain('<KOA020-1 page="1">');
    expect(x).toContain('<KOA210-1 page="1">');
  });

  test('参照側 IDREF が定義側 ID に解決する', () => {
    const x = buildXtx2026(makeCtx());
    const ids = new Set(
      [...x.matchAll(/\sID="([A-Z_0-9]+)"/g)].map((m) => m[1])
    );
    const idrefs = [...x.matchAll(/\sIDREF="([A-Z_0-9]+)"/g)].map(
      (m) => m[1]
    );
    expect(idrefs.length).toBeGreaterThan(0);
    for (const r of idrefs) {
      expect(ids.has(r)).toBe(true);
    }
  });

  test('申告者情報が IT部の必須項目（税務署・利用者識別番号・氏名・住所）に入る', () => {
    const x = buildXtx2026(makeCtx());
    expect(x).toContain(
      '<ZEIMUSHO ID="ZEIMUSHO"><gen:zeimusho_CD>01101</gen:zeimusho_CD><gen:zeimusho_NM>麹町</gen:zeimusho_NM></ZEIMUSHO>'
    );
    expect(x).toContain('<NOZEISHA_ID ID="NOZEISHA_ID">1234567890123456</NOZEISHA_ID>');
    expect(x).toContain('<NOZEISHA_NM ID="NOZEISHA_NM">青井 太郎</NOZEISHA_NM>');
    expect(x).toContain('<NOZEISHA_ADR ID="NOZEISHA_ADR">東京都武蔵野市〇〇1-2-3</NOZEISHA_ADR>');
  });

  test('青色控除区分から事業所得（控除後）と青色申告特別控除額が第一表に入る', () => {
    const ctx = makeCtx();
    ctx.pl = { ...ctx.pl, totalRevenue: '5000000', netIncome: '5000000' };
    ctx.aoiroDeductionKind = 'electronic';
    const x = buildXtx2026(ctx);
    // 営業等収入=500万・青色控除=65万・事業所得=435万
    expect(x).toContain('>5000000<');
    expect(x).toContain('>650000<');
    expect(x).toContain('>4350000<');
  });

  test('整形式 XML（パース可能）', () => {
    const x = buildXtx2026(makeCtx());
    const doc = new DOMParser().parseFromString(x, 'text/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  test('XML 特殊文字をエスケープ', () => {
    const ctx = makeCtx();
    ctx.businessName = 'A & B <Co>';
    const x = buildXtx2026(ctx);
    expect(x).toContain(
      '<NOZEISHA_YAGO ID="NOZEISHA_YAGO">A &amp; B &lt;Co&gt;</NOZEISHA_YAGO>'
    );
  });

  test('屋号未設定なら NOZEISHA_YAGO は出力されない', () => {
    const ctx = makeCtx();
    ctx.businessName = '';
    const x = buildXtx2026(ctx);
    expect(x).not.toContain('NOZEISHA_YAGO');
  });
});

describe('buildXtx2026（filingType: white → KOA020+KOA110 併載）', () => {
  test('1 エンベロープに申告書 KOA020 と収支内訳書 KOA110 を併載（KOA210 は含まない）', () => {
    const ctx = makeCtx();
    ctx.filingType = 'white';
    const x = buildXtx2026(ctx);
    expect(x).toMatch(/<KOA020 VR="23\.0"/);
    expect(x).toMatch(/<KOA110 VR="12\.0"/);
    expect(x).not.toContain('<KOA210 ');
  });

  test('白色申告は青色申告特別控除額を出力せず、事業所得＝収入−経費計そのまま', () => {
    const ctx = makeCtx();
    ctx.filingType = 'white';
    ctx.pl = { ...ctx.pl, totalRevenue: '5000000', totalExpense: '1000000', netIncome: '4000000' };
    const x = buildXtx2026(ctx);
    // 事業所得（控除無し）＝400万。青色申告特別控除額（65万）は出ない
    expect(x).toContain('>4000000<');
    expect(x).not.toContain('>650000<');
  });
});

describe('personalDeductionsToCtx（issue #183: 空文字・全角数字が throw せず 0 扱い）', () => {
  function makeStored(): Omit<PersonalDeductionInput, 'year' | 'updatedAt'> {
    return {
      socialInsurancePaid: '',
      smallBusinessMutualAidPaid: '  ',
      lifeInsurance: { newGeneral: '１２３４' },
      earthquakeInsurancePaid: '',
      oldLongTermInsurancePaid: '',
      medicalExpensePaid: '',
      medicalInsuranceReimbursement: '',
      donationAmount: '',
      casualtyLossDeduction: '',
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      spouse: { totalIncome: '', age: 40 },
      dependents: [{ id: '1', age: 20, totalIncome: '' }],
      salaryIncome: { paidAmount: '', withholdingTax: '' },
      miscIncome: { publicPensionAmount: '', otherIncome: '', otherExpenses: '' },
      realEstateIncome: { businessScale: false, landLoanInterestAmount: '' },
    };
  }

  test('空文字・空白・全角数字を含む入力で throw せず 0 として扱われる', () => {
    const ctx = personalDeductionsToCtx(makeStored());
    expect(ctx.socialInsurancePaid.toString()).toBe('0');
    expect(ctx.smallBusinessMutualAidPaid.toString()).toBe('0');
    expect(ctx.lifeInsurance.newGeneral?.toString()).toBe('0');
    expect(ctx.spouse?.totalIncome.toString()).toBe('0');
    expect(ctx.dependents[0]?.totalIncome.toString()).toBe('0');
    expect(ctx.salaryIncome?.paidAmount.toString()).toBe('0');
    expect(ctx.miscIncome?.publicPensionAmount?.toString()).toBe('0');
    expect(ctx.realEstateIncome?.landLoanInterestAmount?.toString()).toBe('0');
  });
});