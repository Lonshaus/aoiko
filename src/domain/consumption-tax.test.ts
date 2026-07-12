import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import {
  compareAll,
  computeGeneral,
  computeSimplified,
  computeTaxableSalesRatio,
  computeThreeWari,
  computeTwoWari,
  isFullDeductionEligible,
  processYear,
} from './consumption-tax';
import { D } from '../lib/decimal';
import type { Account, InputUsageCategory, LineSide, TaxCategory } from '../db/types';

async function seedAccounts(year: number): Promise<void> {
  const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
  await db.accounts.bulkPut(accs);
}

interface LineSeed {
  side: LineSide;
  accountCode: string;
  amount: string;
  taxRate?: number;
  taxIncluded?: boolean;
  invoiceCompliant?: boolean;
  taxCategory?: TaxCategory;
  inputUsageCategory?: InputUsageCategory;
}

async function seedEntry(opts: {
  date: string;
  pairs: LineSeed[];
  description?: string;
}): Promise<string> {
  const entryId = newId();
  const now = Date.now();
  await db.transaction('rw', db.journalEntries, db.journalLines, async () => {
    await db.journalEntries.add({
      id: entryId,
      date: opts.date,
      year: Number(opts.date.slice(0, 4)),
      description: opts.description ?? 'テスト',
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    });
    await db.journalLines.bulkAdd(
      opts.pairs.map((p) => ({
        id: newId(),
        entryId,
        side: p.side,
        accountCode: p.accountCode,
        amount: p.amount,
        amountIndexed: toIndexable(p.amount),
        taxRate: p.taxRate ?? 0,
        taxIncluded: p.taxIncluded ?? true,
        invoiceCompliant: p.invoiceCompliant ?? false,
        ...(p.taxCategory ? { taxCategory: p.taxCategory } : {}),
        ...(p.inputUsageCategory ? { inputUsageCategory: p.inputUsageCategory } : {}),
      }))
    );
  });
  return entryId;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedAccounts(2026);
});

afterEach(async () => {
  await db.delete();
});

