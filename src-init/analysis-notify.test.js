import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnalysisNotify } from './analysis-notify.js';

test('実装のある環境でだけ入口が用意される', () => {
  for (const platform of ['macos', 'windows']) {
    assert.equal(
      typeof createAnalysisNotify(
        async () => {},
        async () => {},
        platform,
      )?.notifyAnalysis,
      'function',
    );
  }
  for (const platform of ['ios', 'other', '', undefined]) {
    assert.equal(
      createAnalysisNotify(
        async () => {},
        async () => {},
        platform,
      ),
      null,
    );
  }
});

test('5 つの命令を、列挙値とジョブの識別子だけで呼ぶ', async () => {
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    return 'granted';
  };
  const api = createAnalysisNotify(invoke, async () => {}, 'macos');
  assert.equal(await api.notificationStatus(), 'granted');
  assert.equal(await api.requestNotification(), 'granted');
  await api.notifyAnalysis('receipt', 'done', 'zh-TW');
  await api.analysisActivityBegin('tab-1');
  await api.analysisActivityEnd('tab-1');
  assert.deepEqual(calls, [
    { cmd: 'plugin:aoiko-native|notification_status', args: undefined },
    { cmd: 'plugin:aoiko-native|notification_request', args: undefined },
    {
      cmd: 'plugin:aoiko-native|analysis_notify',
      args: { kind: 'receipt', outcome: 'done', locale: 'zh-TW' },
    },
    { cmd: 'plugin:aoiko-native|analysis_activity_begin', args: { job: 'tab-1' } },
    { cmd: 'plugin:aoiko-native|analysis_activity_end', args: { job: 'tab-1' } },
  ]);
});

test('通知の命令に余計な引数は混ぜない', async () => {
  let seen;
  const api = createAnalysisNotify(
    async (_cmd, args) => {
      seen = args;
    },
    async () => {},
    'macos',
  );
  await api.notifyAnalysis('order', 'failed', 'en', { title: '金額 12,000 円', body: 'x' });
  assert.deepEqual(Object.keys(seen).sort(), ['kind', 'locale', 'outcome']);
});

test('命令の失敗はそのまま呼び出し側へ返す', async () => {
  const api = createAnalysisNotify(
    async () => {
      throw 'denied';
    },
    async () => {},
    'macos',
  );
  await assert.rejects(api.notificationStatus(), (e) => e === 'denied');
});

test('開く合図は固定のイベント名を購読し、payload だけを渡して解除関数を返す', async () => {
  const subscribed = [];
  const unlisten = () => {};
  const listen = async (event, handler) => {
    subscribed.push({ event, handler });
    return unlisten;
  };
  const api = createAnalysisNotify(async () => {}, listen, 'macos');
  const received = [];
  const result = await api.onAnalysisOpen((payload) => received.push(payload));
  assert.equal(result, unlisten);
  assert.equal(subscribed.length, 1);
  assert.equal(subscribed[0].event, 'aoiko-analysis-open');
  subscribed[0].handler({ event: 'aoiko-analysis-open', id: 1, payload: { kind: 'order' } });
  subscribed[0].handler({ payload: '/settings' });
  assert.deepEqual(received, [{ kind: 'order' }, '/settings']);
});
