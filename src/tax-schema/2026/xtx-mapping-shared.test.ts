import { describe, expect, it } from 'vitest';
import { maxOccursOf, stripClassificationSuffix } from './xtx-mapping-shared';
import type { XtxSchema } from './xtx-schema';
import koa020 from './xtx-schema-koa020.generated.json';
import koa210 from './xtx-schema-koa210.generated.json';

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

describe('maxOccursOf', () => {
  it('様式 schema の maxOccurs を返す', () => {
    expect(maxOccursOf(koa020 as XtxSchema, 'ABE00010')).toBe(2);
    expect(maxOccursOf(koa210 as XtxSchema, 'AMF01600')).toBe(7);
    expect(maxOccursOf(koa210 as XtxSchema, 'AMG00465')).toBe(7);
  });

  it('unbounded は無限大として返す', () => {
    const schema = {
      refTree: [{ tag: 'X0001', maxOccurs: 'unbounded' }],
    } as unknown as XtxSchema;
    expect(maxOccursOf(schema, 'X0001')).toBe(Number.POSITIVE_INFINITY);
  });

  it('schema に無いタグは例外を投げる', () => {
    expect(() => maxOccursOf(koa020 as XtxSchema, 'ZZZ99999')).toThrow('ZZZ99999');
  });
});