describe('computeGeneral - 本則課税', () => {
  test('売上のみ、仕入なし：売上税額 = 納付税額', async () => {
    // 売上 1,100 円（税込 10%）→ 国税 = 78 円
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100' }, // 預金（taxRate 0）
        { side: 'credit', accountCode: '4110', amount: '1100', taxRate: 0.1, taxIncluded: true }, // 売上 10%
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.outputTax.national).toBe('78');
    expect(r.inputTax.national).toBe('0');
    expect(r.netTax.national).toBe('78');
    expect(r.netTax.local).toBe('22'); // 78 × 22/78 = 22
    expect(r.netTax.total).toBe('100');
  });

  test('適格仕入れあり：100% 控除', async () => {
    // 売上 11,000 円税込 10% → 国税 780 円
    // 仕入 5,500 円税込 10%、適格 → 国税 390 円、控除 390 円
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '11000' },
        { side: 'credit', accountCode: '4110', amount: '11000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    await seedEntry({
      date: '2026-05-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5200',
          amount: '5500',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: true,
        },
        { side: 'credit', accountCode: '1130', amount: '5500' },
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.outputTax.national).toBe('780');
    expect(r.inputTax.national).toBe('390');
    expect(r.netTax.national).toBe('390');
  });

  test('免税事業者からの仕入：経過措置 80% 控除（2025 取得）', async () => {
    // 売上 11,000 円税込 → 国税 780
    // 仕入 5,500 円税込・適格なし・2025 年取得 → 控除率 80%、国税 390 × 0.8 = 312
    await seedAccounts(2025);
    await seedEntry({
      date: '2025-06-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '11000' },
        { side: 'credit', accountCode: '4110', amount: '11000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    await seedEntry({
      date: '2025-07-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5200',
          amount: '5500',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: false,
        },
        { side: 'credit', accountCode: '1130', amount: '5500' },
      ],
    });
    const r = await computeGeneral(2025);
    expect(r.outputTax.national).toBe('780');
    expect(r.inputTaxRaw.national).toBe('390');
    expect(r.inputTax.national).toBe('312');
    expect(r.netTax.national).toBe('468');
  });

  test('2026-10 以降の免税仕入：経過措置 70%', async () => {
    await seedEntry({
      date: '2026-10-15',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '11000' },
        { side: 'credit', accountCode: '4110', amount: '11000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    await seedEntry({
      date: '2026-11-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5200',
          amount: '5500',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: false,
        },
        { side: 'credit', accountCode: '1130', amount: '5500' },
      ],
    });
    const r = await computeGeneral(2026);
    // 国税 sales 780、purchases raw 390、控除 = 390 × 0.7 = 273
    expect(r.inputTax.national).toBe('273');
    expect(r.netTax.national).toBe('507');
  });

  test('軽減税率 8%：国税 6.24/108', async () => {
    // 売上 1,080 円税込 8% → 国税 62.4 → 整数化で 62
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1080' },
        { side: 'credit', accountCode: '4110', amount: '1080', taxRate: 0.08, taxIncluded: true },
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.outputTax.national).toBe('62');
  });

  test('事業主貸は仕入控除対象外', async () => {
    // 事業主貸（1610）は asset category だが控除対象外
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '1610',
          amount: '11000',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: true,
        },
        { side: 'credit', accountCode: '1130', amount: '11000' },
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.inputTaxRaw.national).toBe('0');
    expect(r.inputTax.national).toBe('0');
  });

  test('税抜入力（taxIncluded=false）も正しく計算', async () => {
    // 売上 1,000 円税抜 10% → 税込 1,100、国税 78
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100' },
        { side: 'credit', accountCode: '4110', amount: '1000', taxRate: 0.1, taxIncluded: false },
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.outputTax.national).toBe('78');
  });

  test('端数は切捨て（四捨五入しない）', async () => {
    // 税込 1,000 円 10% → 国税 = 1000 × 7.8/110 = 70.909… → 切捨て 70（四捨五入なら 71）
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1000' },
        { side: 'credit', accountCode: '4110', amount: '1000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.outputTax.national).toBe('70');
  });

  test('売上値引（revenue 借方）は課税標準から控除される', async () => {
    // 売上 11,000 円税込 → 国税 780。値引 1,100 円税込 → 国税 −78。正味 702
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '11000' },
        { side: 'credit', accountCode: '4110', amount: '11000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    await seedEntry({
      date: '2026-04-10',
      pairs: [
        { side: 'debit', accountCode: '4110', amount: '1100', taxRate: 0.1, taxIncluded: true },
        { side: 'credit', accountCode: '1130', amount: '1100' },
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.outputTax.national).toBe('702');
  });

  test('仕入の返金（expense 貸方）は仕入税額から控除される', async () => {
    // 適格仕入 5,500 円税込 → 控除 390。返金 1,100 円税込 → −78。正味 312
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5200',
          amount: '5500',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: true,
        },
        { side: 'credit', accountCode: '1130', amount: '5500' },
      ],
    });
    await seedEntry({
      date: '2026-04-15',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100' },
        {
          side: 'credit',
          accountCode: '5200',
          amount: '1100',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: true,
        },
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.inputTaxRaw.national).toBe('312');
    expect(r.inputTax.national).toBe('312');
  });
});

describe('processYear - 仕入税額の税率別内訳（付表1-3/4-3 用）', () => {
  test('標準税率・軽減税率の仕入が混在する場合、input10/input8 に分かれる', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        // 仕入 10%：税込1100円 → 国税 78円
        {
          side: 'debit',
          accountCode: '5200',
          amount: '1100',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: true,
        },
        // 仕入 8%：税込1080円（税抜1000円）→ 国税 1000×6.24%=62.4円
        {
          side: 'debit',
          accountCode: '5020',
          amount: '1080',
          taxRate: 0.08,
          taxIncluded: true,
          invoiceCompliant: true,
        },
        { side: 'credit', accountCode: '1130', amount: '2180' },
      ],
    });
    const r = await processYear(2026);
    expect(r.input10.toString()).toBe('78');
    expect(r.input8.toString()).toBe('62.4');
    expect(r.input.toString()).toBe('140.4');
  });

  test('適格請求書なしの仕入は経過措置控除率が税率ごとに適用される', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        // 適格請求書なし、10%：国税78円 × 80%（経過措置）= 62.4円
        {
          side: 'debit',
          accountCode: '5200',
          amount: '1100',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: false,
        },
        { side: 'credit', accountCode: '1130', amount: '1100' },
      ],
    });
    const r = await processYear(2026);
    expect(r.input10.toString()).toBe('62.4');
    expect(r.input8.toString()).toBe('0');
  });
});

