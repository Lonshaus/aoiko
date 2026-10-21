import { describeLlmError, isAbortError } from '../domain/llm';
import type { OrderExtracted, OrderItem } from '../domain/order-extract';
import { createOrderExtractor, type OrderExtractor } from '../lib/order-extractor';
import { registerUnloadCheck } from '../router.svelte';
import { m } from '../paraglide/messages';
import { analysis } from './analysis.svelte';
import { ledger } from './ledger.svelte';

export type ReviewItem = OrderItem & { accountCode: string; taxRate: number; rateTouched: boolean };

export interface PreparedOrder {
  extractor: OrderExtractor;
  text: string;
  host: string;
}
// 貼り付けた本文と解析結果は確定か明示的な破棄まで DB に無い。画面を離れても失わないよう
// コンポーネントではなくここに持つ。
class OrderDraft {
  pastedText = $state('');
  extracted = $state<OrderExtracted | null>(null);
  reviewItems = $state<ReviewItem[]>([]);
  paymentAccount = $state('2120'); // 未払金（クレカ既定）
  error = $state('');
  success = $state('');

  get dirty(): boolean {
    return this.pastedText !== '' || this.extracted !== null;
  }
  // 解析中（取消し待ちを含む）は本文を変えさせない。結果が別の本文のものになってしまう。
  get locked(): boolean {
    return analysis.isRunning('order');
  }

  setPastedText(value: string): boolean {
    if (this.locked) {
      return false;
    }
    this.pastedText = value;
    return true;
  }
  // 既定の経費科目 = 消耗品費（5200）。無ければ最初の expense を使う
  defaultExpenseAccount(): string {
    for (const g of ledger.groupedAccounts()) {
      if (g.category === 'expense') {
        for (const a of g.items) {
          if (a.code === '5200') {
            return '5200';
          }
        }
        if (g.items[0]) {
          return g.items[0].code;
        }
      }
    }
    return '5910'; // fallback: 雑費
  }

  async prepare(): Promise<PreparedOrder | null> {
    if (analysis.busy) {
      return null;
    }
    if (!this.pastedText.trim()) {
      this.error = m.order_text_required();
      return null;
    }
    this.error = '';
    this.success = '';
    const text = this.pastedText;
    try {
      const extractor = await createOrderExtractor();
      return { extractor, text, host: extractor.destinationHost };
    } catch (e) {
      this.error = describeLlmError(e);
      return null;
    }
  }

  async run(prepared: PreparedOrder): Promise<void> {
    if (prepared.text !== this.pastedText) {
      return;
    }
    const job = analysis.begin('order');
    if (job === null) {
      this.error = m.analysis_busy_other();
      return;
    }
    let outcome: 'done' | 'failed' | 'cancelled' = 'cancelled';
    try {
      const result = await prepared.extractor.extract(prepared.text, {
        signal: job.controller.signal,
      });
      if (!analysis.isCancelled(job) && prepared.text === this.pastedText) {
        const def = this.defaultExpenseAccount();
        this.extracted = result;
        this.reviewItems = result.items.map((it) => ({
          ...it,
          accountCode: def,
          taxRate: 0.1,
          rateTouched: false,
        }));
        outcome = 'done';
      }
    } catch (e) {
      if (!analysis.isCancelled(job) && !isAbortError(e)) {
        outcome = 'failed';
        if (prepared.text === this.pastedText) {
          this.error = describeLlmError(e);
        }
      }
    } finally {
      analysis.finish(job, outcome);
    }
  }

  reset(): void {
    if (analysis.isRunning('order')) {
      analysis.cancel();
    }
    this.extracted = null;
    this.reviewItems = [];
    this.pastedText = '';
    this.error = '';
  }
}

export const orderDraft = new OrderDraft();
registerUnloadCheck(() => orderDraft.dirty);
