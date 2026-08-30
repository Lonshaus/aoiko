// 設定（ocrEngine 等）から用途別の LlmAdapter を生成するファクトリ。
// Receipt（OCR）/ Import（LLM 分類）はこれ経由で adapter を得る。
// OCR は vision 対応モデル必須（openai-compatible 時）。

import { GeminiAdapter, OpenAICompatibleAdapter, type LlmAdapter } from '../domain/llm';
import { getSetting } from './settings';
import { m } from '../paraglide/messages';

type LlmPurpose = 'ocr' | 'classify';

export async function createLlmAdapter(purpose: LlmPurpose): Promise<LlmAdapter> {
  const engine = (await getSetting('ocrEngine')) ?? 'gemini';

  if (engine === 'openai-compatible') {
    const baseUrl = (await getSetting('openaiBaseUrl'))?.trim();
    if (!baseUrl) {
      throw new Error(m.error_openai_base_url_unset());
    }
    const model =
      purpose === 'ocr'
        ? (await getSetting('openaiOcrModel'))?.trim()
        : (await getSetting('openaiClassifyModel'))?.trim();
    if (!model) {
      throw new Error(
        purpose === 'ocr'
          ? m.error_openai_ocr_model_unset()
          : m.error_openai_classify_model_unset(),
      );
    }
    const apiKey = (await getSetting('openaiApiKey')) ?? '';
    return new OpenAICompatibleAdapter(baseUrl, model, apiKey);
  }

  const geminiKey = (await getSetting('geminiApiKey'))?.trim();
  if (!geminiKey) {
    throw new Error(m.error_gemini_key_unset());
  }
  return new GeminiAdapter(geminiKey);
}
