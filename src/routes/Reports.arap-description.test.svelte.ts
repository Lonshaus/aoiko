// 売掛金・買掛金一覧の摘要に、旧形式の取引先 ID が出ないことを見る。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';
import { createDraftInvoice, DEFAULT_INVOICE_PREFIX, issueInvoice } from '../domain/invoice';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

const { default: Reports } = await import('./Reports.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const VENDOR_ID = '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f';
const MISSING_ID = '00000000-1111-4222-8333-444444444444';

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
  await db.delete();
});

function descriptionCells(c: HTMLElement): string[] {
  const table = Array.from(c.querySelectorAll('table')).find((t) =>
    (t.querySelector('thead')?.textContent ?? '').includes(m.reports_arap_remaining()),
  );
  return Array.from(table?.querySelectorAll('tbody tr td:nth-child(2)') ?? []).map(
    (td) => td.textContent?.trim() ?? '',
  );
}

describe('Reports: 売掛金・買掛金一覧の摘要', () => {
  test('旧形式の摘要は取引先名で表示し、見つからなければ番号だけにする', async () => {
    await db.vendors.add({ id: VENDOR_ID, name: '株式会社テスト' });
    await db.arApEntries.bulkAdd([
      {
        id: 'a1',
        type: 'receivable',
        description: `INV-2026-0001（${VENDOR_ID}）`,
        dueDate: '2026-08-01',
        originalAmount: '1000',
        paidAmount: '0',
        createdAt: 1,
      },
      {
        id: 'a2',
        type: 'receivable',
        description: `INV-2026-0002（${MISSING_ID}）`,
        dueDate: '2026-08-02',
        originalAmount: '1000',
        paidAmount: '0',
        createdAt: 2,
      },
      {
        id: 'a3',
        type: 'payable',
        description: '家賃（8月分）',
        dueDate: '2026-08-03',
        originalAmount: '1000',
        paidAmount: '0',
        createdAt: 3,
      },
    ]);
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });

    await waitFor(() => descriptionCells(container!).length === 3);
    expect(descriptionCells(container)).toEqual([
      'INV-2026-0001（株式会社テスト）',
      'INV-2026-0002',
      '家賃（8月分）',
    ]);
    expect(container.textContent).not.toContain(VENDOR_ID);
    expect(container.textContent).not.toContain(MISSING_ID);
  });

  test('新規に発行した請求書は取引先名つきで表示される', async () => {
    await db.vendors.add({ id: VENDOR_ID, name: '株式会社テスト' });
    const draft = createDraftInvoice('invoice', VENDOR_ID, '2026-07-08');
    draft.lineItems = [{ id: 'l1', name: '商品A', quantity: '1', unitPrice: '1000', taxRate: 0.1 }];
    await issueInvoice(draft, DEFAULT_INVOICE_PREFIX);
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });

    await waitFor(() => descriptionCells(container!).length === 1);
    expect(descriptionCells(container)[0]).toBe(
      `${DEFAULT_INVOICE_PREFIX}-2026-0001（株式会社テスト）`,
    );
  });
});
