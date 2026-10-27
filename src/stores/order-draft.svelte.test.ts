import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OrderExtracted } from '../domain/order-extract';
import type { LlmCallOptions } from '../domain/llm';
import { hasUnloadRisk } from '../router.svelte';

type Extract = (text: string, options?: LlmCallOptions) => Promise<OrderExtracted>;

const { extractorRef } = vi.hoisted(() => ({
  extractorRef: { extract: null as unknown as Extract },
}));

vi.mock('../lib/order-extractor', () => ({
  createOrderExtractor: async () => ({
    external: false,
    destinationHost: '',
    extract: (text: string, options?: LlmCallOptions) => extractorRef.extract(text, options),
  }),
}));

const { orderDraft } = await import('./order-draft.svelte');
const { analysis } = await import('./analysis.svelte');

const RESULT: OrderExtracted = {
  date: '2026-05-03',
  vendor: 'テスト商店',
  totalAmount: '300',
  items: [
    { description: '品A', amount: '100' },
    { description: '品B', amount: '200' },
  ],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  extractorRef.extract = async () => RESULT;
});

afterEach(() => {
  orderDraft.reset();
  orderDraft.success = '';
  orderDraft.paymentAccount = '2120';
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.viewing = null;
  analysis.unseen = {};
  analysis.notices = [];
});

async function start(text = '注文本文') {
  orderDraft.setPastedText(text);
  const prepared = await orderDraft.prepare();
  expect(prepared).not.toBeNull();
  return prepared!;
}

describe('状態の保持', () => {
  test('本文・結果・明細・支払科目が store に残る', async () => {
    orderDraft.paymentAccount = '1110';
    await orderDraft.run(await start());
    expect(orderDraft.pastedText).toBe('注文本文');
    expect(orderDraft.extracted?.vendor).toBe('テスト商店');
    expect(orderDraft.reviewItems).toHaveLength(2);
    expect(orderDraft.reviewItems[0]).toMatchObject({ taxRate: 0.1, rateTouched: false });
    expect(orderDraft.paymentAccount).toBe('1110');
  });

  test('reset で本文・結果・明細を消す', async () => {
    await orderDraft.run(await start());
    orderDraft.reset();
    expect(orderDraft.pastedText).toBe('');
    expect(orderDraft.extracted).toBeNull();
    expect(orderDraft.reviewItems).toEqual([]);
    expect(orderDraft.dirty).toBe(false);
  });

  test('本文が空白だけなら準備しない', async () => {
    orderDraft.setPastedText('   ');
    expect(await orderDraft.prepare()).toBeNull();
    expect(orderDraft.error).not.toBe('');
  });

  test('beforeunload の判定は本文または結果があるときに真になる', () => {
    expect(hasUnloadRisk()).toBe(false);
    orderDraft.setPastedText('x');
    expect(hasUnloadRisk()).toBe(true);
  });
});

describe('実行権と取消し', () => {
  test('解析中は 2 件目の準備を断る', async () => {
    const gate = deferred<OrderExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = orderDraft.run(await start());
    expect(await orderDraft.prepare()).toBeNull();
    gate.resolve(RESULT);
    await running;
    expect(analysis.busy).toBe(false);
    expect(analysis.unseen.order).toBe('done');
  });

  test('中止できる経路は reject の時点で手放す', async () => {
    extractorRef.extract = (_t, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const running = orderDraft.run(await start());
    analysis.cancel();
    await running;
    expect(analysis.busy).toBe(false);
    expect(orderDraft.error).toBe('');
    expect(orderDraft.extracted).toBeNull();
  });

  test('中止できない経路は終わるまで「取消中」で、戻った結果は捨てる', async () => {
    const gate = deferred<OrderExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = orderDraft.run(await start());
    analysis.cancel();
    expect(analysis.isCancelling('order')).toBe(true);
    expect(analysis.begin('receipt')).toBeNull();
    gate.resolve(RESULT);
    await running;
    expect(analysis.busy).toBe(false);
    expect(orderDraft.extracted).toBeNull();
    expect(orderDraft.reviewItems).toEqual([]);
  });

  test('失敗はエラーとして持つ', async () => {
    extractorRef.extract = async () => {
      throw new Error('boom');
    };
    await orderDraft.run(await start());
    expect(orderDraft.error).toBe('boom');
    expect(analysis.unseen.order).toBe('failed');
  });
});

describe('入力の保護', () => {
  test('解析中は本文の変更を store が拒否する', async () => {
    const gate = deferred<OrderExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = orderDraft.run(await start());
    expect(orderDraft.setPastedText('別の本文')).toBe(false);
    expect(orderDraft.pastedText).toBe('注文本文');
    analysis.cancel();
    expect(orderDraft.setPastedText('別の本文')).toBe(false);
    gate.resolve(RESULT);
    await running;
    expect(orderDraft.setPastedText('別の本文')).toBe(true);
  });

  test('ロックを迂回して本文を書き換えても、古い解析の結果は書き込まれない', async () => {
    const gate = deferred<OrderExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = orderDraft.run(await start());
    orderDraft.pastedText = '書き換えた本文';
    gate.resolve(RESULT);
    await running;
    expect(orderDraft.pastedText).toBe('書き換えた本文');
    expect(orderDraft.extracted).toBeNull();
    expect(analysis.busy).toBe(false);
  });
});
