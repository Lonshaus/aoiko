import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiNano } from './gemini-nano.js';

test('Android でだけ入口が生える', () => {
  const nano = createGeminiNano(async () => {}, 'android');
  for (const name of ['nanoAvailability', 'nanoExtractReceipt', 'nanoRun']) {
    assert.equal(typeof nano?.[name], 'function', name);
  }
  for (const platform of ['macos', 'ios', 'windows', 'other', undefined]) {
    assert.equal(
      createGeminiNano(async () => {}, platform),
      null,
    );
  }
});
// 命令名や引数名が食い違っても型検査もテストも通ってしまい、実機で初めて落ちる。
test('命令名と引数名をそのまま渡し、結果を素通しする', async () => {
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    return cmd.endsWith('nano_availability') ? { status: 3, tokenLimit: 8192 } : '{"ok":true}';
  };
  const nano = createGeminiNano(invoke, 'android');
  assert.deepEqual(await nano.nanoAvailability(), { status: 3, tokenLimit: 8192 });
  assert.equal(await nano.nanoExtractReceipt('QUJD'), '{"ok":true}');
  assert.equal(await nano.nanoRun('classify', '{"transactions":[]}'), '{"ok":true}');
  assert.deepEqual(calls, [
    { cmd: 'plugin:aoiko-native|nano_availability', args: undefined },
    { cmd: 'plugin:aoiko-native|nano_extract_receipt', args: { imageBase64: 'QUJD' } },
    {
      cmd: 'plugin:aoiko-native|nano_run',
      args: { task: 'classify', data: '{"transactions":[]}' },
    },
  ]);
});
// 拒否コードを包み直すと、呼び出し側が理由で分岐できなくなる。
test('拒否はそのまま伝わる', async () => {
  const nano = createGeminiNano(async () => {
    throw 'background';
  }, 'android');
  await assert.rejects(nano.nanoRun('order', '{"text":""}'), (e) => e === 'background');
});
