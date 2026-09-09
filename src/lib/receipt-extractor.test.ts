import { afterEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { createReceiptExtractor } from './receipt-extractor';
import { setSetting } from './settings';

afterEach(async () => {
  await db.settings.clear();
});

describe('createReceiptExtractor', () => {
  test('ai・gemini：キー無しならエラー', async () => {
    await expect(createReceiptExtractor('ai', 'tesseract')).rejects.toThrow(/Gemini API キー/);
  });

  test('ai・gemini：API キー設定済みなら external=true / 該当ホスト', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const ex = await createReceiptExtractor('ai', 'tesseract');
    expect(ex.engine).toBe('gemini');
    expect(ex.external).toBe(true);
    expect(ex.destinationHost).toBe('generativelanguage.googleapis.com');
  });

  test('ai・openai-compatible：ホスト・モデル設定で external 判定はホスト依存', async () => {
    await setSetting('aiEngine', 'openai-compatible');
    await setSetting('openaiBaseUrl', 'http://localhost:11434/v1');
    await setSetting('openaiOcrModel', 'llama3.2-vision');
    const ex = await createReceiptExtractor('ai', 'tesseract');
    expect(ex.engine).toBe('openai-compatible');
    expect(ex.external).toBe(false);
  });

  test('rule・tesseract：external=false・engine=tesseract', async () => {
    const ex = await createReceiptExtractor('rule', 'tesseract');
    expect(ex.engine).toBe('tesseract');
    expect(ex.external).toBe(false);
    expect(ex.destinationHost).toBe('');
  });

  test('rule・不明な ruleEngine：例外を投げず既定へ落ちる', async () => {
    const ex = await createReceiptExtractor('rule', 'unknown-legacy' as never);
    expect(['tesseract', 'native']).toContain(ex.engine);
  });
});
