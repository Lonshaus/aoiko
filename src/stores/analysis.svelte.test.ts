import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hasUnloadRisk } from '../router.svelte';
import { analysis } from './analysis.svelte';

function clean(): void {
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.viewing = null;
  analysis.unseen = {};
  analysis.notices = [];
}

beforeEach(() => {
  vi.useFakeTimers();
  clean();
});

afterEach(() => {
  clean();
  vi.useRealTimers();
});

describe('実行権', () => {
  test('同時に取れるのは 1 件で、2 件目は拒否される', () => {
    const first = analysis.begin('receipt');
    expect(first).not.toBeNull();
    expect(analysis.begin('order')).toBeNull();
    expect(analysis.begin('receipt')).toBeNull();
    expect(analysis.busy).toBe(true);
  });

  test('画面ごとの実行中・他画面で実行中の判定', () => {
    analysis.begin('order');
    expect(analysis.isRunning('order')).toBe(true);
    expect(analysis.isRunning('receipt')).toBe(false);
    expect(analysis.isBusyWithOther('receipt')).toBe(true);
    expect(analysis.isBusyWithOther('order')).toBe(false);
  });

  test('finish で解放され、次の 1 件を取れる', () => {
    const job = analysis.begin('receipt')!;
    analysis.finish(job, 'done');
    expect(analysis.busy).toBe(false);
    expect(analysis.begin('classify')).not.toBeNull();
  });

  test('古い job の finish は、あとから取った実行権を解放しない', () => {
    const stale = analysis.begin('receipt')!;
    analysis.finish(stale, 'cancelled');
    const current = analysis.begin('order')!;
    analysis.finish(stale, 'cancelled');
    expect(analysis.job?.id).toBe(current.id);
  });
});

describe('取消し', () => {
  test('signal を中止し、実行権は finish まで保ったまま「取消中」になる', () => {
    const job = analysis.begin('receipt')!;
    analysis.cancel();
    expect(job.controller.signal.aborted).toBe(true);
    expect(analysis.isCancelled(job)).toBe(true);
    expect(analysis.isCancelling('receipt')).toBe(true);
    expect(analysis.begin('order')).toBeNull();
    analysis.finish(job, 'cancelled');
    expect(analysis.busy).toBe(false);
  });

  test('実行中でなければ何もしない', () => {
    expect(() => analysis.cancel()).not.toThrow();
  });

  test('取消し後も job の id は変わらない', () => {
    const job = analysis.begin('order')!;
    analysis.cancel();
    expect(analysis.job?.id).toBe(job.id);
  });
});

describe('完了通知', () => {
  test('別の画面にいる間に終わると、ナビの印と toast が付く', () => {
    analysis.enter('order');
    const job = analysis.begin('receipt')!;
    analysis.finish(job, 'done');
    expect(analysis.unseen.receipt).toBe('done');
    expect(analysis.notices).toHaveLength(1);
    expect(analysis.notices[0]).toMatchObject({ kind: 'receipt', outcome: 'done' });
  });

  test('失敗も通知する', () => {
    const job = analysis.begin('classify')!;
    analysis.finish(job, 'failed');
    expect(analysis.unseen.classify).toBe('failed');
    expect(analysis.notices[0]?.outcome).toBe('failed');
  });

  test('その画面を表示している間に終わっても通知しない', () => {
    analysis.enter('receipt');
    const job = analysis.begin('receipt')!;
    analysis.finish(job, 'done');
    expect(analysis.unseen.receipt).toBeUndefined();
    expect(analysis.notices).toHaveLength(0);
  });

  test('取消しでは通知しない', () => {
    const job = analysis.begin('receipt')!;
    analysis.cancel();
    analysis.finish(job, 'cancelled');
    expect(analysis.unseen.receipt).toBeUndefined();
    expect(analysis.notices).toHaveLength(0);
  });

  test('画面に戻ると待ち状態と toast が解ける', () => {
    analysis.finish(analysis.begin('order')!, 'done');
    analysis.finish(analysis.begin('receipt')!, 'done');
    analysis.enter('order');
    expect(analysis.unseen.order).toBeUndefined();
    expect(analysis.unseen.receipt).toBe('done');
    expect(analysis.notices.map((n) => n.kind)).toEqual(['receipt']);
  });

  test('leave は自分が表示していた画面のときだけ表示中を解く', () => {
    analysis.enter('order');
    analysis.leave('receipt');
    expect(analysis.viewing).toBe('order');
    analysis.leave('order');
    expect(analysis.viewing).toBeNull();
  });

  test('toast は一定時間で消え、手動でも閉じられる。ナビの印は残る', () => {
    analysis.finish(analysis.begin('receipt')!, 'done');
    analysis.finish(analysis.begin('order')!, 'done');
    const [first] = analysis.notices;
    analysis.dismissNotice(first!.id);
    expect(analysis.notices.map((n) => n.kind)).toEqual(['order']);
    vi.advanceTimersByTime(10_000);
    expect(analysis.notices).toHaveLength(0);
    expect(analysis.unseen.receipt).toBe('done');
    expect(analysis.unseen.order).toBe('done');
  });
});

describe('タブを閉じる前の確認', () => {
  test('解析中は beforeunload の判定が真になる', () => {
    expect(hasUnloadRisk()).toBe(false);
    const job = analysis.begin('receipt')!;
    expect(hasUnloadRisk()).toBe(true);
    analysis.finish(job, 'cancelled');
    expect(hasUnloadRisk()).toBe(false);
  });
});

describe('メニューの印', () => {
  test('状態がなければ null', () => {
    expect(analysis.menuIndicator).toBeNull();
  });

  test('解析中だけなら running', () => {
    const job = analysis.begin('receipt')!;
    expect(analysis.menuIndicator).toBe('running');
    analysis.finish(job, 'cancelled');
    expect(analysis.menuIndicator).toBeNull();
  });

  test('確認待ちと解析中があれば done を優先する', () => {
    analysis.finish(analysis.begin('order')!, 'done');
    analysis.begin('receipt');
    expect(analysis.menuIndicator).toBe('done');
  });

  test('失敗と確認待ちがあれば failed を優先する', () => {
    analysis.finish(analysis.begin('order')!, 'done');
    analysis.finish(analysis.begin('classify')!, 'failed');
    expect(analysis.menuIndicator).toBe('failed');
  });

  test('画面に入って状態が消えると null に戻る', () => {
    analysis.finish(analysis.begin('order')!, 'failed');
    expect(analysis.menuIndicator).toBe('failed');
    analysis.enter('order');
    expect(analysis.menuIndicator).toBeNull();
  });
});
