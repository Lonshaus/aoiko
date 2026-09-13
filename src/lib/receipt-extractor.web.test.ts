import { afterEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { createReceiptExtractor } from './receipt-extractor';
import { setSetting } from './settings';

afterEach(async () => {
  await db.settings.clear();
  vi.unstubAllGlobals();
});

describe('createReceiptExtractor（chrome-ai、__NATIVE__=false）', () => {
  test('Gemini キー設定済みでも chrome-ai を選べば external=false・downscale する（gemini に落ちない）', async () => {
    await setSetting('aiEngine', 'chrome-ai');
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const ex = await createReceiptExtractor('ai', 'tesseract');
    expect(ex.engine).toBe('chrome-ai');
    expect(ex.external).toBe(false);
    expect(ex.destinationHost).toBe('');
    expect(ex.downscale).toBe(true);
  });

  test('LanguageModel が無ければ抽出時に投げる（Gemini へ落とさない）', async () => {
    await setSetting('aiEngine', 'chrome-ai');
    const ex = await createReceiptExtractor('ai', 'tesseract');
    await expect(ex.extract({ base64: '', mimeType: 'image/jpeg' })).rejects.toThrow(/unavailable/);
  });
});
