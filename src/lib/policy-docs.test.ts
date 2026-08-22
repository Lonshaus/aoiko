import { describe, it, expect } from 'vitest';
import { getPolicyDoc, getLicenseText, stripLanguageNav, isExternalLink } from './policy-docs';

describe('getPolicyDoc', () => {
  it('日本語版を返す', () => {
    const content = getPolicyDoc('DISCLAIMER', 'ja');
    expect(content).toContain('免責事項');
  });

  it('繁體中文版を返す', () => {
    const content = getPolicyDoc('DISCLAIMER', 'zh-TW');
    expect(content).toContain('免責事項');
    expect(content).not.toContain('本ツールは日本の');
  });

  it('英語版を返す', () => {
    const content = getPolicyDoc('DISCLAIMER', 'en');
    expect(content).toContain('Disclaimer');
  });

  it('未知の locale は日本語版へフォールバックする', () => {
    // @ts-expect-error 実行時の防御を確認するため意図的に不正な値を渡す
    const content = getPolicyDoc('DISCLAIMER', 'fr');
    expect(content).toContain('免責事項');
  });

  it('PRIVACY / SECURITY も取得できる', () => {
    expect(getPolicyDoc('PRIVACY', 'ja').length).toBeGreaterThan(0);
    expect(getPolicyDoc('SECURITY', 'ja').length).toBeGreaterThan(0);
  });
});

describe('stripLanguageNav', () => {
  it('Language 行を除去する', () => {
    const md = '# 見出し\n\n**Language**: **日本語** | [English](x_en.md)\n\n本文';
    const out = stripLanguageNav(md);
    expect(out).not.toContain('**Language**');
    expect(out).toContain('# 見出し');
    expect(out).toContain('本文');
  });

  it('Language 行が無ければそのまま', () => {
    const md = '# 見出し\n\n本文';
    expect(stripLanguageNav(md)).toBe(md);
  });
});

describe('getLicenseText', () => {
  it('AGPL の全文を返す', () => {
    const text = getLicenseText();
    expect(text).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(text.length).toBeGreaterThan(1000);
  });
});

describe('isExternalLink', () => {
  it('http(s) は外部リンクとして扱う', () => {
    expect(isExternalLink('https://example.com')).toBe(true);
  });

  it('文書内の相対リンク（例 LICENSE）は外部リンクではない', () => {
    expect(isExternalLink('LICENSE')).toBe(false);
  });
});
