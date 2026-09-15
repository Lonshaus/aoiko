import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiNano } from './gemini-nano.js';

test('Android でだけ入口が生える', () => {
  assert.equal(typeof createGeminiNano(async () => {}, 'android')?.nanoAvailability, 'function');
  for (const platform of ['macos', 'ios', 'windows', 'other', undefined]) {
    assert.equal(
      createGeminiNano(async () => {}, platform),
      null,
    );
  }
});
// 命令名が食い違っても型検査もテストも通ってしまい、実機で初めて落ちる。
test('命令名をそのまま渡し、結果を素通しする', async () => {
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    return { status: 3, tokenLimit: 8192 };
  };
  const nano = createGeminiNano(invoke, 'android');
  assert.deepEqual(await nano.nanoAvailability(), { status: 3, tokenLimit: 8192 });
  assert.deepEqual(calls, [{ cmd: 'plugin:aoiko-native|nano_availability', args: undefined }]);
});
