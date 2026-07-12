// 注文ページ貼り付けテキスト → 構造化された注文情報。
// Phase 3 の方針：Chrome 拡張による DOM scraping ではなく、貼り付け＋LLM 抽出を採用。
// classify 用途の LLM Adapter を流用（テキストのみ、画像不要）。

import { buildOrderPrompt, parseOrderResponse, type OrderExtracted } from '../domain/order-extract';
import { createLlmAdapter } from './llm-adapter';

export interface OrderExtractor {
  /** 端末外へデータを送るか（送信前確認ダイアログ表示要否） */
  readonly external: boolean;
  /** 送信先ホスト（確認ダイアログ表示用） */
  readonly destinationHost: string;
  extract(pastedText: string): Promise<OrderExtracted>;
}

export async function createOrderExtractor(): Promise<OrderExtractor> {
  const adapter = await createLlmAdapter('classify');
  return {
    external: adapter.external,
    destinationHost: adapter.destinationHost,
    async extract(pastedText: string) {
      const prompt = `${buildOrderPrompt()}\n\n---\n以下が貼り付けテキスト：\n\n${pastedText}`;
      const raw = await adapter.generateJson(prompt);
      return parseOrderResponse(raw);
    },
  };
}
