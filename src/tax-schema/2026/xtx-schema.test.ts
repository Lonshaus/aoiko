import { describe, expect, test } from 'vitest';
import schema from './xtx-schema.generated.json';
import type { XtxSchema } from './xtx-schema';

const typed = schema as XtxSchema;

describe('xtx-schema.generated.json (Ver23)', () => {
  test('メタ情報が令和8年分 KOA020 を指している', () => {
    expect(typed.meta.formId).toBe('KOA020');
    expect(typed.meta.namespace).toBe('shotoku');
    expect(typed.meta.version).toBe('23.0');
    expect(typed.meta.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('要素数が想定範囲（仕様書 Ver23 = 1082 行）', () => {
    expect(typed.elements.length).toBe(1082);
  });

  test('ルート要素は KOA020 で level=3', () => {
    const root = typed.elements[0];
    expect(root?.tag).toBe('KOA020');
    expect(root?.level).toBe(3);
    expect(root?.extraAttrs).toEqual(
      expect.arrayContaining(['page', 'VR', 'softNM', 'sakuseiNM', 'sakuseiDay'])
    );
  });

  test('代表的な leaf 要素（年分・申告種別・税務署名）が含まれる', () => {
    const byAttr = (name: string) =>
      typed.elements.find((e) => e.attrName === name);
    const nenbun = byAttr('NENBUN');
    expect(nenbun).toMatchObject({
      ja: '年分',
      tag: 'ABA00010',
      dataType: 'yy',
    });
    const shinkokuKbn = byAttr('SHINKOKU_KBN');
    expect(shinkokuKbn).toMatchObject({
      ja: '申告の種類',
      tag: 'ABA00020',
      dataType: 'kubun2',
    });
    const zeimusho = byAttr('ZEIMUSHO');
    expect(zeimusho).toMatchObject({
      ja: '税務署名',
      tag: 'ABA00030',
    });
  });

  test('全要素に tag が存在する', () => {
    const empty = typed.elements.filter((e) => !e.tag);
    expect(empty).toEqual([]);
  });

  test('項番は 1 から連番', () => {
    typed.elements.forEach((e, i) => {
      expect(e.no).toBe(i + 1);
    });
  });

  test('level は 3〜12 の範囲', () => {
    const outOfRange = typed.elements.filter((e) => e.level < 3 || e.level > 12);
    expect(outOfRange).toEqual([]);
  });
});