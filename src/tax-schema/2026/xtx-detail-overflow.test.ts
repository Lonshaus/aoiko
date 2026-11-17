import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import {
  buildXtx2026,
  xtxDetailOverflow,
  type XtxContext,
  type XtxDetailOverflowItem,
} from './xtx';
import type { XtxLeafValues, XtxRepeatedValues } from './xtx-document';
import { mapKoa020RepeatedValues } from './xtx-mapping-koa020';
import { mapKoa110RepeatedValues } from './xtx-mapping-koa110';
import { mapKoa130RepeatedValues } from './xtx-mapping-koa130';
import { mapKoa210RepeatedValues } from './xtx-mapping-koa210';
import { mapKoa220RepeatedValues } from './xtx-mapping-koa220';
import type { PLReport } from '../../domain/reports';
import type { FixedAsset, PersonalDeductionFamilyEmployee } from '../../db/types';
import type { RealEstateIncomeCtx } from './real-estate-income';

function pl(netIncome: string): PLReport {
  return {
    year: 2026,
    revenue: [],
    expense: [],
    totalRevenue: netIncome,
    totalExpense: '0',
    netIncome,
    entryCount: 0,
  };
}

function personalDeductions(
  realEstateIncome: RealEstateIncomeCtx,
  familyEmployees: PersonalDeductionFamilyEmployee[] = [],
): NonNullable<XtxContext['personalDeductions']> {
  return {
    socialInsurancePaid: D(0),
    smallBusinessMutualAidPaid: D(0),
    lifeInsurance: {},
    earthquakeInsurancePaid: D(0),
    oldLongTermInsurancePaid: D(0),
    medicalExpensePaid: D(0),
    medicalInsuranceReimbursement: D(0),
    donationAmount: D(0),
    casualtyLossDeduction: D(0),
    isDisabled: false,
    isSpecialDisabled: false,
    isSingleParent: false,
    isWidow: false,
    isWorkingStudent: false,
    dependents: [],
    realEstateIncome,
    familyEmployees,
  };
}

function ctx(overrides: Partial<XtxContext> = {}): XtxContext {
  return {
    year: 2026,
    businessName: 'aoikoウェブ事務所',
    invoiceNumber: '',
    monthly: { year: 2026, months: [], totalSales: '0', totalExpense: '0' },
    pl: pl('5000000'),
    bs: {
      year: 2026,
      asOf: '2026-12-31',
      assets: [],
      liabilities: [],
      equity: [],
      netIncome: '0',
      totalAssets: '0',
      totalLiabilitiesAndEquity: '0',
      balanced: true,
    },
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
    ...overrides,
  };
}
// 取得日が name の添字順に並ぶ事業用資産（償却額は 2026 年に必ず出る）
function assets(prefix: string, count: number, overrides: Partial<FixedAsset> = {}): FixedAsset[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    name: `${prefix}${String(i).padStart(2, '0')}`,
    acquisitionDate: `2020-${String(i + 1).padStart(2, '0')}-01`,
    acquisitionCost: '300000',
    usefulLifeYears: 10,
    depreciationMethod: 'straight-line' as const,
    accountCode: '1510',
    ...overrides,
  }));
}

function propertyAssets(prefix: string, count: number): FixedAsset[] {
  return assets(prefix, count).map((a) => ({
    ...a,
    incomeType: 'realEstate' as const,
    realEstateDetail: {
      propertyType: 'アパート',
      address: `${a.name}番地`,
      annualRent: '1200000',
    },
  }));
}

function payees(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    payeeName: `${prefix}${i}`,
    payeeAddress: '東京都',
    amount: String((i + 1) * 1000),
  }));
}

function employees(
  prefix: string,
  count: number,
  incomeType: 'business' | 'realEstate',
): PersonalDeductionFamilyEmployee[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    name: `${prefix}${i}`,
    relation: 'other' as const,
    age: 30,
    monthsWorked: 12,
    incomeType,
  }));
}

function of(
  items: XtxDetailOverflowItem[],
  formId: XtxDetailOverflowItem['formId'],
  section: XtxDetailOverflowItem['section'],
): XtxDetailOverflowItem[] {
  return items.filter((i) => i.formId === formId && i.section === section);
}
// 出力した繰り返し行の名称欄
function emitted(repeats: XtxRepeatedValues, block: string, nameTag: string): string[] {
  return (repeats[block] ?? []).map((row: XtxLeafValues) => row[nameTag] ?? '');
}
// 候補の全件が「出力した行」と「提示した行」にちょうど 1 回ずつ分かれる
function expectPartition(
  candidates: string[],
  rows: string[],
  overflow: XtxDetailOverflowItem[],
  expectedRows: number,
) {
  expect(rows).toHaveLength(expectedRows);
  expect(overflow.map((i) => i.label)).toEqual(candidates.filter((c) => !rows.includes(c)));
  expect(rows.length + overflow.length).toBe(candidates.length);
}

