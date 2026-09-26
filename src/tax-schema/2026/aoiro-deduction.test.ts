import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import { aoiroDeductionAmount, aoiroDeductionLimit } from './aoiro-deduction';

describe('aoiroDeductionLimit', () => {
  test('令和8年分（2026）：電子=65万・複式=55万・簡易=10万・なし=0', () => {
    expect(aoiroDeductionLimit(2026, 'electronic').toString()).toBe('650000');
    expect(aoiroDeductionLimit(2026, 'doubleEntry').toString()).toBe('550000');
    expect(aoiroDeductionLimit(2026, 'simple').toString()).toBe('100000');
    expect(aoiroDeductionLimit(2026, 'none').toString()).toBe('0');
  });

  test('令和9年分（2027）以降：電子は75万に引き上げ', () => {
    expect(aoiroDeductionLimit(2027, 'electronic').toString()).toBe('750000');
    expect(aoiroDeductionLimit(2026, 'electronic').toString()).toBe('650000');
  });

  test('令和9年分以降は55万の段が無く、複式簿記＋紙申告は10万（措法25条の2第1項）', () => {
    expect(aoiroDeductionLimit(2027, 'doubleEntry').toString()).toBe('100000');
    expect(aoiroDeductionLimit(2028, 'doubleEntry').toString()).toBe('100000');
    expect(aoiroDeductionLimit(2027, 'simple').toString()).toBe('100000');
    expect(aoiroDeductionLimit(2027, 'none').toString()).toBe('0');
  });

  test('新しい入力が未設定なら令和8年分は従来どおり', () => {
    expect(aoiroDeductionLimit(2026, 'electronic', {}).toString()).toBe('650000');
    expect(aoiroDeductionLimit(2026, 'doubleEntry', {}).toString()).toBe('550000');
    expect(aoiroDeductionLimit(2026, 'simple', {}).toString()).toBe('100000');
    expect(aoiroDeductionLimit(2026, 'none', {}).toString()).toBe('0');
    expect(aoiroDeductionLimit(2027, 'electronic', {}).toString()).toBe('750000');
    expect(aoiroDeductionLimit(2027, 'simple', {}).toString()).toBe('100000');
  });
});

describe('aoiroDeductionLimit：前々年分総収入金額1,000万円超（措法25条の2第2項、令和9年分以後）', () => {
  test('令和9年分・簡易簿記・前々年分の事業所得の総収入金額 10,000,001 → 0', () => {
    expect(
      aoiroDeductionLimit(2027, 'simple', { priorPriorBusinessRevenue: D(10_000_001) }).toString(),
    ).toBe('0');
  });

  test('ちょうど1,000万円は「超える」に当たらず10万', () => {
    expect(
      aoiroDeductionLimit(2027, 'simple', { priorPriorBusinessRevenue: D(10_000_000) }).toString(),
    ).toBe('100000');
  });

  test('事業的規模の不動産所得の前々年分総収入金額でも同じ', () => {
    expect(
      aoiroDeductionLimit(2027, 'simple', {
        priorPriorRealEstateRevenue: D(12_000_000),
      }).toString(),
    ).toBe('0');
  });

  test('令和9年分・複式簿記＋紙申告は第4項に該当するため2項の影響を受けない（10万のまま）', () => {
    expect(
      aoiroDeductionLimit(2027, 'doubleEntry', {
        priorPriorBusinessRevenue: D(15_000_000),
      }).toString(),
    ).toBe('100000');
  });

  test('第4項（65万・75万）に該当すれば影響しない', () => {
    expect(
      aoiroDeductionLimit(2027, 'electronic', {
        priorPriorBusinessRevenue: D(15_000_000),
      }).toString(),
    ).toBe('750000');
  });

  test('令和8年分には適用しない（附則33条）', () => {
    expect(
      aoiroDeductionLimit(2026, 'simple', { priorPriorBusinessRevenue: D(15_000_000) }).toString(),
    ).toBe('100000');
  });
});