describe('computeSimplified - 簡易課税', () => {
  test('第 1 種（卸売 90%）：売上税額 × 10% が納付', async () => {
    // 売上 1,100,000 円税込 → 国税 78,000
    // 第 1 種は 90% みなし → 控除 70,200、納付 7,800
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    const r = await computeSimplified(2026, 1);
    expect(r.outputTax.national).toBe('78000');
    expect(r.inputTax.national).toBe('70200');
    expect(r.netTax.national).toBe('7800');
  });

  test('第 4 種（その他 60%）：売上税額 × 40% が納付', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    const r = await computeSimplified(2026, 4);
    expect(r.netTax.national).toBe('31200'); // 78000 × 0.4
  });
});

describe('computeTwoWari - 2 割特例', () => {
  test('売上税額 × 20% が納付', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    const r = await computeTwoWari(2026);
    expect(r.outputTax.national).toBe('78000');
    expect(r.netTax.national).toBe('15600'); // 78000 × 0.2
  });
});

describe('computeThreeWari - 3 割特例', () => {
  test('売上税額 × 30% が納付', async () => {
    await seedEntry({
      date: '2027-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    // 2027 年度の accounts も seed
    await seedAccounts(2027);
    const r = await computeThreeWari(2027);
    expect(r.outputTax.national).toBe('78000');
    expect(r.netTax.national).toBe('23400'); // 78000 × 0.3
  });
});

describe('filingRounded / taxableBase - 申告書相当額（千円/百円未満切捨て）', () => {
  test('課税標準額は千円未満切捨て、税額は百円未満切捨て（本則）', async () => {
    // 税抜 1,234,567 円（10%）→ 課税標準額 1,234,000（千円未満切捨て）
    // 消費税額 = 1,234,000 × 7.8% = 96,252（既に1円単位）
    // 差引税額 = 96,252 → 百円未満切捨て 96,200、地方 = floor(96,200×22/78,100) = 27,100
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1358024' },
        { side: 'credit', accountCode: '4110', amount: '1234567', taxRate: 0.1, taxIncluded: false },
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.taxableBase).toBe('1234000');
    expect(r.filingRounded.national).toBe('96200');
    expect(r.filingRounded.local).toBe('27100');
    expect(r.filingRounded.total).toBe('123300');
  });

  test('10%/8%混在：税率ごとに千円未満切捨てしてから合算する（合算後一括切捨てではない）', async () => {
    // 10%分 税抜 500,700 → 500,000（700円切捨て）
    // 8%分  税抜 300,900 → 300,000（900円切捨て）
    // 正しい課税標準額 = 800,000。もし合算(801,600)後に一括切捨てすると 801,000 になり誤り
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '801600' },
        { side: 'credit', accountCode: '4110', amount: '500700', taxRate: 0.1, taxIncluded: false },
        { side: 'credit', accountCode: '4110', amount: '300900', taxRate: 0.08, taxIncluded: false },
      ],
    });
    const r = await computeGeneral(2026);
    expect(r.taxableBase).toBe('800000');
    // 消費税額 = 500,000×7.8% + 300,000×6.24% = 39,000 + 18,720 = 57,720
    expect(r.filingRounded.national).toBe('57700');
    expect(r.filingRounded.local).toBe('16200');
    expect(r.filingRounded.total).toBe('73900');
  });

  test('簡易課税：みなし仕入控除も申告書側の税額から算出し1円未満切捨て', async () => {
    // 課税標準額に対する消費税額(官庁側) = 96,252（上記と同じ売上）
    // 第4種(60%)：みなし仕入 = 96,252×0.6 = 57,751.2 → 1円未満切捨て 57,751
    // 差引 = 96,252 − 57,751 = 38,501 → 百円未満切捨て 38,500
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1358024' },
        { side: 'credit', accountCode: '4110', amount: '1234567', taxRate: 0.1, taxIncluded: false },
      ],
    });
    const r = await computeSimplified(2026, 4);
    expect(r.taxableBase).toBe('1234000');
    expect(r.filingRounded.national).toBe('38500');
  });

  test('2割特例・3割特例も官庁側の売上税額（課税標準額基準）から算出する', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1358024' },
        { side: 'credit', accountCode: '4110', amount: '1234567', taxRate: 0.1, taxIncluded: false },
      ],
    });
    const two = await computeTwoWari(2026);
    // 96,252 × 0.2 = 19,250.4 → 百円未満切捨て 19,200
    expect(two.filingRounded.national).toBe('19200');

    await seedAccounts(2027);
    const three = await computeThreeWari(2027);
    // 2027 年は仕訳が無いため課税標準額 0、申告書相当額も 0
    expect(three.taxableBase).toBe('0');
    expect(three.filingRounded.total).toBe('0');
  });
});

