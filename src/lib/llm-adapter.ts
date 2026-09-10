// 設定（aiEngine 等）から用途別の LlmAdapter を生成するファクトリ。
// Receipt（OCR）/ Import（LLM 分類）はこれ経由で adapter を得る。
// OCR は vision 対応モデル必須（openai-compatible 時）。

import { GeminiAdapter, OpenAICompatibleAdapter, type LlmAdapter } from '../domain/llm';
import { getSetting, type AiEngine } from './settings';
import { m } from '../paraglide/messages';

type LlmPurpose = 'ocr' | 'classify';

export async function createLlmAdapter(purpose: LlmPurpose): Promise<LlmAdapter> {
  const storedEngine = await getSetting('aiEngine');
  const engine: AiEngine = storedEngine === undefined ? 'gemini' : storedEngine;

  switch (engine) {
    case 'openai-compatible': {
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
    case 'gemini': {
      const geminiKey = (await getSetting('geminiApiKey'))?.trim();
      if (!geminiKey) {
        throw new Error(m.error_gemini_key_unset());
      }
      const geminiModel = (await getSetting('geminiModel'))?.trim();
      if (!geminiModel) {
        throw new Error(m.error_gemini_model_unset());
      }
      return new GeminiAdapter(geminiKey, geminiModel);
    }
    case 'apple-ai':
      // native と同じ理由で、この経路を持たない側では黙って差し替えず拒否する。
      // 文言はカタログから引かない。引くと、この経路を持たない側の産物にも文字列が残る。
      // __NATIVE__ 側の実装差し替えは次スライス。
      throw new Error('apple-ai is unavailable in this build');
    default:
      // 設定はバックアップに乗って別の環境へ渡る。未知の値を黙って gemini に落とすと、
      // 端末内で読むつもりの利用者のデータが外へ出る。
      throw new Error(`unknown aiEngine: ${engine as string}`);
  }
}
