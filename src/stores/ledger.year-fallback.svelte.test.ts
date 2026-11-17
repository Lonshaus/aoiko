import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { ledger } from './ledger.svelte';
import { ACCOUNTS_2026 } from '../tax-schema/2026';

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor タイムアウト（${label}）`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
});

afterEach(async () => {
  ledger.switchYear(2026);
  await db.delete();
});

describe('ledger の科目（科目が 2026 年度にしか無いとき）', () => {
  test('2027 年度へ切り替えると accounts が空にならず year が全て 2027', async () => {
    ledger.switchYear(2027);
    await waitFor(
      () => ledger.currentYear === 2027 && ledger.accounts.length > 0,
      '2027 年度の科目',
    );
    expect(ledger.accounts.every((a) => a.year === 2027)).toBe(true);
    expect(await db.accounts.where({ year: 2027 }).count()).toBe(0);
  });
});
