import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import { db } from '../db/db';
import { m } from '../paraglide/messages';

vi.mock('../lib/save-file', () => ({
  saveTextFile: vi.fn(async () => 'saved' as const),
}));
vi.mock('../domain/cash-flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/cash-flow')>();
  return {
    ...actual,
    forecastCashFlow: vi.fn(async () => {
      throw new Error('予測の失敗（試験）');
    }),
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
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('資金繰り予測', () => {
  test('予測に失敗したときはエラーを表示し、前の予測は残さない', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    instance = mount(Reports, { target: container, props: {} });
    await waitFor(() =>
      [...container!.querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === m.reports_cashflow_run(),
      ),
    );
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === m.reports_cashflow_run())!
      .click();
    await waitFor(() => (container!.textContent ?? '').includes('予測の失敗（試験）'));
  });
});
