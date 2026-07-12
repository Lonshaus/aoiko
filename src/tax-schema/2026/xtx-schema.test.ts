import { describe, expect, test } from 'vitest';
import koa020 from './xtx-schema-koa020.generated.json';
import koa210 from './xtx-schema-koa210.generated.json';
import type { XtxSchema } from './xtx-schema';

const k020 = koa020 as XtxSchema;
const k210 = koa210 as XtxSchema;

describe('xtx-schema (e-tax19 XSD 由来)', () => {
  test('KOA020 メタが令和8年版・正式名前空間 URI', () => {
    expect(k020.meta.formId).toBe('KOA020');
    expect(k020.meta.version).toBe('23.0');
    expect(k020.meta.namespace).toBe('http://xml.e-tax.nta.go.jp/XSD/shotoku');
    expect(k020.meta.source).toContain('KOA020-023.xsd');
  });

  test('KOA210 メタが青色申告決算書(一般用)', () => {
    expect(k210.meta.formId).toBe('KOA210');
    expect(k210.meta.version).toBe('11.0');
    expect(k210.meta.formName).toContain('青色申告決算書');
    expect(k210.meta.namespace).toBe('http://xml.e-tax.nta.go.jp/XSD/shotoku');
  });

  test('参照側ツリー：ルートは様式要素 level=0 branch', () => {
    expect(k020.refTree[0]).toMatchObject({
      tag: 'KOA020',
      level: 0,
      kind: 'branch',
    });
    expect(k210.refTree[0]).toMatchObject({
      tag: 'KOA210',
      level: 0,
      kind: 'branch',
    });
  });

  test('KOA210 は 1〜4 ページ構造（level=1）', () => {
    const pages = k210.refTree.filter((e) => e.level === 1).map((e) => e.tag);
    expect(pages).toEqual(['KOA210-1', 'KOA210-2', 'KOA210-3', 'KOA210-4']);
  });

  test('leaf 要素は idref/refType を持ち定義側へ繋がる', () => {
    const nenbun = k020.refTree.find((e) => e.idref === 'NENBUN');
    expect(nenbun).toMatchObject({
      tag: 'ABA00010',
      ja: '年分',
      kind: 'leaf',
      refType: 'gen:NENBUNref',
    });
  });

  test('定義側カタログ（IT部）に NENBUN/ZEIMUSHO が ID 付きで存在', () => {
    const byName = (s: XtxSchema, n: string) => s.definitions.find((d) => d.name === n);
    const nenbun = byName(k020, 'NENBUN');
    expect(nenbun).toMatchObject({
      name: 'NENBUN',
      ja: '年分',
      baseType: 'gen:yy',
      hasId: true,
    });
    expect(byName(k020, 'ZEIMUSHO')?.hasId).toBe(true);
    // 定義側カタログは全様式共通（ITdefinition.xsd 由来）
    expect(k020.definitions).toEqual(k210.definitions);
  });

  test('全 leaf に refType、全 branch は idref 空', () => {
    for (const e of [...k020.refTree, ...k210.refTree]) {
      if (e.kind === 'leaf') {
        expect(e.refType).not.toBe('');
      } else {
        expect(e.idref).toBe('');
      }
    }
  });

  test('no は 1 始まり連番', () => {
    k020.refTree.forEach((e, i) => expect(e.no).toBe(i + 1));
    k210.refTree.forEach((e, i) => expect(e.no).toBe(i + 1));
  });
});
