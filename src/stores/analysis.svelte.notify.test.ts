import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';

vi.mock('../lib/analysis-notify', () => ({
  analysisNotifyPermission: vi.fn(),
  notifyAnalysisDone: vi.fn(),
}));

const { analysisNotifyPermission, notifyAnalysisDone } = await import('../lib/analysis-notify');
const { analysis } = await import('./analysis.svelte');

const permissionMock = vi.mocked(analysisNotifyPermission);
const notifyMock = vi.mocked(notifyAnalysisDone);

function setAway(hidden: boolean, focused: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
}
// 通知の判定は設定の読み出しを挟む非同期。呼ばれないことの確認は、その分だけ待ってから行う。
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function clean(): void {
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  analysis.viewing = null;
  analysis.unseen = {};
  analysis.notices = [];
}

beforeEach(async () => {
  await db.settings.clear();
  permissionMock.mockReset().mockResolvedValue('granted');
  notifyMock.mockReset().mockResolvedValue(undefined);
  await setSetting('analysisNotifyEnabled', true);
  setAway(true, false);
  clean();
});

afterEach(async () => {
  clean();
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(document, 'hasFocus');
  await db.settings.clear();
});

describe('離れている間の完了を OS の通知で知らせる', () => {
  test('解析した画面を表示したままタブが隠れても通知する。画面内の印と toast は従来どおり付かない', async () => {
    analysis.enter('receipt');
    const job = analysis.begin('receipt')!;
    analysis.finish(job, 'done');
    await vi.waitFor(() => expect(notifyMock).toHaveBeenCalledWith('receipt', 'done'));
    expect(analysis.unseen.receipt).toBeUndefined();
    expect(analysis.notices).toHaveLength(0);
  });

  test('失敗も通知する', async () => {
    analysis.enter('receipt');
    analysis.finish(analysis.begin('receipt')!, 'failed');
    await vi.waitFor(() => expect(notifyMock).toHaveBeenCalledWith('receipt', 'failed'));
    expect(analysis.unseen.receipt).toBeUndefined();
  });

  test('ウィンドウが見えていても、フォーカスが無ければ通知する', async () => {
    setAway(false, false);
    analysis.enter('order');
    analysis.finish(analysis.begin('order')!, 'done');
    await vi.waitFor(() => expect(notifyMock).toHaveBeenCalledWith('order', 'done'));
  });

  test('別の画面を表示している間に終わっても通知し、印と toast も従来どおり付く', async () => {
    analysis.enter('order');
    analysis.finish(analysis.begin('receipt')!, 'done');
    await vi.waitFor(() => expect(notifyMock).toHaveBeenCalledWith('receipt', 'done'));
    expect(analysis.unseen.receipt).toBe('done');
    expect(analysis.notices).toHaveLength(1);
    expect(analysis.notices[0]).toMatchObject({ kind: 'receipt', outcome: 'done' });
  });

  test('渡すのは種別と結果だけ', async () => {
    analysis.finish(analysis.begin('classify')!, 'done');
    await vi.waitFor(() => expect(notifyMock).toHaveBeenCalledTimes(1));
    expect(notifyMock.mock.calls[0]).toEqual(['classify', 'done']);
  });
});

describe('通知しない条件', () => {
  test('見えていてフォーカスもあるときは通知しない', async () => {
    setAway(false, true);
    analysis.finish(analysis.begin('receipt')!, 'done');
    await settle();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  test('設定がオフなら通知しない', async () => {
    await setSetting('analysisNotifyEnabled', false);
    analysis.finish(analysis.begin('receipt')!, 'done');
    await settle();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  test('設定が無ければ通知しない', async () => {
    await db.settings.clear();
    analysis.finish(analysis.begin('receipt')!, 'done');
    await settle();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  test.each(['denied', 'default', 'unsupported'] as const)(
    '実際の許可が %s なら、設定がオンでも通知しない',
    async (permission) => {
      permissionMock.mockResolvedValue(permission);
      analysis.finish(analysis.begin('receipt')!, 'done');
      await settle();
      expect(notifyMock).not.toHaveBeenCalled();
    },
  );

  test('取消しでは通知しない', async () => {
    const job = analysis.begin('receipt')!;
    analysis.cancel();
    analysis.finish(job, 'cancelled');
    await settle();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  test('通知の送出が失敗しても finish は例外を出さず、実行権は解放される', async () => {
    notifyMock.mockRejectedValue(new Error('x'));
    const job = analysis.begin('receipt')!;
    expect(() => analysis.finish(job, 'done')).not.toThrow();
    await settle();
    expect(analysis.busy).toBe(false);
  });
});
