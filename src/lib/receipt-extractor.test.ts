import { afterEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { createReceiptExtractor } from './receipt-extractor';
import { setSetting } from './settings';

afterEach(async () => {
  await db.settings.clear();
});

describe('createReceiptExtractor', () => {
  test('既定（未設定）は gemini 路で、キー無しならエラー', async () => {
    await expect(createReceiptExtractor()).rejects.toThrow(/Gemini API キー/);
  });

  test('gemini：API キー設定済みなら external=true / 該当ホスト', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const ex = await createReceiptExtractor();
    expect(ex.engine).toBe('gemini');
    expect(ex.external).toBe(true);
    expect(ex.destinationHost).toBe('generativelanguage.googleapis.com');
  });

  test('openai-compatible：ホスト・モデル設定で external 判定はホスト依存', async () => {
    await setSetting('ocrEngine', 'openai-compatible');
    await setSetting('openaiBaseUrl', 'http://localhost:11434/v1');
    await setSetting('openaiOcrModel', 'llama3.2-vision');
    const ex = await createReceiptExtractor();
    expect(ex.engine).toBe('openai-compatible');
    expect(ex.external).toBe(false);
  });

  test('apple-ai：OS 内蔵の Vision + FoundationModels 路、常に external=false', async () => {
    await setSetting('ocrEngine', 'apple-ai');
    const ex = await createReceiptExtractor();
    expect(ex.engine).toBe('apple-ai');
    expect(ex.external).toBe(false);
    expect(ex.destinationHost).toBe('');
  });

  // 選べなくなった引擎が保存に残っている端末がある。既定へ落ちないと、画面から
  // 戻せないまま OCR がその経路を走り続ける。
  test('選べなくなった引擎が残っていても gemini 路になる', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    for (const retired of ['tesseract', 'native'] as const) {
      await setSetting('ocrEngine', retired);
      const ex = await createReceiptExtractor();
      expect(ex.engine).toBe('gemini');
      expect(ex.destinationHost).toBe('generativelanguage.googleapis.com');
    }
  });
});
