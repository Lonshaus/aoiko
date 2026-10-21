import { fileToBase64, type ReceiptExtracted } from '../domain/ocr';
import { describeLlmError, isAbortError, type LlmImageInput } from '../domain/llm';
import { downscaleForUpload } from '../lib/image-downscale';
import { createReceiptExtractor, type ReceiptExtractor } from '../lib/receipt-extractor';
import type { ReceiptMethod, ReceiptRuleEngine } from '../lib/settings';
import { registerUnloadCheck } from '../router.svelte';
import { m } from '../paraglide/messages';
import { analysis } from './analysis.svelte';

export interface PreparedReceipt {
  extractor: ReceiptExtractor;
  image: LlmImageInput;
  file: File;
  host: string;
}
// 画像・抽出結果・選択科目は確定か明示的な破棄まで DB に無い。画面を離れても失わないよう
// コンポーネントではなくここに持つ。
class ReceiptDraft {
  file = $state.raw<File | null>(null);
  preview = $state<string | null>(null);
  extracted = $state<ReceiptExtracted | null>(null);
  counterpartAccount = $state('5910'); // 既定は雑費
  knownAccount = $state('1110'); // 既定は現金
  lastEngine = $state<ReceiptExtractor['engine'] | null>(null);
  error = $state('');
  success = $state('');

  get dirty(): boolean {
    return this.file !== null || this.extracted !== null;
  }
  // 解析中（取消し待ちを含む）は画像を差し替えさせない。抽出結果と原本画像が食い違うと、
  // 証憑として保存する画像が読み取った画像でなくなる。
  get locked(): boolean {
    return analysis.isRunning('receipt');
  }

  stageFile(f: File): boolean {
    if (this.locked) {
      return false;
    }
    this.file = f;
    this.extracted = null;
    this.error = '';
    this.success = '';
    if (this.preview) {
      URL.revokeObjectURL(this.preview);
    }
    this.preview = URL.createObjectURL(f);
    return true;
  }

  async prepare(
    method: ReceiptMethod,
    ruleEngine: ReceiptRuleEngine,
  ): Promise<PreparedReceipt | null> {
    const file = this.file;
    if (file === null || analysis.busy) {
      return null;
    }
    this.error = '';
    try {
      const extractor = await createReceiptExtractor(method, ruleEngine);
      // 縮小の要否はエンジンが決める。クラウドは通信量、ブラウザ内蔵の AI はコンテキストウィンドウが理由で、
      // 端末内かどうかとは別の軸になる。
      const source = extractor.downscale ? await downscaleForUpload(file) : file;
      const image = await fileToBase64(source);
      return { extractor, image, file, host: extractor.destinationHost };
    } catch (e) {
      if (this.file === file) {
        this.error = describeLlmError(e);
      }
      return null;
    }
  }

  async run(prepared: PreparedReceipt): Promise<void> {
    if (prepared.file !== this.file) {
      return;
    }
    const job = analysis.begin('receipt');
    if (job === null) {
      this.error = m.analysis_busy_other();
      return;
    }
    this.error = '';
    this.success = '';
    let outcome: 'done' | 'failed' | 'cancelled' = 'cancelled';
    try {
      const result = await prepared.extractor.extract(prepared.image, {
        signal: job.controller.signal,
      });
      // 取消し後・画像の差し替え後に戻った結果は、別の画像のものとして書かない。
      if (!analysis.isCancelled(job) && prepared.file === this.file) {
        this.extracted = result;
        this.lastEngine = prepared.extractor.engine;
        outcome = 'done';
      }
    } catch (e) {
      if (!analysis.isCancelled(job) && !isAbortError(e)) {
        outcome = 'failed';
        if (prepared.file === this.file) {
          this.error = describeLlmError(e);
        }
      }
    } finally {
      analysis.finish(job, outcome);
    }
  }
  // 確定後。成功メッセージだけ残して、画像と結果を片付ける。
  completeCommit(successMessage: string): void {
    this.success = successMessage;
    this.clear();
  }

  reset(): void {
    if (analysis.isRunning('receipt')) {
      analysis.cancel();
    }
    this.lastEngine = null;
    this.error = '';
    this.success = '';
    this.clear();
  }

  private clear(): void {
    this.extracted = null;
    this.file = null;
    if (this.preview) {
      URL.revokeObjectURL(this.preview);
      this.preview = null;
    }
  }
}

export const receiptDraft = new ReceiptDraft();
registerUnloadCheck(() => receiptDraft.dirty);
