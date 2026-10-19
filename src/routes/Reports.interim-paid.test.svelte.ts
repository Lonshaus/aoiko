import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import { setSetting } from '../lib/settings';
import { newId } from '../lib/id';
import { saveTextFile } from '../lib/save-file';
import { m } from '../paraglide/messages';
import type { Account } from '../db/types';
import type { Decimal } from '../lib/decimal';

const captured: { interimPaidNational?: Decimal; interimPaidLocal?: Decimal; calls: number } = {
  calls: 0,
};

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));

vi.mock('../tax-schema/2026/xtx-consumption-tax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tax-schema/2026/xtx-consumption-tax')>();
  function capture<T extends { interimPaidNational?: Decimal; interimPaidLocal?: Decimal }>(
    ctx: T,
  ): void {
    captured.calls++;
    if (ctx.interimPaidNational !== undefined) {
      captured.interimPaidNational = ctx.interimPaidNational;
    }
    if (ctx.interimPaidLocal !== undefined) {
      captured.interimPaidLocal = ctx.interimPaidLocal;
    }
  }
  return {
    ...actual,
    buildTwoWariXtx: (ctx: Parameters<typeof actual.buildTwoWariXtx>[0]) => {
      capture(ctx);
      return actual.buildTwoWariXtx(ctx);
    },
    buildSimplifiedXtx: (ctx: Parameters<typeof actual.buildSimplifiedXtx>[0]) => {
      capture(ctx);
      return actual.buildSimplifiedXtx(ctx);
    },
    buildGeneralXtx: (ctx: Parameters<typeof actual.buildGeneralXtx>[0]) => {
      capture(ctx);
      return actual.buildGeneralXtx(ctx);
    },
  };
});

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

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  await db.delete();
  await db.open();
  for (const year of [2026, 2027]) {
    const accs: Account[] = ACCOUNTS_2026.map((a) => ({ ...a, year }));
    await db.accounts.bulkPut(accs);
  }
  await setSetting('userRiyoshaId', '1234567890123456');
  await setSetting('userFilerName', '青井 太郎');
  await setSetting('userFilerZip', '1800001');
  await setSetting('userFilerAddress', '東京都武蔵野市〇〇1-2-3');
  await setSetting('userZeimushoCode', '01101');
  captured.calls = 0;
  delete captured.interimPaidNational;
  delete captured.interimPaidLocal;
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
  vi.clearAllMocks();
});

async function mountReports(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Reports, { target: container, props: {} });
  await waitFor(() => container!.querySelector('input[name="interimPaidNational"]') !== null);
}

function named(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (el === null) {
    throw new Error(`input ${name} not found`);
  }
  return el;
}

function type(name: string, value: string): void {
  const el = named(name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function button(label: string): HTMLButtonElement {
  const el = Array.from(container!.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (el === undefined) {
    throw new Error(`button ${label} not found`);
  }
  return el;
}

const EXPORTS = [
  ['2割特例', m.reports_consumption_tax_xtx_two_wari_download(), 'ABI00110'],
  ['簡易課税', m.reports_consumption_tax_xtx_simplified_download(), 'ABI00110'],
  ['一般課税', m.reports_consumption_tax_xtx_general_download(), 'AAJ00110'],
] as const;

describe('中間納付額の入力が消費税の .xtx に値どおり渡る', () => {
  test.each(EXPORTS)(
    '%s：全角・全角カンマで入力した中間納付額は数値として .xtx に入る',
    async (_kind, label, tag) => {
      await mountReports();
      type('interimPaidNational', '５，０００');
      type('interimPaidLocal', ' １４００ ');
      expect(container!.textContent).not.toContain(m.common_amount_invalid());
      button(label).click();
      await waitFor(() => vi.mocked(saveTextFile).mock.calls.length > 0);
      expect(captured.interimPaidNational?.toString()).toBe('5000');
      expect(captured.interimPaidLocal?.toString()).toBe('1400');
      expect(vi.mocked(saveTextFile).mock.calls[0]?.[0]).toMatch(new RegExp(`<${tag}[^>]*>5000<`));
    },
  );

  test.each(EXPORTS)(
    '%s：読めない中間納付額は欄の下に入力の誤りを示し、.xtx を書き出さない',
    async (_kind, label) => {
      await mountReports();
      type('interimPaidNational', '-5000');
      expect(named('interimPaidNational').parentElement?.textContent).toContain(
        m.common_amount_invalid(),
      );
      button(label).click();
      await waitFor(() =>
        Array.from(container!.querySelectorAll('p')).some(
          (p) => (p.textContent ?? '').trim() === m.common_amount_invalid(),
        ),
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(captured.calls).toBe(0);
      expect(saveTextFile).not.toHaveBeenCalled();

      type('interimPaidNational', '5000');
      expect(named('interimPaidNational').parentElement?.textContent).not.toContain(
        m.common_amount_invalid(),
      );
    },
  );
});

describe('前年の確定消費税額の欄', () => {
  test('全角・全角カンマで入力した前年額で中間申告の義務を判定し、読めない値は欄の下に示す', async () => {
    await setSetting('currentYear', 2027);
    await mountReports();
    await waitFor(() => container!.querySelector('input[name="interimPriorNenAmount"]') !== null);
    type('interimPriorNenAmount', '５００，０００');
    await waitFor(() =>
      (container!.textContent ?? '').includes(
        '年 1 回の中間申告義務があります（予定申告方式の按分額）。',
      ),
    );
    expect(named('interimPriorNenAmount').parentElement?.textContent).not.toContain(
      m.common_amount_invalid(),
    );

    type('interimPriorNenAmount', '500,000円');
    expect(named('interimPriorNenAmount').parentElement?.textContent).toContain(
      m.common_amount_invalid(),
    );
  });

  test('還付だった前年分の確定額は0として入り、入力の誤りは示さない', async () => {
    await db.reportSnapshots.add({
      id: newId(),
      year: 2026,
      type: 'consumption-tax',
      status: 'filed',
      filedAt: Date.now(),
      payload: { type: 'consumption-tax', data: { method: 'general', netTaxNational: '-12300' } },
      generatedAt: Date.now(),
      generatedFromEntriesUpTo: '2026-12-31',
    });
    await setSetting('currentYear', 2027);
    await mountReports();
    await waitFor(() => container!.querySelector('input[name="interimPriorNenAmount"]') !== null);
    await waitFor(() => named('interimPriorNenAmount').value === '0');
    expect(container!.textContent).not.toContain(m.common_amount_invalid());
    expect(container!.textContent).toContain(
      '前年確定消費税額が48万円以下のため、中間申告義務はありません。',
    );
  });
});
