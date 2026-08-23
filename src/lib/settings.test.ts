// 同意を求め直す版が、本文の出し分けとずれていないかを見る。ずれると、内容が
// 変わっていない側の利用者に同意を取り直させたり、逆に変わった側へ古い同意のまま
// 通してしまう。コメントだけでは次に触る人（と私）が見落とす。
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripBuildOnly } from './build-only';
import { DISCLAIMER_VERSION } from './settings';

const DOCS = ['DISCLAIMER.md', 'DISCLAIMER_en.md', 'DISCLAIMER_zh-TW.md'];
// テストは native 扱いで走る（vitest.config.ts の __NATIVE__）。
const NATIVE_VERSION = 6;
const BROWSER_VERSION = 5;

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

  test('版を分けている以上、本文にも出し分けが要る', () => {
    expect(NATIVE_VERSION).toBeGreaterThan(BROWSER_VERSION);
    for (const doc of DOCS) {
      const src = readFileSync(resolve(doc), 'utf-8');
      expect(src, `${doc} に出し分けの印が無い`).toMatch(/<!--\s*only:native\s*-->/);
    }
  });

  test('改訂履歴の行数が版の数と合う', () => {
    for (const doc of DOCS) {
      const src = readFileSync(resolve(doc), 'utf-8');
      const rows = [...src.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
      expect(Math.max(...rows), `${doc} の改訂履歴が ${NATIVE_VERSION} まで無い`).toBe(
        NATIVE_VERSION,
      );
    }
  });

  test('据え置く側の本文に、上げた版の内容が残っていない', () => {
    for (const doc of DOCS) {
      const src = readFileSync(resolve(doc), 'utf-8');
      const browser = stripBuildOnly(src, false, doc);
      const rows = [...browser.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
      expect(Math.max(...rows), `${doc} の据え置く側に v${NATIVE_VERSION} の行が残っている`).toBe(
        BROWSER_VERSION,
      );
    }
  });
});
