// 同意を求め直す版が、本文の出し分けとずれていないかを見る。ずれると、内容が
// 変わっていない側の利用者に同意を取り直させたり、逆に変わった側へ古い同意のまま
// 通してしまう。コメントだけでは次に触る人（と私）が見落とす。
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORMS, stripBuildOnly, type Platform } from './build-only';
import { DISCLAIMER_VERSION, getSetting, setSetting } from './settings';

const DOCS = ['DISCLAIMER.md', 'DISCLAIMER_en.md', 'DISCLAIMER_zh-TW.md'];
const EXPECTED_VERSION = 8;

// 定数は実行時に片側へ畳まれるため、値を見るだけでは形態ごとの版を守れない。
// 原文から読み、形態ごとの期待値を取り出す（分岐へ戻したときもここが追随する）。
function versionsFromSource(): Record<Platform, number> {
  const source = readFileSync(resolve('src/lib/settings.ts'), 'utf-8');
  const flat = /export const DISCLAIMER_VERSION = (\d+);/.exec(source);
  if (flat === null) {
    throw new Error('settings.ts から DISCLAIMER_VERSION を読めない（分岐の形が変わった？）');
  }
  const value = Number(flat[1]);
  return { browser: value, macos: value, ios: value, windows: value };
}

describe('DISCLAIMER_VERSION', () => {
  test('走っている側の版が定数と一致する', () => {
    expect(DISCLAIMER_VERSION).toBe(EXPECTED_VERSION);
  });

  test('原文から読める版も同じ', () => {
    for (const platform of PLATFORMS) {
      expect(versionsFromSource()[platform], `${platform} の版が違う`).toBe(EXPECTED_VERSION);
    }
  });
  // 生の（出し分け前の）本文には全形態の行が混ざって載っているため、生の文字列を
  // 見るだけでは畳み忘れに気付けない。形態ごとに剥がしてから行番号を見る。
  test('改訂履歴の最新行が、形態ごとの版と一致する', () => {
    const expected = versionsFromSource();
    for (const doc of DOCS) {
      const src = readFileSync(resolve(doc), 'utf-8');
      for (const platform of PLATFORMS) {
        const rows = [...stripBuildOnly(src, platform).matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) =>
          Number(m[1]),
        );
        expect(Math.max(...rows), `${doc} の ${platform} 側の最新行が版と違う`).toBe(
          expected[platform],
        );
        expect(new Set(rows).size, `${doc} の ${platform} 側に同じ番号の行が 2 つある`).toBe(
          rows.length,
        );
        expect(
          [...rows].sort((a, b) => b - a),
          `${doc} の ${platform} 側が降順でない`,
        ).toEqual(rows);
      }
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
