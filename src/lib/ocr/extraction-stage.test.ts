import { describe, expect, test } from 'vitest';
import { ruleExtractionStage } from './extraction-stage';
import type { OcrLayout } from '../../domain/receipt-text-extract';

function layout(): OcrLayout {
  const words = [
    { text: '合計', x: 0.1, y: 0.5, width: 0.1, height: 0.02, confidence: 1 },
    { text: '1,500', x: 0.6, y: 0.5, width: 0.1, height: 0.02, confidence: 1 },
  ];
  return {
    lines: [{ text: '合計 1,500', words, x: 0.1, y: 0.5, width: 0.6, height: 0.02 }],
    text: '合計 1,500',
  };
}

describe('ruleExtractionStage', () => {
  // 版面と素のテキストでは通す抽出が違う。取り違えると座標のある側で店名が空になる。
  test('版面は版面の抽出へ通す', async () => {
    expect((await ruleExtractionStage({ layout: layout() })).totalAmount).toBe('1500');
  });

  test('素のテキストはテキストの抽出へ通す', async () => {
    expect((await ruleExtractionStage({ text: '合計 1,500円' })).totalAmount).toBe('1500');
  });

  // 抽出段は非同期の口で揃える。模型を挿すときに呼ぶ側を書き換えないため。
  test('同期の抽出でも Promise で返る', () => {
    expect(ruleExtractionStage({ text: '' })).toBeInstanceOf(Promise);
  });
});
