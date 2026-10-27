import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { newId } from '../lib/id';
import { toIndexable } from '../lib/decimal';
import { buildPayload } from '../backup/payload';
import { validateBackupPayload } from './restore-validate';
import { createDraftInvoice, DEFAULT_INVOICE_PREFIX, issueInvoice } from './invoice';
import { generateYearEndDepreciation } from './depreciation';
import { generateDisposalEntry } from './asset-disposal';
import { expandHomeOffice } from './home-office';

const PLAIN = /^\d+(\.\d+)?$/;

async function expectPayloadRestorable(): Promise<void> {
  const payload = await buildPayload();
  expect(() => validateBackupPayload(payload)).not.toThrow();
  for (const line of await db.journalLines.toArray()) {
    expect(line.amount, line.amount).toMatch(PLAIN);
  }
}

async function issue(quantity: string, unitPrice: string): Promise<void> {
  const vendorId = newId();
  await db.vendors.add({ id: vendorId, name: '取引先A' });
  const draft = createDraftInvoice('invoice', vendorId, '2026-07-08');
  draft.lineItems = [{ id: newId(), name: '商品A', quantity, unitPrice, taxRate: 0.1 }];
  await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('実際の書き込み関数で作った仕訳はバックアップから戻せる', () => {
  test('数量 0.0000001 × 単価 1 の請求書', async () => {
    await issue('0.0000001', '1');
    const [ar] = await db.arApEntries.toArray();
    expect(ar?.originalAmount).toMatch(PLAIN);
    await expectPayloadRestorable();
  });

  test('数量 0.0000000001 × 単価 1.234567890123456789012345678 の請求書', async () => {
    await issue('0.0000000001', '1.234567890123456789012345678');
    await expectPayloadRestorable();
  });

  test('売却価格に多桁の小数を含む資産の売却', async () => {
    await db.fixedAssets.add({
      id: newId(),
      name: '売却する機械',
      acquisitionDate: '2025-01-01',
      acquisitionCost: '300000',
      usefulLifeYears: 4,
      depreciationMethod: 'straight-line',
      accountCode: '1510',
      disposedDate: '2026-06-30',
      disposalType: 'sale',
      salePrice: '123456.0000000001',
    });
    await generateYearEndDepreciation(2026);
    const [asset] = await db.fixedAssets.toArray();
    expect((await generateDisposalEntry(asset!.id)).created).toBe(true);
    await expectPayloadRestorable();
  });

  test('家事按分で 1 円未満の端数が残る仕訳', async () => {
    const lines = expandHomeOffice([
      {
        id: newId(),
        side: 'debit',
        accountCode: '5150',
        subAccountId: '',
        amount: '1000.0000001',
        taxRate: 0,
        taxIncluded: true,
        homeOfficeRatio: '0.3',
      },
    ]);
    const entryId = newId();
    await db.journalEntries.add({
      id: entryId,
      date: '2026-03-01',
      year: 2026,
      description: '通信費',
      status: 'confirmed',
      source: 'manual',
      createdAt: 1,
      confirmedAt: 1,
    });
    await db.journalLines.bulkAdd(
      lines.map((l) => ({
        id: newId(),
        entryId,
        side: l.side,
        accountCode: l.accountCode,
        amount: l.amount,
        amountIndexed: toIndexable(l.amount),
        taxRate: 0,
        taxIncluded: true,
        invoiceCompliant: false,
      })),
    );
    await expectPayloadRestorable();
  });
});
