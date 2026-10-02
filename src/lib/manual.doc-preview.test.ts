// dev server の開発用プレビューが localStorage の選択に応じて実際に畳まれるかを見る。
// eager glob はモジュール読み込み時に評価されるため、localStorage を仕込んでから
// vi.resetModules() で動的 import し直す必要がある。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOC_PREVIEW_STORAGE_KEY } from './doc-preview';
import { stripBuildOnly } from './build-only';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  localStorage.clear();
});

describe('文書プレビュー：localStorage の選択に応じて畳まれる', () => {
  test('macos: apple 限定句が出て only: の印は残らない', async () => {
    localStorage.setItem(DOC_PREVIEW_STORAGE_KEY, 'macos');
    const { getManualContent } = await import('./manual');
    const { getPolicyDoc } = await import('./policy-docs');
    const receiptOcr = getManualContent('04-receipt-ocr', 'ja');
    expect(receiptOcr).toContain('無し（aoiko が対応する OS では常に使える）');
    expect(receiptOcr).not.toMatch(/<!--\s*only:/);
    const privacy = getPolicyDoc('PRIVACY', 'ja');
    expect(privacy).toContain('Apple Intelligence');
    expect(privacy).not.toContain('OPFS');
  });

  test('windows: windows 限定句が出る', async () => {
    localStorage.setItem(DOC_PREVIEW_STORAGE_KEY, 'windows');
    const { getManualContent } = await import('./manual');
    const receiptOcr = getManualContent('04-receipt-ocr', 'ja');
    expect(receiptOcr).toContain('対応端末のみ。領収書 OCR 画面を開くたびに自動判定');
  });

  test('未設定: __DOC_PLATFORM__（browser）で畳んだ結果と一致する', async () => {
    const { getManualContent } = await import('./manual');
    const { getPolicyDoc } = await import('./policy-docs');
    const diskReceiptOcr = readFileSync(resolve('docs/manual/04-receipt-ocr.md'), 'utf-8');
    expect(getManualContent('04-receipt-ocr', 'ja')).toBe(
      stripBuildOnly(diskReceiptOcr, 'browser', '04-receipt-ocr.md'),
    );
    const diskPrivacy = readFileSync(resolve('PRIVACY.md'), 'utf-8');
    const foldedPrivacy = stripBuildOnly(diskPrivacy, 'browser', 'PRIVACY.md');
    expect(getPolicyDoc('PRIVACY', 'ja')).toBe(
      foldedPrivacy.replace(/^\*\*Language\*\*:.*$\n?/m, ''),
    );
  });
});