describe('compareAll - 方式比較', () => {
  test('2026 年は本則・簡易・2割特例（3割特例は適用外）', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    const all = await compareAll(2026, 4);
    expect(all.map((r) => r.method)).toEqual(['general', 'simplified', 'two-wari']);
  });

  test('2027 年は本則・簡易・3割特例（2割特例は適用外）', async () => {
    await seedAccounts(2027);
    await seedEntry({
      date: '2027-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    const all = await compareAll(2027, 4);
    expect(all.map((r) => r.method)).toEqual(['general', 'simplified', 'three-wari']);
  });

  test('2029 年以降は特例なし（本則・簡易のみ）', async () => {
    const all = await compareAll(2029, 4);
    expect(all.map((r) => r.method)).toEqual(['general', 'simplified']);
  });
});

describe('免税・非課税売上と課税売上割合', () => {
  test('免税売上（輸出）は課税売上割合の分子に算入される', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1000000' },
        { side: 'credit', accountCode: '4110', amount: '1000000', taxCategory: 'exportExempt' },
      ],
    });
    const processed = await processYear(2026);
    expect(processed.exportExemptSalesBase.toString()).toBe('1000000');
    const ratio = computeTaxableSalesRatio(
      processed.taxableBase10,
      processed.taxableBase8,
      processed.exportExemptSalesBase,
      processed.nonTaxableSalesBase
    );
    // 課税売上 0 ＋ 免税売上 1,000,000 のみ → 分子・分母とも 1,000,000 → 100%
    expect(ratio.ratioPercent).toBe('100.00');
  });

  test('非課税売上は分母のみに算入され、課税売上割合が下がる', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    await seedEntry({
      date: '2026-04-02',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '4110', amount: '100000', taxCategory: 'exempt' },
      ],
    });
    const processed = await processYear(2026);
    expect(processed.nonTaxableSalesBase.toString()).toBe('100000');
    const ratio = computeTaxableSalesRatio(
      processed.taxableBase10,
      processed.taxableBase8,
      processed.exportExemptSalesBase,
      processed.nonTaxableSalesBase
    );
    // 課税売上 1,000,000 ／ (1,000,000 + 100,000) = 10/11 = 90.90...% → 切り捨て 90.90
    expect(ratio.ratioPercent).toBe('90.90');
    expect(isFullDeductionEligible(ratio)).toBe(false);
  });

  test('課税売上割合95%以上・5億円以下なら全額控除', async () => {
    const ratio = computeTaxableSalesRatio(D(1000000), D(0), D(0), D(0));
    expect(isFullDeductionEligible(ratio)).toBe(true);
  });
});