describe('xtxDetailOverflow 白色申告（KOA020／KOA110／KOA130）', () => {
  const realEstateInput: RealEstateIncomeCtx = {
    businessScale: true,
    rentPaid: payees('地代', 4),
    loanInterestPaid: payees('利子', 4),
    professionalFeesPaid: payees('報酬', 4),
  };
  const white = (overrides: Partial<XtxContext> = {}) =>
    ctx({
      filingType: 'white',
      realEstatePl: pl('3000000'),
      fixedAssets: [...assets('事業', 8), ...propertyAssets('物件', 12)],
      personalDeductions: personalDeductions(realEstateInput, [
        ...employees('事従', 4, 'business'),
        ...employees('不従', 3, 'realEstate'),
      ]),
      ...overrides,
    });

  test('KOA110 減価償却：8 件は 6 件を出力し、取得日が新しい 2 件を提示する', () => {
    const c = white();
    const overflow = xtxDetailOverflow(c);
    expectPartition(
      assets('事業', 8).map((a) => a.name),
      emitted(mapKoa110RepeatedValues(c), 'AIM00010', 'AIM00020'),
      of(overflow, 'KOA110', 'depreciation'),
      6,
    );
    expect(of(overflow, 'KOA110', 'depreciation').map((i) => i.label)).toEqual([
      '事業06',
      '事業07',
    ]);
  });

  test('KOA110 事業専従者：4 人は 3 人を出力し、4 人目を提示する', () => {
    const c = white();
    expectPartition(
      employees('事従', 4, 'business').map((e) => e.name),
      emitted(mapKoa110RepeatedValues(c), 'AIJ00010', 'AIJ00020'),
      of(xtxDetailOverflow(c), 'KOA110', 'familyEmployee'),
      3,
    );
  });

  test('KOA130 貸付不動産：12 件は 10 件を出力し、2 件を提示する', () => {
    const c = white();
    expectPartition(
      propertyAssets('物件', 12).map((a) => a.realEstateDetail!.address),
      emitted(mapKoa130RepeatedValues(c), 'AKH00010', 'AKH00030'),
      of(xtxDetailOverflow(c), 'KOA130', 'realEstateProperty'),
      10,
    );
  });

  test('KOA130 減価償却：12 件は 8 件を出力し、4 件を提示する', () => {
    const c = white();
    expectPartition(
      propertyAssets('物件', 12).map((a) => a.name),
      emitted(mapKoa130RepeatedValues(c), 'AKK00010', 'AKK00020'),
      of(xtxDetailOverflow(c), 'KOA130', 'depreciation'),
      8,
    );
  });

  test.each([
    ['rentPaid', 'AKO00000', 'AKO00030', '地代'],
    ['loanInterestPaid', 'AKL00000', 'AKL00030', '利子'],
    ['professionalFee', 'AKP00000', 'AKP00030', '報酬'],
  ] as const)(
    'KOA130 %s：4 件は 2 件を出力し、残り 2 件を提示する',
    (section, block, nameTag, prefix) => {
      const c = white();
      expectPartition(
        payees(prefix, 4).map((p) => p.payeeName),
        emitted(mapKoa130RepeatedValues(c), block, nameTag),
        of(xtxDetailOverflow(c), 'KOA130', section),
        2,
      );
      expect(of(xtxDetailOverflow(c), 'KOA130', section)[0]?.amount).toBe('3000');
    },
  );

  test('KOA130 事業専従者：不動産側 3 人は 2 人を出力し、3 人目を提示する', () => {
    const c = white();
    expectPartition(
      employees('不従', 3, 'realEstate').map((e) => e.name),
      emitted(mapKoa130RepeatedValues(c), 'AKJ00010', 'AKJ00020'),
      of(xtxDetailOverflow(c), 'KOA130', 'familyEmployee'),
      2,
    );
  });

  test('KOA020 事業専従者：事業側 2 人＋不動産側 1 人は事業側 2 人を出力し、不動産側 1 人を提示する', () => {
    const c = white({
      personalDeductions: personalDeductions(realEstateInput, [
        ...employees('事従', 2, 'business'),
        ...employees('不従', 1, 'realEstate'),
      ]),
    });
    expect(emitted(mapKoa020RepeatedValues(c), 'ABE00010', 'ABE00020')).toEqual(['事従0', '事従1']);
    expect(of(xtxDetailOverflow(c), 'KOA020', 'familyEmployee')).toEqual([
      { formId: 'KOA020', section: 'familyEmployee', label: '不従0', amount: '500000' },
    ]);
  });

  test('KOA110 減価償却：当年の償却額が 0 の資産は提示に出ない', () => {
    const idle = assets('休止', 1, { acquisitionDate: '2027-03-01' });
    const c = white({ fixedAssets: [...assets('事業', 8), ...idle] });
    const overflow = of(xtxDetailOverflow(c), 'KOA110', 'depreciation');
    expect(overflow.map((i) => i.label)).toEqual(['事業06', '事業07']);
  });

  test('KOA130 減価償却：当年の償却額が 0 の資産は提示に出ない', () => {
    const idle = assets('休止', 1, { acquisitionDate: '2027-03-01', incomeType: 'realEstate' });
    const base = white();
    const withIdle = white({ fixedAssets: [...(base.fixedAssets ?? []), ...idle] });
    const overflow = of(xtxDetailOverflow(withIdle), 'KOA130', 'depreciation');
    expect(overflow).toHaveLength(4);
    expect(overflow).toEqual(of(xtxDetailOverflow(base), 'KOA130', 'depreciation'));
  });

  test('不動産所得の損益が無ければ KOA130 の提示は出さない', () => {
    const c = white();
    delete c.realEstatePl;
    expect(xtxDetailOverflow(c).filter((i) => i.formId === 'KOA130')).toEqual([]);
  });
});

