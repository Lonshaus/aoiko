// 同意を求め直す版が、本文の出し分けとずれていないかを見る。ずれると、内容が
// 変わっていない側の利用者に同意を取り直させたり、逆に変わった側へ古い同意のまま
// 通してしまう。コメントだけでは次に触る人（と私）が見落とす。
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripBuildOnly } from './build-only';
import { DISCLAIMER_VERSION, getSetting, setSetting } from './settings';

const DOCS = ['DISCLAIMER.md', 'DISCLAIMER_en.md', 'DISCLAIMER_zh-TW.md'];
// テストは native 扱いで走る（vitest.config.ts の __NATIVE__）。
const NATIVE_VERSION = 6;
const BROWSER_VERSION = 7;

describe('DISCLAIMER_VERSION', () => {
  test('走っている側の版が定数と一致する', () => {
    expect(DISCLAIMER_VERSION).toBe(NATIVE_VERSION);
  });
  // 試験は片側でしか走らないため、値を見るだけでは分岐そのものを守れない。
  // 分岐を畳んで両方を同じ版にしても、この試験以外は全部通ってしまう。
  test('版は build 時の分岐で決まる（実行時の値だけでは守れない）', () => {
    const source = readFileSync(resolve('src/lib/settings.ts'), 'utf-8');
    expect(source).toContain(
      `DISCLAIMER_VERSION = __NATIVE__ ? ${NATIVE_VERSION} : ${BROWSER_VERSION}`,
    );
  });

  // native と browser は互いに独立したカウンタで、どちらも「自分の側の本文を
  // 最後に変えた版」を指す。片方が進んでももう片方の値は導けない・揃う理由も無い。
  test('版を分けている以上、本文にも出し分けが要る', () => {
    expect(NATIVE_VERSION, '両側は独立したカウンタ。同じ値になる理由は無い').not.toBe(
      BROWSER_VERSION,
    );
    for (const doc of DOCS) {
      const src = readFileSync(resolve(doc), 'utf-8');
      expect(src, `${doc} に native 側の出し分けの印が無い`).toMatch(/<!--\s*only:native\s*-->/);
      expect(src, `${doc} に browser 側の出し分けの印が無い`).toMatch(/<!--\s*only:browser\s*-->/);
    }
  });

  // native 側だけ見て改訂履歴が NATIVE_VERSION まで、browser 側だけ見て
  // BROWSER_VERSION までであることを確認する。生の（出し分け前の）本文には
  // 両方の行が混ざって載っているため、生の文字列を見るだけでは分岐の畳み忘れに
  // 気付けない。
  test('改訂履歴の行数が、それぞれの側だけ見たときの版の数と合う', () => {
    for (const doc of DOCS) {
      const src = readFileSync(resolve(doc), 'utf-8');
      const native = stripBuildOnly(src, true, doc);
      const nativeRows = [...native.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
      expect(
        Math.max(...nativeRows),
        `${doc} の native 側改訂履歴が ${NATIVE_VERSION} まで無い`,
      ).toBe(NATIVE_VERSION);

      const browser = stripBuildOnly(src, false, doc);
      const browserRows = [...browser.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
      expect(
        Math.max(...browserRows),
        `${doc} の browser 側改訂履歴が ${BROWSER_VERSION} まで無い`,
      ).toBe(BROWSER_VERSION);
    }
  });
});

// 判定はファクトリ側に一本化した。getSetting は素通しでないと、
// ここで既定へ落としたつもりが実は素通しという食い違いに気付けない。
describe('getSetting は加工しない', () => {
  test('選べなくなった値もそのまま返す', async () => {
    for (const retired of ['tesseract', 'native'] as const) {
      await setSetting('aiEngine', retired as never);
      expect(await getSetting('aiEngine')).toBe(retired);
    }
  });

  test('現行の値もそのまま返る', async () => {
    for (const engine of ['gemini', 'openai-compatible', 'apple-ai'] as const) {
      await setSetting('aiEngine', engine);
      expect(await getSetting('aiEngine')).toBe(engine);
    }
  });
});
