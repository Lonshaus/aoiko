import { describe, expect, it } from 'vitest';
import { stripClassificationSuffix } from './xtx-mapping-shared';

describe('stripClassificationSuffix', () => {
  it('末尾の全角括弧付き分類を取り除く', () => {
    expect(stripClassificationSuffix('貸倒引当金繰入額（個別評価）')).toBe('貸倒引当金繰入額');
    expect(stripClassificationSuffix('貸倒引当金繰入額（一括評価）')).toBe('貸倒引当金繰入額');
    expect(stripClassificationSuffix('専従者給与（不動産）')).toBe('専従者給与');
  });

  it('括弧が末尾に無い科目名はそのまま返す', () => {
    expect(stripClassificationSuffix('固定資産除却損')).toBe('固定資産除却損');
    expect(stripClassificationSuffix('')).toBe('');
  });
  // 「（製品）」のように途中にある括弧は分類ではなく科目名の一部なので残す。
  it('末尾以外の括弧は残す', () => {
    expect(stripClassificationSuffix('期首商品（製品）棚卸高')).toBe('期首商品（製品）棚卸高');
    expect(stripClassificationSuffix('仕入金額（製品製造原価）内訳')).toBe(
      '仕入金額（製品製造原価）内訳',
    );
  });
  // 入れ子は [^（）] で弾く。半角括弧は様式側の分類表記に使われないため対象外。
  it('入れ子の括弧・半角括弧は取り除かない', () => {
    expect(stripClassificationSuffix('科目（外（内））')).toBe('科目（外（内））');
    expect(stripClassificationSuffix('科目(個別評価)')).toBe('科目(個別評価)');
  });

  it('括弧だけの名前は空文字になる', () => {
    expect(stripClassificationSuffix('（個別評価）')).toBe('');
  });
});
