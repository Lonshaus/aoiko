import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeOcr } from './native-ocr.js';
// 生やす環境を間違えると、読めない引擎が設定画面に並ぶ。設定はバックアップに乗って
// 別の端末へ渡るので、選べてしまうこと自体が事故になる。
test('Apple の環境でだけ入口が生える', () => {
  assert.equal(typeof createNativeOcr(async () => {}, 'macos')?.recognizeText, 'function');
  assert.equal(typeof createNativeOcr(async () => {}, 'ios')?.recognizeText, 'function');
  assert.equal(
    createNativeOcr(async () => {}, 'windows'),
    null,
  );
  assert.equal(
    createNativeOcr(async () => {}, 'other'),
    null,
  );
  assert.equal(
    createNativeOcr(async () => {}, undefined),
    null,
  );
});

// 引数名が食い違っても型検査もテストも通ってしまい、実機で初めて落ちる。
test('命令名と引数名をそのまま渡す', async () => {
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    return '合計 1,500円';
  };
  const ocr = createNativeOcr(invoke, 'ios');
  assert.equal(await ocr.recognizeText('QUJD'), '合計 1,500円');
  assert.deepEqual(calls, [
    { cmd: 'plugin:aoiko-native|recognize_text', args: { imageBase64: 'QUJD' } },
  ]);
});
