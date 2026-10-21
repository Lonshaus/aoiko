// 注文ページ貼り付けテキスト → 構造化された注文情報。
// Phase 3 の方針：ブラウザ拡張による DOM スクレイピングではなく、貼り付け＋LLM 抽出を採用。
// 分類用の LLM アダプターを流用（テキストのみ、画像不要）。

import { buildOrderPrompt, parseOrderResponse, type OrderExtracted } from '../domain/order-extract';
import type { LlmCallOptions } from '../domain/llm';
import { createLlmAdapter } from './llm-adapter';

export interface OrderExtractor {
  /** 端末外へデータを送るか（送信前確認ダイアログ表示要否） */
  readonly external: boolean;
  /** 送信先ホスト（確認ダイアログ表示用） */
  readonly destinationHost: string;
  extract(pastedText: string, options?: LlmCallOptions): Promise<OrderExtracted>;
}

export async function createOrderExtractor(): Promise<OrderExtractor> {
  const adapter = await createLlmAdapter('order');
  return {
    external: adapter.external,
    destinationHost: adapter.destinationHost,
    async extract(pastedText: string, options?: LlmCallOptions) {
      const raw = adapter.runDataTask
        ? await adapter.runDataTask('order', { text: pastedText }, options)
        : await adapter.generateJson(
            `${buildOrderPrompt()}\n\n---\n以下が貼り付けテキスト：\n\n${pastedText}`,
            undefined,
            options,
          );
      return parseOrderResponse(raw);
    },
  };
}
