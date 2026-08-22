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
  // 返るのは座標付きの版面。ここは素通しなので、中身を組み替えずにそのまま渡す。
  const layout = {
    lines: [{ text: '合計 1,500円', words: [], x: 0, y: 0, width: 1, height: 0.02 }],
    text: '合計 1,500円',
  };
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    return layout;
  };
  const ocr = createNativeOcr(invoke, 'ios');
  assert.deepEqual(await ocr.recognizeText('QUJD'), layout);
  assert.deepEqual(calls, [
    { cmd: 'plugin:aoiko-native|recognize_text', args: { imageBase64: 'QUJD' } },
  ]);
});
