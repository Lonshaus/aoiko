import { afterEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { createLlmAdapter } from './llm-adapter';
import { setSetting } from './settings';
import { GeminiAdapter, OpenAICompatibleAdapter } from '../domain/llm';

afterEach(async () => {
  await db.settings.clear();
});

describe('createLlmAdapter', () => {
  test('既定（未設定）は gemini、キー無しでエラー', async () => {
    await expect(createLlmAdapter('ocr')).rejects.toThrow(/Gemini API キー/);
  });

  test('gemini：キー有りで GeminiAdapter', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    const a = await createLlmAdapter('ocr');
    expect(a).toBeInstanceOf(GeminiAdapter);
    expect(a.external).toBe(true);
  });

  test('openai-compatible：用途別モデルで OpenAICompatibleAdapter', async () => {
    await setSetting('ocrEngine', 'openai-compatible');
    await setSetting('openaiBaseUrl', 'http://localhost:11434/v1');
    await setSetting('openaiOcrModel', 'llama3.2-vision');
    await setSetting('openaiClassifyModel', 'llama3');
    const ocr = await createLlmAdapter('ocr');
    const cls = await createLlmAdapter('classify');
    expect(ocr).toBeInstanceOf(OpenAICompatibleAdapter);
    expect(ocr.external).toBe(false);
    expect(cls).toBeInstanceOf(OpenAICompatibleAdapter);
  });

  test('openai-compatible：baseURL 未設定でエラー', async () => {
    await setSetting('ocrEngine', 'openai-compatible');
    await expect(createLlmAdapter('ocr')).rejects.toThrow(/baseURL/);
  });

  test('openai-compatible：OCR モデル未選択でエラー', async () => {
    await setSetting('ocrEngine', 'openai-compatible');
    await setSetting('openaiBaseUrl', 'http://localhost:11434/v1');
    await expect(createLlmAdapter('ocr')).rejects.toThrow(/OCR 用モデル/);
  });
});