describe('xtxDetailOverflow 青色申告（KOA210／KOA220）', () => {
  const realEstateInput: RealEstateIncomeCtx = {
    businessScale: true,
    rentPaid: payees('地代', 4),
    loanInterestPaid: payees('利子', 5),
    professionalFeesPaid: payees('報酬', 4),
  };
  const blue = (overrides: Partial<XtxContext> = {}) =>
    ctx({
      realEstatePl: pl('3000000'),
      fixedAssets: [...assets('事業', 9), ...propertyAssets('物件', 17)],
      personalDeductions: personalDeductions(realEstateInput),
      ...overrides,
    });

  test('KOA210 減価償却：9 件は 7 件を出力し、取得日が新しい 2 件を提示する', () => {
    const c = blue();
    const overflow = of(xtxDetailOverflow(c), 'KOA210', 'depreciation');
    expectPartition(
      assets('事業', 9).map((a) => a.name),
      emitted(mapKoa210RepeatedValues(c), 'AMF01600', 'AMF01610'),
      overflow,
      7,
    );
    expect(overflow.map((i) => i.label)).toEqual(['事業07', '事業08']);
  });

  test('KOA210 まとめ行＋個別 7 件：まとめ行＋6 件を出力し、取得日が最も新しい個別 1 件を提示する', () => {
    const small = assets('少額', 2, {
      acquisitionDate: '2026-03-01',
      acquisitionCost: '100000',
      depreciationMethod: 'small-asset-special',
    });
    const c = blue({ fixedAssets: [...small, ...assets('事業', 7)] });
    const rows = emitted(mapKoa210RepeatedValues(c), 'AMF01600', 'AMF01610');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toBe('少額00 他');
    expect(rows.slice(1)).toEqual(assets('事業', 6).map((a) => a.name));
    expect(of(xtxDetailOverflow(c), 'KOA210', 'depreciation')).toMatchObject([{ label: '事業06' }]);
  });

  test('KOA210 減価償却：当年の償却額が 0 の資産は提示に出ない', () => {
    const idle = assets('休止', 1, { acquisitionDate: '2027-03-01' });
    const c = blue({ fixedAssets: [...assets('事業', 8), ...idle] });
    const overflow = of(xtxDetailOverflow(c), 'KOA210', 'depreciation');
    expect(overflow.map((i) => i.label)).toEqual(['事業07']);
  });

  test('KOA220 減価償却：当年の償却額が 0 の資産は提示に出ない', () => {
    const idle = assets('休止', 1, { acquisitionDate: '2027-03-01', incomeType: 'realEstate' });
    const base = blue();
    const withIdle = blue({ fixedAssets: [...(base.fixedAssets ?? []), ...idle] });
    const overflow = of(xtxDetailOverflow(withIdle), 'KOA220', 'depreciation');
    expect(overflow).toHaveLength(4);
    expect(overflow).toEqual(of(xtxDetailOverflow(base), 'KOA220', 'depreciation'));
  });

  test('KOA220 貸家等の状況：17 件は 15 件を出力し、2 件を提示する', () => {
    const c = blue();
    expectPartition(
      propertyAssets('物件', 17).map((a) => a.realEstateDetail!.address),
      emitted(mapKoa220RepeatedValues(c), 'ANF00340', 'ANF00360'),
      of(xtxDetailOverflow(c), 'KOA220', 'realEstateProperty'),
      15,
    );
  });

  test('KOA220 減価償却：17 件は 13 件を出力し、4 件を提示する', () => {
    const c = blue();
    expectPartition(
      propertyAssets('物件', 17).map((a) => a.name),
      emitted(mapKoa220RepeatedValues(c), 'ANF00890', 'ANF00900'),
      of(xtxDetailOverflow(c), 'KOA220', 'depreciation'),
      13,
    );
  });

  test('KOA220 まとめ行＋個別 13 件：まとめ行＋12 件を出力し、個別 1 件を提示する', () => {
    const small = propertyAssets('少額', 2).map((a) => ({
      ...a,
      acquisitionDate: '2026-03-01',
      acquisitionCost: '100000',
      depreciationMethod: 'small-asset-special' as const,
    }));
    const c = blue({ fixedAssets: [...small, ...propertyAssets('物件', 13)] });
    const rows = emitted(mapKoa220RepeatedValues(c), 'ANF00890', 'ANF00900');
    expect(rows).toHaveLength(13);
    expect(rows[0]).toBe('少額00 他');
    expect(rows.slice(1)).toEqual(propertyAssets('物件', 12).map((a) => a.name));
    expect(of(xtxDetailOverflow(c), 'KOA220', 'depreciation')).toMatchObject([{ label: '物件12' }]);
  });

  test.each([
    ['rentPaid', 'ANF01160', 'ANF01190', '地代', 4, 2],
    ['loanInterestPaid', 'ANF01260', 'ANF01290', '利子', 5, 3],
    ['professionalFee', 'ANF01330', 'ANF01360', '報酬', 4, 2],
  ] as const)(
    'KOA220 %s：上限を超えた分を提示する',
    (section, block, nameTag, prefix, candidateCount, max) => {
      const c = blue();
      expectPartition(
        payees(prefix, candidateCount).map((p) => p.payeeName),
        emitted(mapKoa220RepeatedValues(c), block, nameTag),
        of(xtxDetailOverflow(c), 'KOA220', section),
        max,
      );
    },
  );

  test('青色申告では KOA020 に事業専従者の提示は出ない', () => {
    const c = blue({
      personalDeductions: personalDeductions(realEstateInput, [
        ...employees('事従', 3, 'business'),
        ...employees('不従', 2, 'realEstate'),
      ]),
    });
    expect(xtxDetailOverflow(c).filter((i) => i.formId === 'KOA020')).toEqual([]);
    expect(mapKoa020RepeatedValues(c).ABE00010).toBeUndefined();
  });
});

describe('xtxDetailOverflow 共通', () => {
  test('どの明細も上限に収まるときは空配列', () => {
    expect(xtxDetailOverflow(ctx({ fixedAssets: assets('事業', 7) }))).toEqual([]);
    expect(xtxDetailOverflow(ctx({ filingType: 'white', fixedAssets: assets('事業', 6) }))).toEqual(
      [],
    );
  });

  test('名称が空白の行は label が空文字で、金額を持つ', () => {
    const unnamed = assets('事業', 8).map((a, i) => (i === 7 ? { ...a, name: '  ' } : a));
    const overflow = xtxDetailOverflow(ctx({ fixedAssets: unnamed }));
    expect(overflow).toEqual([
      { formId: 'KOA210', section: 'depreciation', label: '', amount: expect.any(String) },
    ]);
    expect(overflow[0]!.amount).not.toBe('');
  });

  test('提示を求めても .xtx の内容は変わらない', () => {
    const c = ctx({ fixedAssets: assets('事業', 9) });
    const before = buildXtx2026(c);
    xtxDetailOverflow(c);
    expect(buildXtx2026(c)).toBe(before);
  });
});
