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
    const ex = await createReceiptExtractor();
    expect(ex.engine).toBe('gemini');
    expect(ex.external).toBe(true);
    expect(ex.destinationHost).toBe('generativelanguage.googleapis.com');
  });

  test('openai-compatible：ホスト・モデル設定で external 判定はホスト依存', async () => {
    await setSetting('ocrEngine', 'openai-compatible');
    await setSetting('openaiBaseUrl', 'http://localhost:11434/v1');
    await setSetting('openaiOcrModel', 'moondream');
    const ex = await createReceiptExtractor();
    expect(ex.engine).toBe('openai-compatible');
    expect(ex.external).toBe(false);
  });

  test('tesseract：external=false / host 空 / engine ラベル', async () => {
    await setSetting('ocrEngine', 'tesseract');
    const ex = await createReceiptExtractor();
    expect(ex.engine).toBe('tesseract');
    expect(ex.external).toBe(false);
    expect(ex.destinationHost).toBe('');
  });

  test('tesseract：openai 設定が無くてもエラーにならない', async () => {
    await setSetting('ocrEngine', 'tesseract');
    await expect(createReceiptExtractor()).resolves.toBeDefined();
  });
});
