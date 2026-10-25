// 設定（aiEngine 等）から用途別の LlmAdapter を生成するファクトリ。
// Receipt（OCR）/ Import（LLM 分類）はこれ経由で adapter を得る。
// OCR は vision 対応モデル必須（openai-compatible 時）。

import { GeminiAdapter, OpenAICompatibleAdapter, type LlmAdapter } from '../domain/llm';
import { getSetting, type AiEngine } from './settings';
import { m } from '../paraglide/messages';
// order は注文取込。openai-compatible では classify と同じモデルを使うが、
// エンジンによっては渡す JSON Schema が違うため用途として分けて持つ。
type LlmPurpose = 'ocr' | 'classify' | 'order';
// アダプターを作ったときの設定値。送信前確認に出した宛先と、実際に送る先を同じ 1 回の読み出しに揃える。
export type LlmConfig =
  | { engine: 'gemini'; model: string; apiKey: string }
  | { engine: 'openai-compatible'; model: string; apiKey: string; baseUrl: string }
  | { engine: 'chrome-ai' }
  | { engine: 'apple-ai' };

export async function createLlmAdapter(purpose: LlmPurpose): Promise<LlmAdapter> {
  return (await createLlmAdapterWithConfig(purpose)).adapter;
}

export async function createLlmAdapterWithConfig(
  purpose: LlmPurpose,
): Promise<{ adapter: LlmAdapter; config: LlmConfig }> {
  const storedEngine = await getSetting('aiEngine');
  const engine: AiEngine = storedEngine === undefined ? 'gemini' : storedEngine;

  switch (engine) {
    case 'openai-compatible': {
      const baseUrl = (await getSetting('openaiBaseUrl'))?.trim();
      if (!baseUrl) {
        throw new Error(m.error_openai_base_url_unset());
      }
      // order は classify と同じモデルで読む。分類も注文取込も文字だけの経路で、
      // 利用者に別々のモデルを設定させる理由が無い。
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
      return {
        adapter: new OpenAICompatibleAdapter(baseUrl, model, apiKey),
        config: { engine, model, apiKey, baseUrl },
      };
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
      return {
        adapter: new GeminiAdapter(geminiKey, geminiModel),
        config: { engine, model: geminiModel, apiKey: geminiKey },
      };
    }
    case 'chrome-ai': {
      // apple-ai と対称。この経路を持たない側では黙って差し替えず拒否する。
      if (__NATIVE__) {
        throw new Error('chrome-ai is unavailable in this build');
      }
      const { ChromeAiAdapter } = await import('./chrome-ai/adapter');
      return { adapter: new ChromeAiAdapter(purpose), config: { engine } };
    }
    case 'apple-ai':
      // receipt-extractor.ts の apple-ai OCR 分岐と同じ理由でビルド時に畳む。
      // __NATIVE__ を持たない側のビルド成果物にはラッパーも文言も残らない。
      if (__NATIVE__) {
        const { AppleAiAdapter } = await import('./apple-ai-adapter');
        return { adapter: new AppleAiAdapter(), config: { engine } };
      }
      // native と同じ理由で、この経路を持たない側では黙って差し替えず拒否する。
      // 文言はカタログから引かない。引くと、この経路を持たない側のビルド成果物にも文字列が残る。
      throw new Error('apple-ai is unavailable in this build');
    default:
      // 設定はバックアップに乗って別の環境へ渡る。未知の値を黙って gemini に落とすと、
      // 端末内で読むつもりの利用者のデータが外へ出る。
      throw new Error(`unknown aiEngine: ${engine as string}`);
  }
}
