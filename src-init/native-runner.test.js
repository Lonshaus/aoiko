import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeRunner } from './native-runner.js';

test('runner.js が埋め込まれた iOS のビルドにだけ入口がある', () => {
  const api = createNativeRunner(async () => {}, 'ios', true);
  assert.deepEqual(Object.keys(api).sort(), ['cancelAnalysis', 'runAnalysis', 'takeAnalysis']);
  for (const platform of ['macos', 'windows', 'other', '', undefined]) {
    assert.equal(
      createNativeRunner(async () => {}, platform, true),
      null,
      String(platform),
    );
  }
  for (const flag of [undefined, false, 'true', 1]) {
    assert.equal(
      createNativeRunner(async () => {}, 'ios', flag),
      null,
      String(flag),
    );
  }
});

test('3 つの命令を、渡された引数だけで呼ぶ', async () => {
  const calls = [];
  const api = createNativeRunner(
    async (cmd, args) => {
      calls.push({ cmd, args });
      return cmd.endsWith('_take') ? { outcome: 'cancelled' } : undefined;
    },
    'ios',
    true,
  );
  const spec = { job: 'j-1', kind: 'order', input: { text: 'x' } };
  await api.runAnalysis(spec);
  assert.deepEqual(await api.takeAnalysis('j-1'), { outcome: 'cancelled' });
  await api.cancelAnalysis('j-1');
  assert.deepEqual(calls, [
    { cmd: 'plugin:aoiko-native|analysis_runner_start', args: { spec } },
    { cmd: 'plugin:aoiko-native|analysis_runner_take', args: { job: 'j-1' } },
    { cmd: 'plugin:aoiko-native|analysis_runner_cancel', args: { job: 'j-1' } },
  ]);
  assert.equal(calls[0].args.spec, spec);
});

test('開始の拒否はそのまま呼び出し側へ返す', async () => {
  const api = createNativeRunner(
    async () => {
      throw 'disallowed-url';
    },
    'ios',
    true,
  );
  await assert.rejects(api.runAnalysis({}), (e) => e === 'disallowed-url');
});
