import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAppleAi } from './apple-ai.js';
// 実装の無い環境で生やすと、設定画面に選べない選択肢が出る。
test('実装のある環境でだけ入口が生える', () => {
  for (const platform of ['macos', 'ios']) {
    assert.equal(typeof createAppleAi(async () => {}, platform)?.appleAiAvailability, 'function');
  }
  assert.equal(
    createAppleAi(async () => {}, 'windows'),
    null,
  );
  assert.equal(
    createAppleAi(async () => {}, 'other'),
    null,
  );
});

test('命令名と引数名をそのまま渡す', async () => {
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    return cmd.endsWith('apple_ai_availability') ? 0 : '{"vendor":"店"}';
  };
  const ai = createAppleAi(invoke, 'macos');
  assert.equal(await ai.appleAiAvailability(), 0);
  assert.equal(await ai.appleAiExtract('QUJD'), '{"vendor":"店"}');
  assert.equal(await ai.appleAiRun(1, '{"transactions":[]}'), '{"vendor":"店"}');
  assert.deepEqual(calls, [
    { cmd: 'plugin:aoiko-native|apple_ai_availability', args: undefined },
    { cmd: 'plugin:aoiko-native|apple_ai_extract', args: { imageBase64: 'QUJD' } },
    {
      cmd: 'plugin:aoiko-native|apple_ai_run',
      args: { task: 1, data: '{"transactions":[]}' },
    },
  ]);
});
