// 注文ページ貼り付けテキスト → 構造化された注文情報。
// Phase 3 の方針：ブラウザ拡張による DOM スクレイピングではなく、貼り付け＋LLM 抽出を採用。
// 分類用の LLM アダプターを流用（テキストのみ、画像不要）。

import { buildOrderPrompt, parseOrderResponse, type OrderExtracted } from '../domain/order-extract';
import type { LlmCallOptions } from '../domain/llm';
import { createLlmAdapterWithConfig } from './llm-adapter';
import { runOrderInRunner, runnerConfig } from './native-runner-client';

export interface OrderExtractor {
  /** 端末外へデータを送るか（送信前確認ダイアログ表示要否） */
  readonly external: boolean;
  /** 送信先ホスト（確認ダイアログ表示用） */
  readonly destinationHost: string;
  extract(pastedText: string, options?: LlmCallOptions): Promise<OrderExtracted>;
}

export async function createOrderExtractor(): Promise<OrderExtractor> {
  const { adapter, config } = await createLlmAdapterWithConfig('order');
  // web view の外で走らせる環境のための設定。送る設定はここで読んだもの（確認に出す宛先と同じ）に限る。
  const runner = runnerConfig(config);
  return {
    external: adapter.external,
    destinationHost: adapter.destinationHost,
    async extract(pastedText: string, options?: LlmCallOptions) {
      if (runner !== null) {
        return runOrderInRunner(runner, adapter.destinationHost, pastedText, options);
      }
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