describe('aoiroDeductionLimit：現金主義（所得税法67条1項）の適用者', () => {
  test('令和9年分：65万・75万は取れず10万は取れる', () => {
    expect(aoiroDeductionLimit(2027, 'electronic', { cashBasis: true }).toString()).toBe('100000');
    expect(aoiroDeductionLimit(2027, 'doubleEntry', { cashBasis: true }).toString()).toBe('100000');
    expect(aoiroDeductionLimit(2027, 'simple', { cashBasis: true }).toString()).toBe('100000');
  });

  test('令和9年分：前々年分1,000万円超の要件の対象からも除かれるため10万のまま', () => {
    expect(
      aoiroDeductionLimit(2027, 'simple', {
        cashBasis: true,
        priorPriorBusinessRevenue: D(15_000_000),
      }).toString(),
    ).toBe('100000');
  });

  test('令和8年分：55万・65万の対象からも除かれる（改正前の措法25条の2第3項括弧書）', () => {
    expect(aoiroDeductionLimit(2026, 'electronic', { cashBasis: true }).toString()).toBe('100000');
    expect(aoiroDeductionLimit(2026, 'doubleEntry', { cashBasis: true }).toString()).toBe('100000');
  });

  test('cashBasis: false は未設定と同じ', () => {
    expect(aoiroDeductionLimit(2027, 'electronic', { cashBasis: false }).toString()).toBe('750000');
  });
});

describe('aoiroDeductionLimit：eTax区分（正規の簿記＋e-Tax送信、優良は問わない）', () => {
  test('D1-F1：令和8・9年分ともに65万、現金主義なら10万', () => {
    expect(aoiroDeductionLimit(2026, 'eTax').toString()).toBe('650000');
    expect(aoiroDeductionLimit(2027, 'eTax').toString()).toBe('650000');
    expect(aoiroDeductionLimit(2027, 'eTax', { cashBasis: true }).toString()).toBe('100000');
  });

  test('D1-F2：令和9年分・前々年分事業収入1,200万円でも65万のまま（4項該当のため2項の影響なし）', () => {
    expect(
      aoiroDeductionLimit(2027, 'eTax', { priorPriorBusinessRevenue: D(12_000_000) }).toString(),
    ).toBe('650000');
  });
});

describe('aoiroDeductionLimit：D1-F2（令和9年分・前々年分事業収入1,200万円の各区分）', () => {
  test('electronic 75万・eTax 65万・doubleEntry 10万・simple 0円', () => {
    const options = { priorPriorBusinessRevenue: D(12_000_000) };
    expect(aoiroDeductionLimit(2027, 'electronic', options).toString()).toBe('750000');
    expect(aoiroDeductionLimit(2027, 'eTax', options).toString()).toBe('650000');
    expect(aoiroDeductionLimit(2027, 'doubleEntry', options).toString()).toBe('100000');
    expect(aoiroDeductionLimit(2027, 'simple', options).toString()).toBe('0');
  });
});

describe('aoiroDeductionAmount', () => {
  test('控除前所得が限度額以上なら限度額を全額控除', () => {
    expect(aoiroDeductionAmount(2026, 'electronic', D(5000000)).toString()).toBe('650000');
  });

  test('控除前所得が限度額未満なら控除前所得が上限', () => {
    expect(aoiroDeductionAmount(2026, 'electronic', D(400000)).toString()).toBe('400000');
  });

  test('赤字（控除前所得が0以下）なら控除0', () => {
    expect(aoiroDeductionAmount(2026, 'electronic', D(-100000)).toString()).toBe('0');
    expect(aoiroDeductionAmount(2026, 'simple', D(0)).toString()).toBe('0');
  });

  test('オプションが限度額に反映される', () => {
    expect(
      aoiroDeductionAmount(2027, 'electronic', D(5000000), { cashBasis: true }).toString(),
    ).toBe('100000');
    expect(
      aoiroDeductionAmount(2027, 'simple', D(5000000), {
        priorPriorBusinessRevenue: D(10_000_001),
      }).toString(),
    ).toBe('0');
  });
});