describe('輸入消費税・特定課税仕入れ', () => {
  test('輸入消費税：金額そのものが税額として控除対象仕入税額に加算される', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5020',
          amount: '5000',
          taxCategory: 'importTax10',
          invoiceCompliant: true,
        },
        { side: 'credit', accountCode: '1130', amount: '5000' },
      ],
    });
    const processed = await processYear(2026);
    expect(processed.importTax10.toString()).toBe('5000');
    expect(processed.input10.toString()).toBe('5000');
    expect(processed.input.toString()).toBe('5000');
  });

  test('特定課税仕入れ（リバースチャージ）：output・input には混入せず独立集計のみ', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5020',
          amount: '11000',
          taxIncluded: true,
          taxCategory: 'reverseCharge',
          invoiceCompliant: true,
        },
        { side: 'credit', accountCode: '1130', amount: '11000' },
      ],
    });
    const processed = await processYear(2026);
    // 11,000 税込 → 国税 = 10,000 × 7.8% = 780。経過措置判定は集計後に行うため、
    // ここでは output・input10 に混入させず reverseCharge* にのみ計上する
    expect(processed.reverseChargeBase.toString()).toBe('10000');
    expect(processed.reverseChargeTax.toString()).toBe('780');
    expect(processed.output.toString()).toBe('0');
    expect(processed.input10.toString()).toBe('0');
    expect(processed.input.toString()).toBe('0');
    expect(processed.inputRaw.toString()).toBe('0');
  });

  test('特定課税仕入れの用途区分（common）は reverseChargeCommonTax に入り inputCommon10 には入らない', async () => {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5020',
          amount: '11000',
          taxIncluded: true,
          taxCategory: 'reverseCharge',
          invoiceCompliant: true,
          inputUsageCategory: 'common',
        },
        { side: 'credit', accountCode: '1130', amount: '11000' },
      ],
    });
    const processed = await processYear(2026);
    expect(processed.reverseChargeCommonTax.toString()).toBe('780');
    expect(processed.reverseChargeNonTaxableOnlyTax.toString()).toBe('0');
    expect(processed.inputCommon10.toString()).toBe('0');
  });
});

describe('特定課税仕入れの経過措置配線（computeGeneral / 簡易・特例）', () => {
  // 課税売上 税込1,100,000（10%）→ 税抜 1,000,000・売上税額 78,000
  async function seedTaxableSale(): Promise<void> {
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
  }
  // 特定課税仕入れ 税抜 100,000（10%）→ 国税 7,800
  async function seedReverseCharge(): Promise<void> {
    await seedEntry({
      date: '2026-05-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5020',
          amount: '100000',
          taxIncluded: false,
          taxCategory: 'reverseCharge',
          invoiceCompliant: true,
        },
        { side: 'credit', accountCode: '1130', amount: '100000' },
      ],
    });
  }
  // 非課税売上 100,000 → 課税売上割合を 95% 未満に落とす
  async function seedNonTaxableSale(): Promise<void> {
    await seedEntry({
      date: '2026-04-02',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '4110', amount: '100000', taxCategory: 'exempt' },
      ],
    });
  }

  test('本則課税・課税売上割合95%未満：課税標準側にも控除側にも RC が配線される', async () => {
    await seedTaxableSale();
    await seedNonTaxableSale();
    await seedReverseCharge();
    const r = await computeGeneral(2026, 'proportional');
    // 課税標準額 = floor1000(1,000,000 + 100,000) = 1,100,000
    expect(r.taxableBase).toBe('1100000');
    // 売上消費税 = 1,100,000 × 7.8% = 85,800
    expect(r.outputTax.national).toBe('85800');
    // 控除側：RC 税額 7,800 を一括比例配分（割合 1,000,000/1,100,000）で按分 → 7,090.9… 切捨て 7,090
    expect(r.inputTax.national).toBe('7090');
    // 差引 = 85,800 − 7,090.9… = 78,709.09… → 百円未満切捨て 78,700
    expect(r.filingRounded.national).toBe('78700');
  });

  test('本則課税・課税売上割合95%以上：RC は課税標準・控除いずれにも入らない（RC なしと同値）', async () => {
    await seedTaxableSale();
    await seedReverseCharge();
    const r = await computeGeneral(2026, 'proportional');
    // 割合100% → RC は「なかったもの」。RC なし（課税売上のみ）と完全同値
    expect(r.taxableBase).toBe('1000000');
    expect(r.outputTax.national).toBe('78000');
    expect(r.inputTax.national).toBe('0');
    expect(r.netTax.national).toBe('78000');
  });

  test('簡易課税：RC は output に混入せず「なかったもの」として扱われる', async () => {
    await seedTaxableSale();
    await seedReverseCharge();
    const r = await computeSimplified(2026, 5);
    // 売上税額 78,000 × みなし50% → 控除 39,000、差引 39,000。RC は不算入
    expect(r.taxableBase).toBe('1000000');
    expect(r.inputTax.national).toBe('39000');
    expect(r.netTax.national).toBe('39000');
  });

  test('2割特例：RC は output に混入せず「なかったもの」として扱われる', async () => {
    await seedTaxableSale();
    await seedReverseCharge();
    const r = await computeTwoWari(2026);
    // 売上税額 78,000 × (1 − 0.8) = 15,600。RC は不算入
    expect(r.taxableBase).toBe('1000000');
    expect(r.netTax.national).toBe('15600');
  });
});

