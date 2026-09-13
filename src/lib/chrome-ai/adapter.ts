// ブラウザ内蔵 AI（LanguageModel）の包装層。web の産物にだけ入る。
//
// 推論は端末内で完結し、使用中に外部へは出ない。雲へ逃がす hybrid の SDK
// （Firebase AI Logic 等）は入れない。入れた時点で external: false が嘘になる。
import { LlmError, type LlmAdapter, type LlmImageInput } from '../../domain/llm';
import { m } from '../../paraglide/messages';
import { createChromeAiSession, type ChromeAiSession } from './availability';
import { CLASSIFY_SCHEMA } from './classify-schema';
import { ORDER_SCHEMA } from './order-schema';
import { RECEIPT_SCHEMA } from './receipt-schema';

export type ChromeAiPurpose = 'ocr' | 'classify' | 'order';

const SCHEMAS: Record<ChromeAiPurpose, unknown> = {
  ocr: RECEIPT_SCHEMA,
  classify: CLASSIFY_SCHEMA,
  order: ORDER_SCHEMA,
};

type SessionFactory = (onProgress?: (loaded: number) => void) => Promise<ChromeAiSession>;

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export class ChromeAiAdapter implements LlmAdapter {
  readonly external = false;
  readonly destinationHost = '';

  constructor(
    private readonly purpose: ChromeAiPurpose,
    private readonly openSession: SessionFactory = createChromeAiSession,
  ) {}

  async generateJson(prompt: string, image?: LlmImageInput): Promise<unknown> {
    const session = await this.openSession();
    try {
      const content: { type: string; value: unknown }[] = [{ type: 'text', value: prompt }];
      if (image) {
        content.push({ type: 'image', value: base64ToBlob(image.base64, image.mimeType) });
      }
      const input = [{ role: 'user', content }];
      // 文脈窓は入力と出力で分け合う。送ってから溢れると途中まで書いた応答が返り、
      // 欠けたまま通ってしまう。送る前に量り、収まらないなら呼ばない。
      const usage = await session.measureContextUsage(input);
      if (usage >= session.contextWindow) {
        throw new LlmError(
          this.purpose === 'ocr' ? m.error_chrome_ai_over_receipt() : m.error_chrome_ai_over_data(),
        );
      }
      const raw = await session.prompt(input, { responseConstraint: SCHEMAS[this.purpose] });
      try {
        return JSON.parse(raw);
      } catch (e) {
        throw new LlmError(m.error_chrome_ai_response_shape(), e);
      }
    } finally {
      session.destroy();
    }
  }
}
