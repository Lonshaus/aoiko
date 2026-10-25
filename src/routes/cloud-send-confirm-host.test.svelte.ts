// 送信前確認の文言は {@html} で描かれる。openaiBaseUrl が URL として読めないと、その文字列が
// そのまま送信先ホストとして差し込まれるので、復元したバックアップの値で要素を作らせない。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount, unmount, flushSync, type Component } from 'svelte';
import { db } from '../db/db';
import type { Account } from '../db/types';
import type { CsvParser } from '../parsers/types';
import { PAYLOAD_VERSION } from '../backup';
import { restoreFromJson } from '../domain/restore';
import { setLocale } from '../paraglide/runtime';
import { m } from '../paraglide/messages';

const HOST = '<b>x</b>';

const { parserA } = vi.hoisted(() => {
  const parserA: CsvParser = {
    name: 'parser-a',
    displayName: 'パーサーA',
    accountCode: '1130',
    encoding: 'utf-8',
    parse: () => [
      { date: '2026-01-10', description: 'alpha', amount: '1000', side: 'credit', rawRow: {} },
    ],
  };
  return { parserA };
});

vi.mock('../parsers', () => ({
  PARSERS: [parserA],
  findParser: (name: string) => (name === parserA.name ? parserA : null),
}));

const { default: Receipt } = await import('./Receipt.svelte');
const { default: OrderImport } = await import('./OrderImport.svelte');
const { default: Import } = await import('./Import.svelte');
const { receiptDraft } = await import('../stores/receipt-draft.svelte');
const { orderDraft } = await import('../stores/order-draft.svelte');
const { importDraft } = await import('../stores/import-draft.svelte');
const { ledger } = await import('../stores/ledger.svelte');

const ACCOUNTS: Account[] = [
  { code: '5200', year: 2026, name: '消耗品費', category: 'expense', displayOrder: 1 },
];

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.delete();
  await db.open();
  vi.spyOn(ledger, 'accounts', 'get').mockReturnValue(ACCOUNTS);
  // 確認の省略もバックアップに入れておく。復元で消えるので、確認は必ず出る。
  await restoreFromJson({
    version: PAYLOAD_VERSION,
    exportedAt: '2026-10-23T00:00:00.000Z',
    tables: {
      settings: [
        { key: 'aiEngine', value: 'openai-compatible', updatedAt: 1 },
        { key: 'openaiBaseUrl', value: HOST, updatedAt: 1 },
        { key: 'openaiOcrModel', value: 'vision-model', updatedAt: 1 },
        { key: 'openaiClassifyModel', value: 'text-model', updatedAt: 1 },
        { key: 'receiptMethod', value: 'ai', updatedAt: 1 },
        { key: 'skipAttachmentConfirm', value: true, updatedAt: 1 },
        { key: 'skipExternalSendConfirm', value: true, updatedAt: 1 },
      ],
    },
  });
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  receiptDraft.reset();
  orderDraft.reset();
  importDraft.reset();
  importDraft.llmStatus = '';
  vi.restoreAllMocks();
  // マウント時の設定読み込みが DB を閉じる前に終わるのを待つ。
  await new Promise((r) => setTimeout(r, 50));
  await db.delete();
});

function mountRoute(route: Component): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(route, { target: container, props: {} });
  flushSync();
  return container;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function findButton(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
}
// ダイアログは AlertDialog の portal で document.body 直下に出る。
function confirmDescription(): HTMLElement | null {
  const content = document.body.querySelector('[data-slot="alert-dialog-content"]');
  if (content === null || !(content.textContent ?? '').includes(m.cloud_send_confirm_title())) {
    return null;
  }
  return content.querySelector('[data-slot="alert-dialog-description"]');
}

async function expectHostShownLiterally(): Promise<void> {
  await waitFor(() => confirmDescription() !== null);
  flushSync();
  const description = confirmDescription()!;
  expect(description.querySelector('b')).toBeNull();
  const strongs = Array.from(description.querySelectorAll('strong'));
  expect(strongs.map((s) => s.textContent)).toContain(HOST);
  expect(description.textContent).toContain(HOST);
}

describe('送信前確認の送信先ホストは文字どおり表示される', () => {
  test('Receipt', async () => {
    const c = mountRoute(Receipt);
    const input = c.querySelector('input[type="file"]') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'receipt.png', { type: 'image/png' }));
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await waitFor(() => findButton(c, '解析する') !== undefined);
    findButton(c, '解析する')!.click();
    await expectHostShownLiterally();
  });

  test('OrderImport', async () => {
    const c = mountRoute(OrderImport);
    const textarea = c.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '注文ページの貼り付けテキスト';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    findButton(c, '解析')!.click();
    await expectHostShownLiterally();
  });

  test('Import', async () => {
    const c = mountRoute(Import);
    const input = c.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['dummy'], 'a.csv', { type: 'text/csv' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => importDraft.rows.length > 0);
    flushSync();
    findButton(c, m.import_llm_button())!.click();
    await expectHostShownLiterally();
  });
});
