import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { D, toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import {
  compareAll,
  computeGeneral,
  computeThreeWari,
  computeTwoWari,
  deemedSimplifiedElectionFiledDate,
  isSimplifiedElectionEffective,
  isSmallAmountSpecialPeriod,
  isThreeWariEligibleYear,
  isTwoWariEligibleYear,
  processYear,
  transitionalCapExcess,
  wariSpecialDeductionBase,
  type WariEligibilityInputs,
} from './consumption-tax';
import { interimFilingObligation } from './interim-filing';
import { loadInterimPriorPeriodMonths, loadWariBaseAdjustments, setSetting } from '../lib/settings';
import type { Account } from '../db/types';

async function seedAccounts(year: number): Promise<void> {
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
  await db.accounts.bulkPut(accs);
}

async function seedSale(date: string, amount: string, side: 'credit' | 'debit' = 'credit') {
  const entryId = newId();
  await db.journalEntries.add({
    id: entryId,
    date,
    year: Number(date.slice(0, 4)),
    description: '売上',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
  });
  await db.journalLines.bulkAdd([
    {
      id: newId(),
      entryId,
      side,
      accountCode: '4110',
      amount,
      amountIndexed: toIndexable(amount),
      taxRate: 0.1,
      taxIncluded: true,
      invoiceCompliant: true,
    },
    {
      id: newId(),
      entryId,
      side: side === 'credit' ? 'debit' : 'credit',
      accountCode: '1130',
      amount,
      amountIndexed: toIndexable(amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: true,
    },
  ]);
}
// 適格請求書の無い課税仕入れ（10%・税込）を1仕訳で登録し、借方行の ID を返す
async function seedPurchase(date: string, amount: string, vendorId?: string): Promise<string> {
  const entryId = newId();
  const lineId = newId();
  await db.journalEntries.add({
    id: entryId,
    date,
    year: Number(date.slice(0, 4)),
    description: '仕入',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
  });
  await db.journalLines.bulkAdd([
    {
      id: lineId,
      entryId,
      side: 'debit',
      accountCode: '5200',
      ...(vendorId !== undefined ? { vendorId } : {}),
      amount,
      amountIndexed: toIndexable(amount),
      taxRate: 0.1,
      taxIncluded: true,
      invoiceCompliant: false,
    },
    {
      id: newId(),
      entryId,
      side: 'credit',
      accountCode: '1130',
      amount,
      amountIndexed: toIndexable(amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    },
  ]);
  return lineId;
}
function capItem(lineId: string, date: string, amount: string, vendorId?: string) {
  return {
    lineId,
    entryId: `e-${lineId}`,
    date,
    ...(vendorId !== undefined ? { vendorId } : {}),
    inclusiveAmount: D(amount),
  };
}
// 税込 amount の国税分（7.8/110）
function nationalOf(amount: string) {
  return D(amount).dividedBy('1.1').times('0.078');
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedAccounts(2026);
  await seedAccounts(2027);
  await seedAccounts(2028);
});

afterEach(async () => {
  await db.delete();
});

describe('2割・3割特例の資格判定（附則51条の2第1項・51条の3第1項）', () => {
  test('R2：六項目の入力が全部未設定なら年度だけで判定していた従来と同じ', () => {
    for (let year = 2020; year <= 2031; year++) {
      expect(isTwoWariEligibleYear(year), String(year)).toBe(year <= 2026);
      expect(isTwoWariEligibleYear(year, {}), String(year)).toBe(year <= 2026);
      expect(isThreeWariEligibleYear(year, {}), String(year)).toBe(year === 2027 || year === 2028);
    }
  });

  test('R2：compareAll に空の入力を渡しても比較表の方式は従来どおり', async () => {
    await seedSale('2026-04-01', '1100000');
    await seedSale('2027-04-01', '1100000');
    expect((await compareAll(2026, 4)).map((r) => r.method)).toEqual([
      'general',
      'simplified',
      'two-wari',
    ]);
    expect(
      (await compareAll(2026, 4, 'proportional', { eligibility: {} })).map((r) => r.method),
    ).toEqual(['general', 'simplified', 'two-wari']);
    expect(
      (await compareAll(2027, 4, 'proportional', { eligibility: {} })).map((r) => r.method),
    ).toEqual(['general', 'simplified', 'three-wari']);
  });

  test('F2：登録が無くても課税事業者（基準期間1千万円超）なら2割特例は比較表にも .xtx 判定にも出ない', async () => {
    await seedSale('2026-04-01', '1100000');
    const eligibility: WariEligibilityInputs = { basePeriodSales: D('15000000') };
    expect(isTwoWariEligibleYear(2026, eligibility)).toBe(false);
    const methods = (await compareAll(2026, 4, 'proportional', { eligibility })).map(
      (r) => r.method,
    );
    expect(methods).not.toContain('two-wari');
    expect(methods).toEqual(['general', 'simplified']);
  });

  test('F2：施行日前から課税事業者選択届出の効力が続く2023年分は2割特例の対象外（一号）', () => {
    const eligibility: WariEligibilityInputs = { taxableElection: { fromYear: 2021 } };
    expect(isTwoWariEligibleYear(2023, eligibility)).toBe(false);
    expect(isTwoWariEligibleYear(2024, eligibility)).toBe(true);
    const withdrawn: WariEligibilityInputs = { taxableElection: { fromYear: 2021, toYear: 2022 } };
    expect(isTwoWariEligibleYear(2023, withdrawn)).toBe(true);
  });

  test('基準期間1千万円以下なら除外されない', () => {
    expect(isTwoWariEligibleYear(2026, { basePeriodSales: D('10000000') })).toBe(true);
  });

  test('F3：調整対象固定資産の仕入れ等をした課税期間の翌期から3年を経過する日の属する期間まで2割特例は不適用', () => {
    const eligibility: WariEligibilityInputs = { adjustedFixedAssetDate: '2024-05-01' };
    expect(isTwoWariEligibleYear(2024, eligibility)).toBe(true);
    expect(isTwoWariEligibleYear(2025, eligibility)).toBe(false);
    expect(isTwoWariEligibleYear(2026, eligibility)).toBe(false);
    expect(isThreeWariEligibleYear(2027, eligibility)).toBe(true);
  });

  test('F3：compareAll の比較表からも外れる', async () => {
    await seedSale('2026-04-01', '1100000');
    const methods = (
      await compareAll(2026, 4, 'proportional', {
        eligibility: { adjustedFixedAssetDate: '2025-03-01' },
      })
    ).map((r) => r.method);
    expect(methods).not.toContain('two-wari');
  });

  test('F4：3割特例は法人には出ない・令和8年には出ない・一号の事由だけなら適用される', async () => {
    await seedSale('2027-04-01', '1100000');
    expect(isThreeWariEligibleYear(2027, { corporation: true })).toBe(false);
    expect(isThreeWariEligibleYear(2026, {})).toBe(false);
    const item1Only: WariEligibilityInputs = { taxableElection: { fromYear: 2020 } };
    expect(isThreeWariEligibleYear(2027, item1Only)).toBe(true);
    const corp = (
      await compareAll(2027, 4, 'proportional', { eligibility: { corporation: true } })
    ).map((r) => r.method);
    expect(corp).not.toContain('three-wari');
  });

  test('相続（三号）は登録開始日の前日までの相続の年だけ除外し、登録開始日が無ければ判定しない', () => {
    const inputs: WariEligibilityInputs = {
      inheritanceDate: '2025-06-01',
      registrationStartDate: '2025-10-01',
    };
    expect(isTwoWariEligibleYear(2025, inputs)).toBe(false);
    expect(isTwoWariEligibleYear(2026, inputs)).toBe(true);
    expect(isTwoWariEligibleYear(2025, { inheritanceDate: '2025-06-01' })).toBe(true);
    expect(
      isTwoWariEligibleYear(2025, {
        inheritanceDate: '2025-10-01',
        registrationStartDate: '2025-10-01',
      }),
    ).toBe(true);
  });

  test('課税期間短縮（四号）・恒久的施設の無い国外事業者・登録前の年は除外', () => {
    expect(isTwoWariEligibleYear(2025, { shortenedPeriod: { from: '2025-04-01' } })).toBe(false);
    expect(
      isTwoWariEligibleYear(2026, { shortenedPeriod: { from: '2024-01-01', to: '2025-12-31' } }),
    ).toBe(true);
    expect(isThreeWariEligibleYear(2027, { shortenedPeriod: { from: '2027-01-01' } })).toBe(false);
    expect(isTwoWariEligibleYear(2026, { foreignWithoutDomesticPe: true })).toBe(false);
    expect(isTwoWariEligibleYear(2026, { foreignWithoutDomesticPe: false })).toBe(true);
    expect(isTwoWariEligibleYear(2025, { registrationStartDate: '2026-02-01' })).toBe(false);
    expect(isTwoWariEligibleYear(2026, { registrationStartDate: '2026-02-01' })).toBe(true);
  });
});

describe('2割・3割特例の特別控除税額の基礎（附則51条の2第2項・51条の3第2項、附則90条2項）', () => {
  test('F5：2割特例の基礎は返還等の税額を控除した残額で、売上税額 × 20% より小さくなる', async () => {
    const base = wariSpecialDeductionBase('two-wari', D('78000'), D(0), {
      salesReturnTax78: D('7800'),
    });
    expect(base.toString()).toBe('70200');
    await seedSale('2026-04-01', '1100000');
    const plain = await computeTwoWari(2026);
    const withReturn = await computeTwoWari(2026, undefined, { salesReturnTax78: D('7800') });
    expect(plain.netTax.national).toBe('15600');
    // (78,000 − 7,800) × 20% = 14,040
    expect(withReturn.netTax.national).toBe('14040');
    expect(D(withReturn.netTax.national).lessThan(D('78000').times('0.2'))).toBe(true);
  });

  test('F5：返品を売上の借方で記帳した場合も納付額は返品前の売上税額 × 20% より小さい', async () => {
    await seedSale('2026-04-01', '1100000');
    await seedSale('2026-05-01', '110000', 'debit');
    const r = await computeTwoWari(2026);
    expect(D(r.netTax.national).lessThan(D('78000').times('0.2'))).toBe(true);
  });

  test('F6：3割特例の基礎も返還等の税額を控除し、売上税額 × 30% より小さくなる', async () => {
    await seedSale('2027-04-01', '1100000');
    const plain = await computeThreeWari(2027);
    const withReturn = await computeThreeWari(2027, undefined, { salesReturnTax78: D('7800') });
    expect(plain.netTax.national).toBe('23400');
    // (78,000 − 7,800) × 30% = 21,060
    expect(withReturn.netTax.national).toBe('21060');
    expect(D(withReturn.netTax.national).lessThan(D('78000').times('0.3'))).toBe(true);
  });

  test('F7：令和9年の特定少額資産の譲渡は附則90条2項の読替えで3割特例の基礎から除外されない', () => {
    expect(
      wariSpecialDeductionBase('three-wari', D('78000'), D(0), {
        specifiedSmallAssetTransfers: [{ date: '2027-06-01', rate: 0.1, netTax: D('7800') }],
      }).toString(),
    ).toBe('78000');
    expect(
      wariSpecialDeductionBase('three-wari', D('78000'), D(0), {
        specifiedSmallAssetTransfers: [{ date: '2028-03-31', rate: 0.1, netTax: D('7800') }],
      }).toString(),
    ).toBe('78000');
    expect(
      wariSpecialDeductionBase('three-wari', D('78000'), D(0), {
        specifiedSmallAssetTransfers: [{ date: '2028-04-01', rate: 0.1, netTax: D('7800') }],
      }).toString(),
    ).toBe('70200');
    expect(
      wariSpecialDeductionBase('two-wari', D('78000'), D(0), {
        specifiedSmallAssetTransfers: [{ date: '2028-04-01', rate: 0.1, netTax: D('7800') }],
      }).toString(),
    ).toBe('78000');
  });

  test('F7：除外されない年は3割特例の納付額も読替え前の計算と変わらない', async () => {
    await seedSale('2027-04-01', '1100000');
    const plain = await computeThreeWari(2027);
    const withTransfer = await computeThreeWari(2027, undefined, {
      specifiedSmallAssetTransfers: [{ date: '2027-06-01', rate: 0.1, netTax: D('7800') }],
    });
    expect(withTransfer.netTax.national).toBe(plain.netTax.national);
    expect(withTransfer.filingRounded.national).toBe(plain.filingRounded.national);
  });
});

describe('免税事業者等からの課税仕入れの控除上限（附則52条1項・附則90条3項）', () => {
  test('F8：同一取引先の年間税込合計がちょうど1億円なら排除されない', () => {
    const items = [
      capItem('a', '2027-02-01', '60000000', 'v'),
      capItem('b', '2027-03-01', '40000000', 'v'),
    ];
    expect(transitionalCapExcess(D('100000000'), items).size).toBe(0);
  });

  test('F8：100,000,001円なら超えた1円だけを排除する', () => {
    const items = [
      capItem('a', '2027-02-01', '60000000', 'v'),
      capItem('b', '2027-03-01', '40000001', 'v'),
    ];
    const excess = transitionalCapExcess(D('100000000'), items);
    expect(excess.get('a')).toBeUndefined();
    expect(excess.get('b')?.toString()).toBe('1');
  });

  test('F8：控除額は超えた1円分だけ減る（processYear）', async () => {
    await seedPurchase('2027-02-01', '100000001', 'v1');
    const r = await processYear(2027);
    // 1億円分だけが70%で控除され、超えた1円分は控除されない
    const expected = nationalOf('100000000').times('0.7');
    expect(r.input.toDecimalPlaces(6).toString()).toBe(expected.toDecimalPlaces(6).toString());
    expect(r.inputRaw.toDecimalPlaces(6).toString()).toBe(
      nationalOf('100000001').toDecimalPlaces(6).toString(),
    );
  });

  test('F8：ちょうど1億円なら従来どおり全額に経過措置の割合を掛ける', async () => {
    await seedPurchase('2027-02-01', '100000000', 'v1');
    const r = await processYear(2027);
    expect(r.input.toDecimalPlaces(6).toString()).toBe(
      nationalOf('100000000').times('0.7').toDecimalPlaces(6).toString(),
    );
  });

  test('F9：vendorId の無い仕入行は各自独立で、合計が1億円を超えても合算しない', async () => {
    await seedPurchase('2027-02-01', '60000000');
    await seedPurchase('2027-03-01', '60000000');
    const r = await processYear(2027);
    expect(r.input.toDecimalPlaces(6).toString()).toBe(
      nationalOf('120000000').times('0.7').toDecimalPlaces(6).toString(),
    );
    const excess = transitionalCapExcess(D('100000000'), [
      capItem('a', '2027-02-01', '60000000'),
      capItem('b', '2027-03-01', '60000000'),
    ]);
    expect(excess.size).toBe(0);
  });

  test('同じ取引先なら超えた2千万円分を排除する', async () => {
    await seedPurchase('2027-02-01', '60000000', 'v1');
    await seedPurchase('2027-03-01', '60000000', 'v1');
    const r = await processYear(2027);
    expect(r.input.toDecimalPlaces(6).toString()).toBe(
      nationalOf('100000000').times('0.7').toDecimalPlaces(6).toString(),
    );
  });

  test('令和8年10月1日前に開始した課税期間（2026年分）は10億円が上限で、1億円超は排除しない', async () => {
    await seedPurchase('2026-02-01', '60000000', 'v1');
    await seedPurchase('2026-03-01', '60000000', 'v1');
    const r = await processYear(2026);
    expect(r.input.toDecimalPlaces(6).toString()).toBe(
      nationalOf('120000000').times('0.8').toDecimalPlaces(6).toString(),
    );
  });

  test('仮決算の期間集計でも上限は年初からの累計で判定する', async () => {
    await seedPurchase('2027-02-01', '90000000', 'v1');
    await seedPurchase('2027-08-01', '20000000', 'v1');
    const r = await processYear(2027, { start: '2027-07-01', end: '2027-12-31' });
    expect(r.input.toDecimalPlaces(6).toString()).toBe(
      nationalOf('10000000').times('0.7').toDecimalPlaces(6).toString(),
    );
  });
});

describe('少額特例（附則53条の2・平成30年政令第135号附則24条の2）', () => {
  test('R3：売上高の入力が無ければ少額特例は適用されず控除は従来どおり', async () => {
    await seedPurchase('2027-02-01', '9999');
    const without = await processYear(2027);
    const withEmpty = await processYear(2027, undefined, { smallAmountSpecial: {} });
    const expected = nationalOf('9999').times('0.7').toDecimalPlaces(6).toString();
    expect(without.input.toDecimalPlaces(6).toString()).toBe(expected);
    expect(withEmpty.input.toDecimalPlaces(6).toString()).toBe(expected);
    expect(isSmallAmountSpecialPeriod()).toBe(false);
    expect(isSmallAmountSpecialPeriod({})).toBe(false);
    const general = await computeGeneral(2027);
    const generalEmpty = await computeGeneral(2027, 'proportional', undefined, {
      smallAmountSpecial: {},
    });
    expect(generalEmpty).toEqual(general);
  });

  test('F11：税込9,999円は帳簿のみで全額控除、10,000円は経過措置の割合のまま', async () => {
    await seedPurchase('2027-02-01', '9999');
    await seedPurchase('2027-02-02', '10000');
    const r = await processYear(2027, undefined, {
      smallAmountSpecial: { basePeriodSales: D('50000000') },
    });
    const expected = nationalOf('9999').plus(nationalOf('10000').times('0.7'));
    expect(r.input.toDecimalPlaces(6).toString()).toBe(expected.toDecimalPlaces(6).toString());
  });

  test('F12：基準期間 100,000,001 でも特定期間 50,000,000 なら少額特例の対象', () => {
    expect(
      isSmallAmountSpecialPeriod({
        basePeriodSales: D('100000001'),
        specifiedPeriodSales: D('50000000'),
      }),
    ).toBe(true);
    expect(
      isSmallAmountSpecialPeriod({
        basePeriodSales: D('100000001'),
        specifiedPeriodSales: D('50000001'),
      }),
    ).toBe(false);
    expect(isSmallAmountSpecialPeriod({ basePeriodSales: D('100000000') })).toBe(true);
  });

  test('少額特例の対象行は控除上限の累計に入れない', async () => {
    await seedPurchase('2027-01-05', '100000000', 'v1');
    await seedPurchase('2027-02-01', '9999', 'v1');
    const r = await processYear(2027, undefined, {
      smallAmountSpecial: { specifiedPeriodSales: D('1000000') },
    });
    const expected = nationalOf('100000000').times('0.7').plus(nationalOf('9999'));
    expect(r.input.toDecimalPlaces(6).toString()).toBe(expected.toDecimalPlaces(6).toString());
  });
});

describe('簡易課税制度選択届出書の提出期限の特例（附則51条の2第6項・51条の3第5項・附則90条1項）', () => {
  test('F14：翌期の確定申告期限までに出した届出は特例対象課税期間の期首の前日に出したものとみなす', () => {
    expect(deemedSimplifiedElectionFiledDate(2027, '2028-03-15', 'two-wari')).toBe('2026-12-31');
    expect(isSimplifiedElectionEffective(2027, '2028-03-15', 'two-wari')).toBe(true);
    const afterThreeWari = deemedSimplifiedElectionFiledDate(2028, '2029-03-31', 'three-wari');
    expect(afterThreeWari).toBe('2027-12-31');
  });

  test('期限後の提出や、前年に特例を適用していない場合はみなさない', () => {
    expect(isSimplifiedElectionEffective(2027, '2028-04-01', 'two-wari')).toBe(false);
    expect(isSimplifiedElectionEffective(2027, '2027-06-01', 'general')).toBe(false);
    expect(isSimplifiedElectionEffective(2028, '2027-06-01', 'general')).toBe(true);
  });

  test('2026-10-01 前に終了する特例対象課税期間は改正前の「翌課税期間中」の提出に限る', () => {
    expect(deemedSimplifiedElectionFiledDate(2025, '2025-11-01', 'two-wari')).toBe('2024-12-31');
    expect(deemedSimplifiedElectionFiledDate(2025, '2026-02-01', 'two-wari')).toBe('2026-02-01');
  });

  test('R4：届出日が未入力なら簡易課税は従来どおり比較表に含まれる', async () => {
    await seedSale('2026-04-01', '1100000');
    const methods = (await compareAll(2026, 4, 'proportional', {})).map((r) => r.method);
    expect(methods).toContain('simplified');
  });

  test('届出日が入力されていれば効力の及ばない年は簡易課税を比較表から外す', async () => {
    await seedSale('2026-04-01', '1100000');
    await seedSale('2027-04-01', '1100000');
    const opts = { simplifiedElectionFiledDate: '2026-06-01', priorYearMethod: 'general' as const };
    const before = (await compareAll(2026, 4, 'proportional', opts)).map((r) => r.method);
    const after = (await compareAll(2027, 4, 'proportional', opts)).map((r) => r.method);
    expect(before).not.toContain('simplified');
    expect(after).toContain('simplified');
  });
});

describe('D3-F2：中間申告の直前課税期間月数（設定経由）', () => {
  test('2027年分に月数3を記録すると、確定税額150,000は÷3で判定し年1回の義務になる', async () => {
    const months = await loadInterimPriorPeriodMonths(2027);
    // 未設定時は12（回帰）
    expect(months).toBe(12);
    await setSetting('interimPriorPeriodMonths', { 2027: 3 });
    const recorded = await loadInterimPriorPeriodMonths(2027);
    expect(recorded).toBe(3);
    const obligation = interimFilingObligation(2027, D('150000'), recorded);
    expect(obligation.installmentCount).toBe(1);
  });

  test('記録の無い2028年分は同額でも月数12のまま判定され義務が無い', async () => {
    const months = await loadInterimPriorPeriodMonths(2028);
    expect(months).toBe(12);
    const obligation = interimFilingObligation(2028, D('150000'), months);
    expect(obligation.installmentCount).toBe(0);
  });
});

describe('D3-F3：2割特例の基数調整（設定経由の売上対価の返還等、7.8%分）', () => {
  test('2026年分に7.8%の返還等税額10,000を記録すると、compareAllの2割国税額は未入力より2,000少ない', async () => {
    await seedSale('2026-04-01', '1100000');
    const plain = await compareAll(2026, 4, 'proportional', {});
    const plainTwoWari = plain.find((r) => r.method === 'two-wari')!;

    await setSetting('wariBaseAdjustments', { 2026: { salesReturnTax78: '10000' } });
    const adjustments = await loadWariBaseAdjustments(2026);
    expect(adjustments.salesReturnTax78?.toString()).toBe('10000');
    const withReturn = await compareAll(2026, 4, 'proportional', { wariAdjustments: adjustments });
    const withReturnTwoWari = withReturn.find((r) => r.method === 'two-wari')!;

    expect(
      D(plainTwoWari.netTax.national).minus(withReturnTwoWari.netTax.national).toString(),
    ).toBe('2000');
  });
});

describe('D3-F4：3割特例の基数調整（設定経由の特定少額資産の譲渡、附則90条2項）', () => {
  test('2028-03-31の譲渡は読替えの対象で基数から除かれず、単独の場合と結果が同じ', async () => {
    await seedSale('2028-04-01', '1100000');
    await setSetting('wariBaseAdjustments', {
      2028: { specifiedSmallAssetTransfers: [{ date: '2028-03-31', rate: 0.1, netTax: '7800' }] },
    });
    const withSuspended = await compareAll(2028, 4, 'proportional', {
      wariAdjustments: await loadWariBaseAdjustments(2028),
    });
    const plain = await compareAll(2028, 4, 'proportional', {});
    expect(withSuspended.find((r) => r.method === 'three-wari')!.netTax.national).toBe(
      plain.find((r) => r.method === 'three-wari')!.netTax.national,
    );
  });

  test('2028-04-01の譲渡は通常どおり基数から除かれ、単独と2028-03-31併記時で結果が同じ', async () => {
    await seedSale('2028-04-01', '1100000');
    await setSetting('wariBaseAdjustments', {
      2028: { specifiedSmallAssetTransfers: [{ date: '2028-04-01', rate: 0.1, netTax: '7800' }] },
    });
    const single = await compareAll(2028, 4, 'proportional', {
      wariAdjustments: await loadWariBaseAdjustments(2028),
    });
    await setSetting('wariBaseAdjustments', {
      2028: {
        specifiedSmallAssetTransfers: [
          { date: '2028-03-31', rate: 0.1, netTax: '7800' },
          { date: '2028-04-01', rate: 0.1, netTax: '7800' },
        ],
      },
    });
    const both = await compareAll(2028, 4, 'proportional', {
      wariAdjustments: await loadWariBaseAdjustments(2028),
    });
    const plain = await compareAll(2028, 4, 'proportional', {});
    const singleTax = single.find((r) => r.method === 'three-wari')!.netTax.national;
    const bothTax = both.find((r) => r.method === 'three-wari')!.netTax.national;
    const plainTax = plain.find((r) => r.method === 'three-wari')!.netTax.national;
    // 2028-03-31 分は読替えで効かないため、単独と併記で同じ結果。かつ無調整とは異なる結果
    expect(bothTax).toBe(singleTax);
    expect(bothTax).not.toBe(plainTax);
  });
});