describe('個別対応方式・一括比例配分方式（課税売上割合95%未満）', () => {
  async function seedRatioUnder95(): Promise<void> {
    // 課税売上 1,000,000（税込 1,100,000・10%）＋ 非課税売上 100,000 → 課税売上割合 = 10/11 ≒ 90.90%
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    await seedEntry({
      date: '2026-04-02',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '100000' },
        { side: 'credit', accountCode: '4110', amount: '100000', taxCategory: 'exempt' },
      ],
    });
    // 課税対応仕入：550,000 税込 10% → 国税 39,000（taxableOnly、既定値）
    await seedEntry({
      date: '2026-05-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5020',
          amount: '550000',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: true,
        },
        { side: 'credit', accountCode: '1130', amount: '550000' },
      ],
    });
    // 共通対応仕入：110,000 税込 10% → 国税 7,800
    await seedEntry({
      date: '2026-05-02',
      pairs: [
        {
          side: 'debit',
          accountCode: '5020',
          amount: '110000',
          taxRate: 0.1,
          taxIncluded: true,
          invoiceCompliant: true,
          inputUsageCategory: 'common',
        },
        { side: 'credit', accountCode: '1130', amount: '110000' },
      ],
    });
  }

  test('一括比例配分方式：課税仕入れ等の税額の合計額 × 課税売上割合', async () => {
    await seedRatioUnder95();
    const r = await computeGeneral(2026, 'proportional');
    // inputTotal 46,800 × 10/11 = 42,545.4545... → 円未満切捨て 42,545
    expect(r.inputTax.national).toBe('42545');
    // netTax = 78,000 − 42,545.4545... = 35,454.5454... → 切捨て 35,454
    expect(r.netTax.national).toBe('35454');
  });

  test('個別対応方式：課税対応分は全額控除＋共通対応分 × 課税売上割合', async () => {
    await seedRatioUnder95();
    const r = await computeGeneral(2026, 'individual');
    // 39,000（課税対応、全額）＋ 7,800 × 10/11 = 39,000 + 7,090.909... = 46,090.909... → 切捨て 46,090
    expect(r.inputTax.national).toBe('46090');
    expect(r.netTax.national).toBe('31909');
  });

  test('個別対応方式の方が一括比例配分方式より控除額が大きい（一般的な傾向どおり）', async () => {
    await seedRatioUnder95();
    const proportional = await computeGeneral(2026, 'proportional');
    const individual = await computeGeneral(2026, 'individual');
    expect(D(individual.inputTax.national).greaterThan(proportional.inputTax.national)).toBe(true);
  });
});

