import { afterEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { createOrderExtractor } from './order-extractor';
import { setSetting } from './settings';

afterEach(async () => {
  await db.settings.clear();
  vi.unstubAllGlobals();
});

describe('createOrderExtractor（chrome-ai）', () => {
  test('session が返した品目をそのまま K 件返す', async () => {
    await setSetting('aiEngine', 'chrome-ai');
    const items = [
      { description: '品目A', amount: '100' },
      { description: '品目B', amount: '200' },
      { description: '品目C', amount: '-50' },
    ];
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => ({
        contextWindow: 10000,
        measureContextUsage: async () => 0,
        prompt: async () =>
          JSON.stringify({
            date: '2026-05-03',
            vendor: 'Amazon.co.jp',
            orderNumber: '',
            items,
            totalAmount: '250',
          }),
        destroy: () => {},
      }),
    });

    const ex = await createOrderExtractor();
    expect(ex.external).toBe(false);
    const result = await ex.extract('注文内容の貼り付けテキスト');
    expect(result.items).toEqual(items);
    expect(result.items).toHaveLength(3);
  });

  test('LanguageModel が無ければ Gemini に落ちずに投げる', async () => {
    await setSetting('aiEngine', 'chrome-ai');
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const ex = await createOrderExtractor();
    await expect(ex.extract('注文内容の貼り付けテキスト')).rejects.toThrow(/unavailable/);
  });
});
