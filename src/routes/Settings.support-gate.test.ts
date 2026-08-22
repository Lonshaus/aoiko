// web のビルドにネイティブ専用の画面・選択肢を含めないための門。ここが緩むと、
// ブラウザの console で window.__aoikoNative を生やすだけで開けてしまう（確認済み）。
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

describe('OS 内蔵の文字認識の選択肢', () => {
  // 関数が生えていることと、その端末が読めることは別。推測で出すと、読めない端末で
  // 選ばせてしまう（設定はバックアップに乗って別の端末へ渡る）。
  test('可否はネイティブ側へ問い合わせて決める', () => {
    expect(source).toMatch(/nativeBridge\(\)\?\.isTextRecognitionAvailable/);
  });

  test('問い合わせは __NATIVE__ の内側にある', () => {
    expect(source).toMatch(/__NATIVE__\s*\?\s*nativeBridge\(\)\?\.isTextRecognitionAvailable/);
  });

  test('返事が来るまでは出さない', () => {
    expect(source).toMatch(/let nativeOcrAvailable = \$state\(false\)/);
  });

  // 既に選ばれている状態で読めない端末へ移ったとき、選択肢ごと消すと画面から
  // 消えた理由が分からない。残したうえで使えないことを伝える。
  test('既に選ばれていれば、読めなくても選択肢は残す', () => {
    expect(source).toMatch(
      /\{#if nativeOcrAvailable \|\| ocrEngine === 'native'\}\s*\n\s*<option value="native">/,
    );
  });

  test('読めないときは案内を出す', () => {
    expect(source).toMatch(/m\.ocr_native_unavailable\(\)/);
  });
});