describe('貸倒れ・貸倒回収に係る消費税額調整', () => {
  test('貸倒れ：税込の貸倒金額から、その行の taxRate で税額を逆算する（仕入税額には算入しない）', async () => {
    await seedEntry({
      date: '2026-06-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5270',
          amount: '11000',
          taxRate: 0.1,
          taxIncluded: true,
          taxCategory: 'badDebt',
        },
        { side: 'credit', accountCode: '1310', amount: '11000' },
      ],
    });
    const processed = await processYear(2026);
    // 11,000 税込 → 国税 = 10,000 × 7.8% = 780
    expect(processed.badDebtTax10.toString()).toBe('780');
    expect(processed.badDebtTax8.toString()).toBe('0');
    expect(processed.input.toString()).toBe('0');
    expect(processed.inputRaw.toString()).toBe('0');
  });

  test('貸倒回収：課税標準額・課税売上割合には算入せず税額のみ逆算する', async () => {
    await seedEntry({
      date: '2026-06-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '10800' },
        {
          side: 'credit',
          accountCode: '4910',
          amount: '10800',
          taxRate: 0.08,
          taxIncluded: true,
          taxCategory: 'badDebtRecovery',
        },
      ],
    });
    const processed = await processYear(2026);
    // 10,800 税込 → 国税 = 10,000 × 6.24% = 624
    expect(processed.badDebtRecoveryTax8.toString()).toBe('624');
    expect(processed.badDebtRecoveryTax10.toString()).toBe('0');
    expect(processed.output.toString()).toBe('0');
    expect(processed.taxableBase8.toString()).toBe('0');
  });

  async function seedBadDebtScenario(): Promise<void> {
    // 通常売上：1,100,000 税込 10% → 売上税額 78,000
    await seedEntry({
      date: '2026-04-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    // 貸倒れ：11,000 税込 10% → 780
    await seedEntry({
      date: '2026-06-01',
      pairs: [
        {
          side: 'debit',
          accountCode: '5270',
          amount: '11000',
          taxRate: 0.1,
          taxIncluded: true,
          taxCategory: 'badDebt',
        },
        { side: 'credit', accountCode: '1310', amount: '11000' },
      ],
    });
    // 貸倒回収：2,200 税込 10% → 156
    await seedEntry({
      date: '2026-07-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '2200' },
        {
          side: 'credit',
          accountCode: '4910',
          amount: '2200',
          taxRate: 0.1,
          taxIncluded: true,
          taxCategory: 'badDebtRecovery',
        },
      ],
    });
  }

  test('本則課税：(売上税額＋貸倒回収) − 貸倒れ税額（仕入税額控除は別枠）', async () => {
    await seedBadDebtScenario();
    const r = await computeGeneral(2026);
    // 78,000 + 156 − 0（仕入無し） − 780 = 77,376
    expect(r.netTax.national).toBe('77376');
  });

  test('簡易課税：控除対象仕入税額の基礎に貸倒回収を加算、貸倒れは別枠で減算', async () => {
    await seedBadDebtScenario();
    const r = await computeSimplified(2026, 5);
    // 基準消費税額 = 78,000 + 156 = 78,156 → みなし仕入50% = 39,078
    // 78,156 − 39,078 − 780 = 38,298
    expect(r.netTax.national).toBe('38298');
  });

  test('2 割特例：(基準消費税額) × 20% − 貸倒れ税額', async () => {
    await seedBadDebtScenario();
    const r = await computeTwoWari(2026);
    // (78,000 + 156) × 20% − 780 = 15,631.2 − 780 = 14,851.2 → 円未満切捨て 14,851
    expect(r.netTax.national).toBe('14851');
  });
});

describe('period 指定（仮決算・中間申告用の期間限定集計）', () => {
  test('period を指定すると、その期間内の仕訳のみを集計する', async () => {
    await seedAccounts(2026);
    await seedEntry({
      date: '2026-02-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '1100000' },
        { side: 'credit', accountCode: '4110', amount: '1100000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    await seedEntry({
      date: '2026-08-01',
      pairs: [
        { side: 'debit', accountCode: '1130', amount: '2200000' },
        { side: 'credit', accountCode: '4110', amount: '2200000', taxRate: 0.1, taxIncluded: true },
      ],
    });
    const full = await processYear(2026);
    expect(full.output.toString()).toBe('234000');
    const h1 = await processYear(2026, { start: '2026-01-01', end: '2026-06-30' });
    expect(h1.output.toString()).toBe('78000');
    const r = await computeGeneral(2026, 'proportional', { start: '2026-01-01', end: '2026-06-30' });
    expect(r.netTax.national).toBe('78000');
  });
});