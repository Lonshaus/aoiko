import { afterEach, describe, expect, test } from 'vitest';
import {
  clearUnsavedGuard,
  hasUnloadRisk,
  hasUnsavedChanges,
  registerUnloadCheck,
  setUnsavedGuard,
  router,
} from './router.svelte';
import { analysis } from './stores/analysis.svelte';
import { importDraft } from './stores/import-draft.svelte';
import { orderDraft } from './stores/order-draft.svelte';
import { receiptDraft } from './stores/receipt-draft.svelte';

const owners: object[] = [];

function guard(dirty: boolean): object {
  const owner = {};
  owners.push(owner);
  setUnsavedGuard(owner, dirty);
  return owner;
}

afterEach(() => {
  while (owners.length > 0) {
    clearUnsavedGuard(owners.pop()!);
  }
  router.stay();
  router.goto('/');
});

describe('setUnsavedGuard / hasUnsavedChanges', () => {
  test('登録が無ければ未保存なし', () => {
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('登録した画面のどれか 1 つでも dirty なら未保存あり', () => {
    guard(false);
    expect(hasUnsavedChanges()).toBe(false);
    guard(true);
    expect(hasUnsavedChanges()).toBe(true);
  });

  test('同じ owner で false を渡すと解除される', () => {
    const owner = guard(true);
    expect(hasUnsavedChanges()).toBe(true);
    setUnsavedGuard(owner, false);
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('clearUnsavedGuard でも解除される（画面の破棄時）', () => {
    const owner = guard(true);
    clearUnsavedGuard(owner);
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe('router.goto の未保存ガード', () => {
  test('未保存が無ければそのまま遷移する', () => {
    router.goto('/journal');
    expect(router.path).toBe('/journal');
    expect(router.pendingPath).toBeNull();
  });
  // ここが本題：ガードが無いと入力途中の画面から無言で離脱してしまう。
  test('未保存があると遷移せず確認待ちになる', () => {
    router.goto('/journal');
    guard(true);
    router.goto('/settings');
    expect(router.path).toBe('/journal');
    expect(router.pendingPath).toBe('/settings');
  });

  test('留まるを選ぶと遷移しない', () => {
    router.goto('/journal');
    guard(true);
    router.goto('/settings');
    router.stay();
    expect(router.path).toBe('/journal');
    expect(router.pendingPath).toBeNull();
  });

  test('破棄して移動を選ぶと遷移する', () => {
    router.goto('/journal');
    guard(true);
    router.goto('/settings');
    router.discardAndGo();
    expect(router.path).toBe('/settings');
    expect(router.pendingPath).toBeNull();
  });

  test('同じパスへの遷移は確認を出さない', () => {
    router.goto('/journal');
    guard(true);
    router.goto('/journal');
    expect(router.pendingPath).toBeNull();
  });
});

function fireBeforeUnload(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('beforeunload の判定', () => {
  test('何も無ければ止めない', () => {
    expect(hasUnloadRisk()).toBe(false);
    expect(fireBeforeUnload()).toBe(false);
  });

  test('未保存の guard があれば止める', () => {
    guard(true);
    expect(fireBeforeUnload()).toBe(true);
  });

  test('登録された確認が真なら止め、解除すれば止めない', () => {
    let held = true;
    const unregister = registerUnloadCheck(() => held);
    expect(fireBeforeUnload()).toBe(true);
    held = false;
    expect(fireBeforeUnload()).toBe(false);
    held = true;
    unregister();
    expect(fireBeforeUnload()).toBe(false);
  });

  test('実行中の解析があれば止める', () => {
    const job = analysis.begin('receipt')!;
    expect(fireBeforeUnload()).toBe(true);
    analysis.finish(job, 'cancelled');
    expect(fireBeforeUnload()).toBe(false);
  });

  test('領収書の画像、注文の本文、CSV の行のどれかが残っていれば止める', () => {
    receiptDraft.file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(fireBeforeUnload()).toBe(true);
    receiptDraft.file = null;
    expect(fireBeforeUnload()).toBe(false);

    orderDraft.pastedText = '本文';
    expect(fireBeforeUnload()).toBe(true);
    orderDraft.pastedText = '';
    expect(fireBeforeUnload()).toBe(false);

    importDraft.rows = [
      {
        transaction: {
          date: '2026-01-01',
          description: 'x',
          amount: '1',
          side: 'debit',
          rawRow: {},
        },
        counterpartAccountCode: '',
        counterpartSubAccountId: '',
        description: 'x',
        skip: false,
        matchedRuleId: '',
        vendorMatched: false,
        llmConfidence: '',
        taxRate: 0,
        invoiceCompliant: false,
      },
    ];
    expect(fireBeforeUnload()).toBe(true);
    importDraft.importing = true;
    expect(fireBeforeUnload()).toBe(false);
    importDraft.importing = false;
    importDraft.rows = [];
    expect(fireBeforeUnload()).toBe(false);
  });

  test('store に保持した内容は app 内の移動を止めない', () => {
    receiptDraft.file = new File(['x'], 'a.png', { type: 'image/png' });
    orderDraft.pastedText = '本文';
    router.goto('/journal');
    expect(router.path).toBe('/journal');
    expect(router.pendingPath).toBeNull();
    receiptDraft.file = null;
    orderDraft.pastedText = '';
  });
});
