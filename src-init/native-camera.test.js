import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeCamera } from './native-camera.js';

// 生やす環境を間違えると、押しても何も起きないボタンが並ぶ。ある環境 は選択シートが
// 撮影も面倒を見るので、足すと入口が二重になる。
test('Android でだけ入口が生える', () => {
  assert.equal(typeof createNativeCamera(async () => {}, 'android')?.isCameraAvailable, 'function');
  for (const platform of ['macos', 'ios', 'windows', 'other', undefined]) {
    assert.equal(
      createNativeCamera(async () => {}, platform),
      null,
    );
  }
});

// 引数名が食い違っても型検査もテストも通ってしまい、実機で初めて落ちる。
test('命令名をそのまま渡す', async () => {
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    return true;
  };
  const camera = createNativeCamera(invoke, 'android');
  assert.equal(await camera.isCameraAvailable(), true);
  assert.deepEqual(calls, [{ cmd: 'plugin:aoiko-native|is_camera_available', args: undefined }]);
});
