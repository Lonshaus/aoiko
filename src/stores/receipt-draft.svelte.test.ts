import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReceiptExtracted } from '../domain/ocr';
import type { LlmCallOptions } from '../domain/llm';
import { hasUnloadRisk } from '../router.svelte';

type Extract = (image: unknown, options?: LlmCallOptions) => Promise<ReceiptExtracted>;

const { extractorRef } = vi.hoisted(() => ({
  extractorRef: { extract: null as unknown as Extract },
}));

vi.mock('../lib/receipt-extractor', () => ({
  createReceiptExtractor: async () => ({
    external: false,
    destinationHost: '',
    downscale: false,
    engine: 'gemini',
    extract: (image: unknown, options?: LlmCallOptions) => extractorRef.extract(image, options),
  }),
}));

const { receiptDraft } = await import('./receipt-draft.svelte');
const { analysis } = await import('./analysis.svelte');

const RESULT: ReceiptExtracted = {
  date: '2026-05-01',
  vendorName: 'テスト商店',
  totalAmount: '2000',
  items: [],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function image(name = 'a.png'): File {
  return new File(['x'], name, { type: 'image/png' });
}

function abortable(): { extract: Extract; calls: number } {
  const state = { extract: null as unknown as Extract, calls: 0 };
  state.extract = (_image, options) => {
    state.calls += 1;
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    });
  };
  return state;
}

beforeEach(() => {
  extractorRef.extract = async () => RESULT;
});

afterEach(() => {
  receiptDraft.reset();
  receiptDraft.success = '';
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.viewing = null;
  analysis.unseen = {};
  analysis.notices = [];
});

async function start(file = image()) {
  receiptDraft.stageFile(file);
  const prepared = await receiptDraft.prepare('ai', 'tesseract');
  expect(prepared).not.toBeNull();
  return prepared!;
}

describe('状態の保持', () => {
  test('stageFile で画像とプレビューを持ち、結果と選択科目が残る', async () => {
    receiptDraft.counterpartAccount = '5200';
    const prepared = await start();
    await receiptDraft.run(prepared);
    expect(receiptDraft.file).toBe(prepared.file);
    expect(receiptDraft.preview).not.toBeNull();
    expect(receiptDraft.extracted).toEqual(RESULT);
    expect(receiptDraft.lastEngine).toBe('gemini');
    expect(receiptDraft.counterpartAccount).toBe('5200');
    receiptDraft.counterpartAccount = '5910';
  });

  test('reset で画像・プレビュー・結果を消し、プレビューの URL を解放する', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await receiptDraft.run(await start());
    const preview = receiptDraft.preview;
    receiptDraft.reset();
    expect(receiptDraft.file).toBeNull();
    expect(receiptDraft.extracted).toBeNull();
    expect(receiptDraft.preview).toBeNull();
    expect(revoke).toHaveBeenCalledWith(preview);
    revoke.mockRestore();
  });

  test('completeCommit は成功メッセージだけを残して片付ける', async () => {
    await receiptDraft.run(await start());
    receiptDraft.completeCommit('保存しました');
    expect(receiptDraft.success).toBe('保存しました');
    expect(receiptDraft.file).toBeNull();
    expect(receiptDraft.extracted).toBeNull();
    expect(receiptDraft.dirty).toBe(false);
  });

  test('beforeunload の判定は画像または結果があるときに真になる', async () => {
    expect(hasUnloadRisk()).toBe(false);
    receiptDraft.stageFile(image());
    expect(hasUnloadRisk()).toBe(true);
    receiptDraft.reset();
    expect(hasUnloadRisk()).toBe(false);
  });
});

describe('実行権', () => {
  test('解析中は 2 件目の準備も実行も断られる', async () => {
    const gate = deferred<ReceiptExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = receiptDraft.run(await start());
    expect(analysis.isRunning('receipt')).toBe(true);
    expect(await receiptDraft.prepare('ai', 'tesseract')).toBeNull();
    gate.resolve(RESULT);
    await running;
    expect(analysis.busy).toBe(false);
  });

  test('他画面の解析中は始められず、メッセージが出る', async () => {
    const prepared = await start();
    const other = analysis.begin('order')!;
    await receiptDraft.run(prepared);
    expect(receiptDraft.extracted).toBeNull();
    expect(receiptDraft.error).not.toBe('');
    analysis.finish(other, 'cancelled');
  });

  test('完了すると実行権を手放し、別画面にいれば待ち状態と通知が付く', async () => {
    await receiptDraft.run(await start());
    expect(analysis.busy).toBe(false);
    expect(analysis.unseen.receipt).toBe('done');
    expect(analysis.notices).toHaveLength(1);
  });

  test('失敗するとエラーを持ち、失敗として通知する', async () => {
    extractorRef.extract = async () => {
      throw new Error('boom');
    };
    await receiptDraft.run(await start());
    expect(receiptDraft.error).toBe('boom');
    expect(receiptDraft.extracted).toBeNull();
    expect(analysis.busy).toBe(false);
    expect(analysis.unseen.receipt).toBe('failed');
  });
});

