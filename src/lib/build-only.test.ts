import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripBuildOnly } from './build-only';

const DOC = `# 見出し

<!-- only:browser -->
ブラウザの説明
<!-- /only -->
<!-- only:native -->
そちらの説明
<!-- /only -->

末尾
`;

describe('stripBuildOnly', () => {
  test('印そのものは残さない', () => {
    expect(stripBuildOnly(DOC, false)).not.toMatch(/only:/);
    expect(stripBuildOnly(DOC, true)).not.toMatch(/only:/);
  });

  test('web のビルドには反対側の文章を残さない', () => {
    const out = stripBuildOnly(DOC, false);
    expect(out).toContain('ブラウザの説明');
    expect(out).not.toContain('そちらの説明');
  });

  test('もう一方のビルドでは逆になる', () => {
    const out = stripBuildOnly(DOC, true);
    expect(out).toContain('そちらの説明');
    expect(out).not.toContain('ブラウザの説明');
  });

  test('印の外は触らない', () => {
    expect(stripBuildOnly(DOC, false)).toContain('# 見出し');
    expect(stripBuildOnly(DOC, false)).toContain('末尾');
  });

  test('印が無ければそのまま', () => {
    const plain = '# ただの文書\n\n本文\n';
    expect(stripBuildOnly(plain, false)).toBe(plain);
  });

  // 閉じ忘れ 1 つで反対側の文章が web へ出るので、黙って通さない。
  test('閉じ忘れは例外', () => {
    expect(() => stripBuildOnly('<!-- only:browser -->\n本文\n', false, '11-backup.md')).toThrow(
      /11-backup\.md/,
    );
  });

  test('知らない種別は例外', () => {
    expect(() => stripBuildOnly('<!-- only:desktop -->\nx\n<!-- /only -->\n', false)).toThrow(
      /only:desktop/,
    );
  });

  test('同じ種別が複数あっても全部処理する', () => {
    const doc =
      '<!-- only:native -->\nA\n<!-- /only -->\nま\n<!-- only:native -->\nB\n<!-- /only -->\n';
    expect(stripBuildOnly(doc, true)).toContain('A');
    expect(stripBuildOnly(doc, true)).toContain('B');
    expect(stripBuildOnly(doc, false)).toBe('ま\n');
  });

  // 印を行の途中に書くと拾えない。気付かず通ると反対側の文章が残る。
  test('行の途中の印は認めない（例外になる）', () => {
    expect(() => stripBuildOnly('<!-- only:native -->A<!-- /only -->\n', false)).toThrow();
  });

  // 引用の中で実際に起きた。数だけ見ると釣り合うので、行頭かどうかを別に見る。
  test('引用の中に置いた印は例外（数は釣り合って見える）', () => {
    const doc = '> 本文\n> <!-- only:browser -->\n> ブラウザの話\n> <!-- /only -->\n';
    expect(() => stripBuildOnly(doc, true, '04-receipt-ocr.md')).toThrow(/04-receipt-ocr\.md:2/);
  });

  test('例外にせず素通りしていないこと（反対側に文章が残らない）', () => {
    const doc = '> 本文\n> <!-- only:browser -->\n> ブラウザの話\n> <!-- /only -->\n';
    expect(() => stripBuildOnly(doc, true)).toThrow();
  });
});

// 剥がす側が外れると、web の産物へ反対側の文章がそのまま出る。実際に剥がれることは
// ビルドしないと確かめられないので、ここでは配線が残っているかだけ見る。
describe('ビルドへの配線', () => {
  const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

  test('plugins に load フックが入っている', () => {
    expect(config).toMatch(/stripDocsForBuild\(process\.env\.AOIKO_NATIVE === '1'\)/);
  });

  test('フックが stripBuildOnly を通している', () => {
    expect(config).toMatch(/stripBuildOnly\(readFileSync\(/);
  });
});
