import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORMS, stripBuildOnly } from './build-only';

const DOC = `# 見出し

<!-- only:browser -->
ブラウザの説明
<!-- /only -->
<!-- only:native -->
そちらの説明
<!-- /only -->
<!-- only:apple -->
Apple の説明
<!-- /only -->
<!-- only:windows -->
Windows の説明
<!-- /only -->
<!-- only:android -->
Android の説明
<!-- /only -->

末尾
`;

describe('stripBuildOnly', () => {
  test('印そのものは残さない', () => {
    for (const platform of PLATFORMS) {
      expect(stripBuildOnly(DOC, platform)).not.toMatch(/only:/);
    }
  });
  // 形態ごとに読む種別の集合。取り違えると反対側の文章がその形態のビルド成果物へ出る。
  test('形態ごとに自分の種別だけ残る', () => {
    const kept = {
      browser: ['ブラウザの説明'],
      macos: ['そちらの説明', 'Apple の説明'],
      ios: ['そちらの説明', 'Apple の説明'],
      windows: ['そちらの説明', 'Windows の説明'],
      android: ['そちらの説明', 'Android の説明'],
    };
    const all = [
      'ブラウザの説明',
      'そちらの説明',
      'Apple の説明',
      'Windows の説明',
      'Android の説明',
    ];
    for (const platform of PLATFORMS) {
      const out = stripBuildOnly(DOC, platform);
      for (const text of all) {
        if (kept[platform].includes(text)) {
          expect(out, `${platform} に ${text} が無い`).toContain(text);
        } else {
          expect(out, `${platform} に ${text} が残っている`).not.toContain(text);
        }
      }
    }
  });

  test('印の外は触らない', () => {
    expect(stripBuildOnly(DOC, 'browser')).toContain('# 見出し');
    expect(stripBuildOnly(DOC, 'browser')).toContain('末尾');
  });

  test('印が無ければそのまま', () => {
    const plain = '# ただの文書\n\n本文\n';
    expect(stripBuildOnly(plain, 'browser')).toBe(plain);
  });
  // 閉じ忘れ 1 つで反対側の文章が web へ出るので、黙って通さない。
  test('閉じ忘れは例外', () => {
    expect(() =>
      stripBuildOnly('<!-- only:browser -->\n本文\n', 'browser', '11-backup.md'),
    ).toThrow(/11-backup\.md/);
  });

  test('知らない種別は例外', () => {
    expect(() => stripBuildOnly('<!-- only:desktop -->\nx\n<!-- /only -->\n', 'browser')).toThrow(
      /only:desktop/,
    );
  });

  test('同じ種別が複数あっても全部処理する', () => {
    const doc =
      '<!-- only:native -->\nA\n<!-- /only -->\nま\n<!-- only:native -->\nB\n<!-- /only -->\n';
    expect(stripBuildOnly(doc, 'macos')).toContain('A');
    expect(stripBuildOnly(doc, 'macos')).toContain('B');
    expect(stripBuildOnly(doc, 'browser')).toBe('ま\n');
  });
  // 印を行の途中に書くと拾えない。気付かず通ると反対側の文章が残る。
  test('行の途中の印は認めない（例外になる）', () => {
    expect(() => stripBuildOnly('<!-- only:native -->A<!-- /only -->\n', 'browser')).toThrow();
  });
  // 引用の中で実際に起きた。数だけ見ると釣り合うので、行頭かどうかを別に見る。
  test('引用の中に置いた印は例外（数は釣り合って見える）', () => {
    const doc = '> 本文\n> <!-- only:browser -->\n> ブラウザの話\n> <!-- /only -->\n';
    expect(() => stripBuildOnly(doc, 'macos', '04-receipt-ocr.md')).toThrow(/04-receipt-ocr\.md:2/);
  });

  test('例外にせず素通りしていないこと（反対側に文章が残らない）', () => {
    const doc = '> 本文\n> <!-- only:browser -->\n> ブラウザの話\n> <!-- /only -->\n';
    expect(() => stripBuildOnly(doc, 'macos')).toThrow();
  });
});
// apple の中でさらに絞る macos / ios。取り違えると、片方にしか当てはまらない記述が
// もう片方のビルド成果物にも出てしまう。
describe('stripBuildOnly（macos / ios）', () => {
  const DOC_APPLE_SPLIT = [
    '<!-- only:apple -->',
    'Apple 共通の説明',
    '<!-- /only -->',
    '<!-- only:macos -->',
    'macOS だけの説明',
    '<!-- /only -->',
    '<!-- only:ios -->',
    'iOS だけの説明',
    '<!-- /only -->',
    '',
  ].join('\n');

  test('macos は apple 共通と macos 限定だけ読み、ios 限定は読まない', () => {
    const out = stripBuildOnly(DOC_APPLE_SPLIT, 'macos');
    expect(out).toContain('Apple 共通の説明');
    expect(out).toContain('macOS だけの説明');
    expect(out).not.toContain('iOS だけの説明');
  });

  test('ios は apple 共通と ios 限定だけ読み、macos 限定は読まない', () => {
    const out = stripBuildOnly(DOC_APPLE_SPLIT, 'ios');
    expect(out).toContain('Apple 共通の説明');
    expect(out).toContain('iOS だけの説明');
    expect(out).not.toContain('macOS だけの説明');
  });

  test('apple 共通の説明は macos / ios の両方に届く（windows / android には届かない）', () => {
    for (const platform of ['windows', 'android'] as const) {
      const out = stripBuildOnly(DOC_APPLE_SPLIT, platform);
      expect(out).not.toContain('Apple 共通の説明');
      expect(out).not.toContain('macOS だけの説明');
      expect(out).not.toContain('iOS だけの説明');
    }
  });

  test('知らない種別 only:macios は例外', () => {
    expect(() => stripBuildOnly('<!-- only:macios -->\nx\n<!-- /only -->\n', 'macos')).toThrow(
      /only:macios/,
    );
  });
});
// 剥がす側が外れると、web のビルド成果物へ反対側の文章がそのまま出る。実際に剥がれることは
// ビルドしないと確かめられないので、ここでは配線が残っているかだけ見る。
describe('ビルドへの配線', () => {
  const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

  test('plugins に load フックが入っている', () => {
    expect(config).toMatch(/stripDocsForBuild\(buildPlatform\(\)\)/);
  });

  test('フックが stripBuildOnly を通している', () => {
    expect(config).toMatch(/stripBuildOnly\(readFileSync\(/);
  });
  // 不正な値を browser に落とすと、ネイティブ版のビルド成果物へ web 向けの文章が入る。
  test('形態が不正なら落とさず例外にする', () => {
    expect(config).toMatch(/AOIKO_PLATFORM が不正です/);
  });
});
