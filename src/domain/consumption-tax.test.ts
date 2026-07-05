import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import {
  compareAll,
  computeGeneral,
  computeSimplified,
  computeThreeWari,
  computeTwoWari,
  processYear,
} from './consumption-tax';
import type { Account, LineSide } from '../db/types';

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