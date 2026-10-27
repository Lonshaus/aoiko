import { describe, expect, it } from 'vitest';
import { D } from '../../lib/decimal';
import {
  stripClassificationSuffix,
  toKingaku,
  XtxAmountOutOfRangeError,
} from './xtx-mapping-shared';

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

describe('toKingaku', () => {
  it.each([
    ['1,234', '1234'],
    ['1234.9', '1234'],
    ['-1234.9', '-1234'],
    ['-0.5', '0'],
    ['000123', '123'],
    ['200000000000000', '200000000000000'],
    ['999999999999999', '999999999999999'],
    ['1e-7', '0'],
    ['+5', '5'],
    ['0x10', '16'],
    ['0x3e8', '1000'],
    ['', ''],
    ['  ', ''],
  ])('%j は %j', (v, expected) => {
    expect(toKingaku(v, 'T')).toBe(expected);
  });

  it('数値と Decimal も読む', () => {
    expect(toKingaku(5000, 'T')).toBe('5000');
    expect(toKingaku(D('123.7'), 'T')).toBe('123');
  });

  it.each([
    'NaN',
    'Infinity',
    '1e+21',
    'abc',
    '1e-5000',
    '1000000000000000',
    '-1000000000000000',
    '999999999999999.5e1',
    '1e9000000000000000',
  ])('%j は tag 付きで投げる', (v) => {
    expect(() => toKingaku(v, 'ABC00010')).toThrow(XtxAmountOutOfRangeError);
    try {
      toKingaku(v, 'ABC00010');
    } catch (e) {
      expect((e as XtxAmountOutOfRangeError).tag).toBe('ABC00010');
    }
  });

  it.each([null, undefined, {}, Number.NaN, Number.POSITIVE_INFINITY])(
    '文字列・数値以外 %j は投げる',
    (v) => {
      expect(() => toKingaku(v, 'T')).toThrow(XtxAmountOutOfRangeError);
    },
  );

  it('長い 16 進文字列は 1 秒以内に投げる', () => {
    const start = Date.now();
    expect(() => toKingaku('0x' + 'f'.repeat(200000), 'T')).toThrow(XtxAmountOutOfRangeError);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('指数が範囲外の極小値は保存済みの値の検査と同じく読めない値として 1 秒以内に投げる', () => {
    const start = Date.now();
    expect(() => toKingaku('1e-5000', 'T')).toThrow(XtxAmountOutOfRangeError);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
