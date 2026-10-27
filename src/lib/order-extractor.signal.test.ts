import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { LlmAdapter } from '../domain/llm';

const { adapterRef } = vi.hoisted(() => ({ adapterRef: { current: null as LlmAdapter | null } }));

vi.mock('./llm-adapter', () => ({
  createLlmAdapter: async () => adapterRef.current,
}));

const { createOrderExtractor } = await import('./order-extractor');

const ORDER_JSON = {
  date: '2026-05-03',
  vendor: 'テスト商店',
  orderNumber: '',
  items: [{ description: '品', amount: '100' }],
  totalAmount: '100',
};

beforeEach(() => {
  adapterRef.current = null;
});

describe('createOrderExtractor の signal', () => {
  test('runDataTask 経路：signal を第 3 引数で渡す', async () => {
    const runDataTask = vi.fn(async () => ORDER_JSON);
    adapterRef.current = {
      external: false,
      destinationHost: '',
      generateJson: vi.fn(),
      runDataTask,
    };
    const controller = new AbortController();
    const ex = await createOrderExtractor();
    await ex.extract('本文', { signal: controller.signal });
    expect(runDataTask).toHaveBeenCalledWith(
      'order',
      { text: '本文' },
      { signal: controller.signal },
    );
  });

  test('generateJson 経路：signal を第 3 引数で渡す', async () => {
    const generateJson = vi.fn(async () => ORDER_JSON);
    adapterRef.current = { external: false, destinationHost: '', generateJson };
    const controller = new AbortController();
    const ex = await createOrderExtractor();
    await ex.extract('本文', { signal: controller.signal });
    expect(generateJson).toHaveBeenCalledWith(expect.stringContaining('本文'), undefined, {
      signal: controller.signal,
    });
  });
});
