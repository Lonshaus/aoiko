import { afterEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { createLlmAdapter } from './llm-adapter';
import { setSetting } from './settings';
import { GeminiAdapter, OpenAICompatibleAdapter } from '../domain/llm';
import { AppleAiAdapter } from './apple-ai-adapter';

afterEach(async () => {
  await db.settings.clear();
});

describe('createLlmAdapter', () => {
  test('既定（未設定）は gemini、キー無しでエラー', async () => {
    await expect(createLlmAdapter('ocr')).rejects.toThrow(/Gemini API キー/);
  });

  test('gemini：キー有りで GeminiAdapter', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const a = await createLlmAdapter('ocr');
    expect(a).toBeInstanceOf(GeminiAdapter);
    expect(a.external).toBe(true);
  });

  test('gemini：モデル未設定はエラー', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    await expect(createLlmAdapter('ocr')).rejects.toThrow(/モデル/);
  });

  test('openai-compatible：用途別モデルで OpenAICompatibleAdapter', async () => {
    await setSetting('aiEngine', 'openai-compatible');
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
    await setSetting('aiEngine', 'openai-compatible');
    await expect(createLlmAdapter('ocr')).rejects.toThrow(/baseURL/);
  });

  test('openai-compatible：OCR モデル未選択でエラー', async () => {
    await setSetting('aiEngine', 'openai-compatible');
    await setSetting('openaiBaseUrl', 'http://localhost:11434/v1');
    await expect(createLlmAdapter('ocr')).rejects.toThrow(/OCR 用モデル/);
  });

  // apple-ai は端末内完結の経路。__NATIVE__（テスト全体で true）では AppleAiAdapter を返し、
  // Gemini キーが設定済みでも黙ってクラウドへ差し替えない。
  test('apple-ai：__NATIVE__ では AppleAiAdapter を返す（Gemini キー設定済みでも gemini に落ちない）', async () => {
    await setSetting('aiEngine', 'apple-ai');
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    const a = await createLlmAdapter('classify');
    expect(a).toBeInstanceOf(AppleAiAdapter);
    expect(a.external).toBe(false);
    expect(a.destinationHost).toBe('');
  });

  // 設定はバックアップに乗って別の環境へ渡る。選べなくなった値・未知の値を
  // 黙って gemini に落とすと、端末内で読むつもりの利用者のデータが外へ出る。
  test('未知の aiEngine：Gemini キー設定済みでも拒否する（gemini に落ちない）', async () => {
    await setSetting('geminiApiKey', 'sk-test');
    await setSetting('geminiModel', 'gemini-2.5-flash');
    for (const retired of ['tesseract', 'native', 'unknown-legacy'] as const) {
      await setSetting('aiEngine', retired as never);
      await expect(createLlmAdapter('ocr')).rejects.toThrow();
    }
  });
});
