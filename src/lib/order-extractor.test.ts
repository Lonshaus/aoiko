import { afterEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { createOrderExtractor } from './order-extractor';
import { setSetting } from './settings';

afterEach(async () => {
  await db.settings.clear();
  vi.unstubAllGlobals();
});

describe('createOrderExtractor', () => {
  test('既定（gemini）：API キー無しならエラー', async () => {
    await expect(createOrderExtractor()).rejects.toThrow(/Gemini API キー/);
  });

  test('gemini：キー有りで external=true / 該当ホスト', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const ex = await createOrderExtractor();
    expect(ex.external).toBe(true);
    expect(ex.destinationHost).toBe('generativelanguage.googleapis.com');
  });

  test('openai-compatible localhost：external=false', async () => {
    await setSetting('aiEngine', 'openai-compatible');
    await setSetting('openaiBaseUrl', 'http://localhost:11434/v1');
    await setSetting('openaiClassifyModel', 'llama3');
    const ex = await createOrderExtractor();
    expect(ex.external).toBe(false);
  });

  // アダプターが送るバイト列と環境が返す JSON の形で、貼り付けテキストから注文が
  // 抽出される経路。プロンプトではなくデータ（貼り付けテキストそのもの）を渡す。
  test('apple-ai：runDataTask 経由で注文情報を抽出する', async () => {
    await setSetting('aiEngine', 'apple-ai');
    const appleAiRun = vi.fn(async (task: number, data: string) => {
      expect(task).toBe(2);
      expect(JSON.parse(data)).toEqual({ text: '注文内容の貼り付けテキスト' });
      return JSON.stringify({
        date: '2026-05-03',
        vendor: 'Amazon.co.jp',
        orderNumber: '',
        items: [{ description: 'USB-C ハブ', amount: '2580' }],
        totalAmount: '2580',
      });
    });
    vi.stubGlobal('window', { __aoikoNative: { appleAiRun } });

    const ex = await createOrderExtractor();
    expect(ex.external).toBe(false);
    expect(ex.destinationHost).toBe('');
    const result = await ex.extract('注文内容の貼り付けテキスト');
    expect(result.vendor).toBe('Amazon.co.jp');
    expect(result.totalAmount).toBe('2580');
    expect(result.items).toEqual([{ description: 'USB-C ハブ', amount: '2580' }]);
    expect(result.orderNumber).toBeUndefined();
  });
});
