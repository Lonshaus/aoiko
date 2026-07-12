// 設定（ocrEngine 等）から用途別の LlmAdapter を生成するファクトリ。
// Receipt（OCR）/ Import（LLM 分類）はこれ経由で adapter を得る。
// OCR は vision 対応モデル必須（openai-compatible 時）。

import { GeminiAdapter, OpenAICompatibleAdapter, type LlmAdapter } from '../domain/llm';
import { getSetting } from './settings';

export type LlmPurpose = 'ocr' | 'classify';

export async function createLlmAdapter(purpose: LlmPurpose): Promise<LlmAdapter> {
  const engine = (await getSetting('ocrEngine')) ?? 'gemini';

  if (engine === 'openai-compatible') {
    const baseUrl = (await getSetting('openaiBaseUrl'))?.trim();
    if (!baseUrl) {
      throw new Error(
        'OpenAI 互換エンドポイント（baseURL）が未設定です。設定画面で入力してください',
      );
    }
    const model =
      purpose === 'ocr'
        ? (await getSetting('openaiOcrModel'))?.trim()
        : (await getSetting('openaiClassifyModel'))?.trim();
    if (!model) {
      throw new Error(
        purpose === 'ocr'
          ? 'OCR 用モデル（vision 対応必須）が未選択です。設定画面で選択してください'
          : 'LLM 分類用モデルが未選択です。設定画面で選択してください',
      );
    }
    const apiKey = (await getSetting('openaiApiKey')) ?? '';
    return new OpenAICompatibleAdapter(baseUrl, model, apiKey);
  }

  const geminiKey = (await getSetting('geminiApiKey'))?.trim();
  if (!geminiKey) {
    throw new Error('Gemini API キーが未設定です。設定画面で入力してください');
  }
  return new GeminiAdapter(geminiKey);
}
