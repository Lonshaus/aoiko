import { describe, expect, test } from 'vitest';
import { readStoredFiler, readTaxPlaceKind } from './filer-fields';

const base = {
  userRiyoshaId: '1234567890123456',
  userFilerName: '青色 太郎',
  userFilerZip: '1000001',
  userFilerAddress: '東京都千代田区1-1',
  userZeimushoCode: '01101',
  userZeimushoName: '麹町',
  userBusinessName: '青色商店',
  userInvoiceNumber: 'T1234567890123',
};

describe('納税地の区分の読み取り', () => {
  test.each([
    ['domicile', 'domicile'],
    ['abode', 'abode'],
    ['businessPlace', 'businessPlace'],
    [undefined, 'domicile'],
    [null, 'domicile'],
  ])('%j は %s として読む', (raw, expected) => {
    expect(readTaxPlaceKind(raw)).toBe(expected);
  });

  test.each(['', 'residence', 'Domicile', 1, {}, []])('%j は読めない値', (raw) => {
    expect(readTaxPlaceKind(raw)).toBeUndefined();
  });
});

describe('納税地・住所・事業所所在地の読み取り', () => {
  test('新しいキーが無い保存値は住所地として読み、欠けも不正もない', () => {
    const r = readStoredFiler(base);
    expect(r.filer.taxPlaceKind).toBe('domicile');
    expect(r.filer.address).toBe('東京都千代田区1-1');
    expect(r.filer.domicileAddress).toBe('');
    expect(r.filer.businessPlaceAddress).toBe('');
    expect(r.missing).toBe(false);
    expect(r.invalid).toBe(false);
  });

  test.each(['abode', 'businessPlace'] as const)('区分が %s で住所があれば揃っている', (kind) => {
    const r = readStoredFiler({
      ...base,
      userFilerTaxPlaceKind: kind,
      userFilerDomicileAddress: '大阪府大阪市1-1',
      userFilerBusinessPlaceAddress: '京都府京都市1-1',
    });
    expect(r.filer.taxPlaceKind).toBe(kind);
    expect(r.filer.domicileAddress).toBe('大阪府大阪市1-1');
    expect(r.filer.businessPlaceAddress).toBe('京都府京都市1-1');
    expect(r.missing).toBe(false);
    expect(r.invalid).toBe(false);
  });

  test.each(['abode', 'businessPlace'] as const)('区分が %s で住所が空なら missing', (kind) => {
    expect(readStoredFiler({ ...base, userFilerTaxPlaceKind: kind }).missing).toBe(true);
    expect(
      readStoredFiler({ ...base, userFilerTaxPlaceKind: kind, userFilerDomicileAddress: '' })
        .missing,
    ).toBe(true);
  });

  test('区分が住所地なら住所が空でも missing にしない', () => {
    const r = readStoredFiler({
      ...base,
      userFilerTaxPlaceKind: 'domicile',
      userFilerDomicileAddress: '',
    });
    expect(r.missing).toBe(false);
  });

  test('区分が三つの値以外なら invalid で、住所地として扱う', () => {
    const r = readStoredFiler({ ...base, userFilerTaxPlaceKind: 'residence' });
    expect(r.invalid).toBe(true);
    expect(r.filer.taxPlaceKind).toBe('domicile');
  });

  test.each([
    ['オブジェクトの住所', { userFilerDomicileAddress: {} }],
    ['オブジェクトの事業所所在地', { userFilerBusinessPlaceAddress: [] }],
  ])('%s は invalid', (_label, overrides) => {
    expect(readStoredFiler({ ...base, ...overrides }).invalid).toBe(true);
  });

  test('数値の住所・事業所所在地は文字列にして読む', () => {
    const r = readStoredFiler({
      ...base,
      userFilerTaxPlaceKind: 'abode',
      userFilerDomicileAddress: 123,
      userFilerBusinessPlaceAddress: 456,
    });
    expect(r.invalid).toBe(false);
    expect(r.filer.domicileAddress).toBe('123');
    expect(r.filer.businessPlaceAddress).toBe('456');
  });
});
