import { describe, expect, test, vi } from 'vitest';
import { ChromeAiAdapter, type ChromeAiPurpose } from './adapter';
import type { ChromeAiSession } from './availability';
import { CLASSIFY_SCHEMA } from './classify-schema';
import { ORDER_SCHEMA } from './order-schema';
import { RECEIPT_SCHEMA } from './receipt-schema';

function stubSession(overrides: Partial<ChromeAiSession> = {}): ChromeAiSession {
  return {
    contextWindow: 1000,
    measureContextUsage: async () => 0,
    prompt: async () => '{}',
    destroy: vi.fn(),
    ...overrides,
  };
}

describe('ChromeAiAdapter.generateJson', () => {
  test('文脈窓を超える見込みなら prompt を呼ばずに投げる', async () => {
    const prompt = vi.fn(async () => '{}');
    const session = stubSession({
      contextWindow: 100,
      measureContextUsage: async () => 100,
      prompt,
    });
    const adapter = new ChromeAiAdapter('ocr', async () => session);
    await expect(adapter.generateJson('p')).rejects.toThrow();
    expect(prompt).not.toHaveBeenCalled();
  });

  test('収まる見込みなら prompt を 1 回だけ呼ぶ', async () => {
    const prompt = vi.fn(async () => '{}');
    const session = stubSession({
      contextWindow: 100,
      measureContextUsage: async () => 99,
      prompt,
    });
    const adapter = new ChromeAiAdapter('ocr', async () => session);
    await adapter.generateJson('p');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  const cases: [ChromeAiPurpose, unknown][] = [
    ['ocr', RECEIPT_SCHEMA],
    ['classify', CLASSIFY_SCHEMA],
    ['order', ORDER_SCHEMA],
  ];
  for (const [purpose, schema] of cases) {
    test(`用途 ${purpose} は対応する schema を渡す（他用途の schema とは別物）`, async () => {
      const prompt = vi.fn(
        async (_input?: unknown, _options?: { responseConstraint?: unknown }) => '{}',
      );
      const session = stubSession({ prompt });
      const adapter = new ChromeAiAdapter(purpose, async () => session);
      await adapter.generateJson('p');
      const options = prompt.mock.calls[0]?.[1] as { responseConstraint?: unknown };
      expect(options.responseConstraint).toBe(schema);
      for (const [otherPurpose, otherSchema] of cases) {
        if (otherPurpose !== purpose) {
          expect(options.responseConstraint).not.toBe(otherSchema);
        }
      }
    });
  }

  test('応答を JSON.parse して返す', async () => {
    const session = stubSession({ prompt: async () => '{"a":1}' });
    const adapter = new ChromeAiAdapter('order', async () => session);
    await expect(adapter.generateJson('p')).resolves.toEqual({ a: 1 });
  });

  test('使い終わったら session を破棄する', async () => {
    const destroy = vi.fn();
    const session = stubSession({ destroy });
    const adapter = new ChromeAiAdapter('order', async () => session);
    await adapter.generateJson('p');
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
