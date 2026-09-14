import { afterEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { createLlmAdapter } from './llm-adapter';
import { setSetting } from './settings';
import { GeminiAdapter } from '../domain/llm';

afterEach(async () => {
  await db.settings.clear();
  vi.unstubAllGlobals();
});

describe('createLlmAdapter（chrome-ai、__NATIVE__=false）', () => {
  test('Gemini キー設定済みでも chrome-ai を選べば ChromeAiAdapter を返す（gemini に落ちない）', async () => {
    await setSetting('aiEngine', 'chrome-ai');
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const { ChromeAiAdapter } = await import('./chrome-ai/adapter');
    const a = await createLlmAdapter('classify');
    expect(a).toBeInstanceOf(ChromeAiAdapter);
    expect(a).not.toBeInstanceOf(GeminiAdapter);
    expect(a.external).toBe(false);
    expect(a.destinationHost).toBe('');
  });

  test('LanguageModel が無ければ生成後の呼び出しで投げる（Gemini へ落とさない）', async () => {
    await setSetting('aiEngine', 'chrome-ai');
    const a = await createLlmAdapter('classify');
    await expect(a.generateJson('p')).rejects.toThrow(/unavailable/);
  });
});
