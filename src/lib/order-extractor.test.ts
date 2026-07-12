import { afterEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { createOrderExtractor } from './order-extractor';
import { setSetting } from './settings';

afterEach(async () => {
  await db.settings.clear();
});

describe('createOrderExtractor', () => {
  test('既定（gemini）：API キー無しならエラー', async () => {
    await expect(createOrderExtractor()).rejects.toThrow(/Gemini API キー/);
  });

  test('gemini：キー有りで external=true / 該当ホスト', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    const ex = await createOrderExtractor();
    expect(ex.external).toBe(true);
    expect(ex.destinationHost).toBe('generativelanguage.googleapis.com');
  });

  test('openai-compatible localhost：external=false', async () => {
    await setSetting('ocrEngine', 'openai-compatible');
    await setSetting('openaiBaseUrl', 'http://localhost:11434/v1');
    await setSetting('openaiClassifyModel', 'llama3');
    const ex = await createOrderExtractor();
    expect(ex.external).toBe(false);
  });

  test('tesseract 選択時でも classify Adapter が要求されるため tesseract は無関係', async () => {
    // ocrEngine=tesseract は OCR 路のみ。classify は依然として LLM が必要なため
    // gemini キー or openai 設定どちらかが必須
    await setSetting('ocrEngine', 'tesseract');
    await expect(createOrderExtractor()).rejects.toThrow(/Gemini API キー/);
  });
});
