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

  // 選択肢ごと消すと、選べない理由が画面のどこにも出ないまま消える。読める端末かどうかで
  // 出し分けるのではなく、この引擎を持つビルドなら常に出し、選んだ時点で可否を伝える。
  test('読めない端末でも選択肢は出す', () => {
    expect(source).toMatch(/\{#if __NATIVE__\}\s*\n\s*<option value="native">/);
  });

  test('可否で選択肢を出し分けていない', () => {
    expect(source).not.toMatch(/\{#if nativeOcrAvailable[^}]*\}\s*\n\s*<option value="native">/);
  });

  // 案内も設定の説明も、この引擎を持たない側の産物には要らない。ocrEngine だけで
  // 判定すると実行時の分岐になり、文言が残る（実際に残っていた）。
  test('案内の一式が __NATIVE__ の内側にある', () => {
    expect(source).toMatch(/\{#if __NATIVE__ && ocrEngine === 'native'\}/);
  });

  test('読めないときは案内を出す', () => {
    expect(source).toMatch(/\{:else\}[\s\S]{0,200}?m\.ocr_native_unavailable\(\)/);
  });
});
