// web のビルドに購入画面を含めないための門。ここが緩むと、ブラウザの console で
// window.__aoikoNative を生やすだけで購入画面を開けてしまう（実際に開けることを確認済み）。
// 実行時の判定だけでは足りないので、build 時に畳まれる __NATIVE__ を併用している。
// 出力を実際に検めるのは build が要るので、ここでは畳める形が保たれているかだけ見る。

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/routes/Settings.svelte'), 'utf8');

describe('購入画面の取り込み条件', () => {
  test('入口の判定に __NATIVE__ が入っている', () => {
    expect(source).toMatch(/const canSupport = __NATIVE__ &&/);
  });

  test('SupportDialog を静的 import していない（畳めなくなる）', () => {
    expect(source).not.toMatch(/^\s*import SupportDialog from/m);
  });

  test('SupportDialog の読み込みが __NATIVE__ の内側にある', () => {
    expect(source).toMatch(
      /__NATIVE__\s*\n?\s*\?\s*import\('\.\.\/components\/SupportDialog\.svelte'\)/,
    );
  });
});