describe('取消し', () => {
  test('中止できる経路は reject の時点で実行権を手放し、エラーは出さない', async () => {
    const engine = abortable();
    extractorRef.extract = engine.extract;
    const running = receiptDraft.run(await start());
    analysis.cancel();
    expect(analysis.isCancelling('receipt')).toBe(true);
    await running;
    expect(analysis.busy).toBe(false);
    expect(receiptDraft.extracted).toBeNull();
    expect(receiptDraft.error).toBe('');
    expect(analysis.notices).toHaveLength(0);
  });

  test('中止できない経路は元の Promise が終わるまで「取消中」と実行権を保つ', async () => {
    const gate = deferred<ReceiptExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = receiptDraft.run(await start());
    analysis.cancel();
    await Promise.resolve();
    expect(analysis.isCancelling('receipt')).toBe(true);
    expect(analysis.begin('order')).toBeNull();
    gate.resolve(RESULT);
    await running;
    expect(analysis.busy).toBe(false);
  });

  test('取消し後に戻った結果は書き込まれない', async () => {
    const gate = deferred<ReceiptExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = receiptDraft.run(await start());
    analysis.cancel();
    gate.resolve(RESULT);
    await running;
    expect(receiptDraft.extracted).toBeNull();
    expect(receiptDraft.lastEngine).toBeNull();
    expect(analysis.unseen.receipt).toBeUndefined();
  });

  test('取消し後に戻った失敗もエラーとして出さない', async () => {
    const gate = deferred<ReceiptExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = receiptDraft.run(await start());
    analysis.cancel();
    gate.reject(new Error('late failure'));
    await running;
    expect(receiptDraft.error).toBe('');
  });

  test('解析中の reset は解析を取り消し、結果を書かない', async () => {
    const gate = deferred<ReceiptExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = receiptDraft.run(await start());
    receiptDraft.reset();
    expect(analysis.isCancelling('receipt')).toBe(true);
    gate.resolve(RESULT);
    await running;
    expect(receiptDraft.extracted).toBeNull();
    expect(receiptDraft.file).toBeNull();
  });
});

describe('入力の保護', () => {
  test('解析中は画像の差し替えを store が拒否する', async () => {
    const gate = deferred<ReceiptExtracted>();
    extractorRef.extract = () => gate.promise;
    const first = image('first.png');
    const running = receiptDraft.run(await start(first));
    expect(receiptDraft.locked).toBe(true);
    expect(receiptDraft.stageFile(image('second.png'))).toBe(false);
    expect(receiptDraft.file).toBe(first);
    gate.resolve(RESULT);
    await running;
    expect(receiptDraft.locked).toBe(false);
    expect(receiptDraft.stageFile(image('second.png'))).toBe(true);
  });

  test('取消し待ちの間も画像の差し替えを拒否する', async () => {
    const gate = deferred<ReceiptExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = receiptDraft.run(await start());
    analysis.cancel();
    expect(receiptDraft.stageFile(image('second.png'))).toBe(false);
    gate.resolve(RESULT);
    await running;
  });

  test('ロックを迂回して file を書き換えても、古い解析の結果は書き込まれない', async () => {
    const gate = deferred<ReceiptExtracted>();
    extractorRef.extract = () => gate.promise;
    const running = receiptDraft.run(await start(image('first.png')));
    const other = image('second.png');
    receiptDraft.file = other;
    gate.resolve(RESULT);
    await running;
    expect(receiptDraft.file).toBe(other);
    expect(receiptDraft.extracted).toBeNull();
    expect(analysis.busy).toBe(false);
  });

  test('準備のあとで画像が変わっていたら実行を始めない', async () => {
    const prepared = await start(image('first.png'));
    receiptDraft.file = image('second.png');
    await receiptDraft.run(prepared);
    expect(analysis.busy).toBe(false);
    expect(receiptDraft.extracted).toBeNull();
  });
});
