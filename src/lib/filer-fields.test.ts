import { describe, expect, test } from 'vitest';
import {
  isFilerZipInvalid,
  isRiyoshaIdInvalid,
  normalizeFilerZip,
  normalizeRiyoshaId,
  readStoredFiler,
} from './filer-fields';

describe('利用者識別番号', () => {
  test.each([
    '',
    '   ',
    '1234567890123456',
    '１２３４５６７８９０１２３４５６',
    '　1234567890123456　',
  ])('%j は空または 16 桁の数字なので正しい', (raw) => {
    expect(isRiyoshaIdInvalid(raw)).toBe(false);
  });

  test.each([
    '123456789012345',
    '12345678901234567',
    '123456789012345a',
    '1234 5678 9012 3456',
    '１２３４',
  ])('%j は誤り', (raw) => {
    expect(isRiyoshaIdInvalid(raw)).toBe(true);
  });

  test('全角は半角に、前後の空白は除く', () => {
    expect(normalizeRiyoshaId('　１２３４　')).toBe('1234');
  });
});

describe('郵便番号', () => {
  test.each(['', '〒', '1234567', '123-4567', '〒１２３ー４５６７', '１２３－４５６７'])(
    '%j は空または 7 桁の数字なので正しい',
    (raw) => {
      expect(isFilerZipInvalid(raw)).toBe(false);
    },
  );

  test.each(['123', '123-456', '12345678', '１２３'])('%j は誤り', (raw) => {
    expect(isFilerZipInvalid(raw)).toBe(true);
  });

  test('数字以外を除いた形に揃える', () => {
    expect(normalizeFilerZip('〒１２３ー４５６７')).toBe('1234567');
  });
});

describe('保存済みの申告者情報の読み取り', () => {
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

  test('正しい値はそのまま読み、未記入も不正もない', () => {
    const r = readStoredFiler(base);
    expect(r.invalid).toBe(false);
    expect(r.missing).toBe(false);
    expect(r.filer.zip).toBe('1000001');
  });

  test('数値の郵便番号・氏名・屋号は文字列にして読む', () => {
    const r = readStoredFiler({
      ...base,
      userFilerZip: 1000001,
      userFilerName: 123,
      userBusinessName: 123,
    });
    expect(r.invalid).toBe(false);
    expect(r.filer.zip).toBe('1000001');
    expect(r.filer.name).toBe('123');
    expect(r.businessName).toBe('123');
  });

  test.each([
    ['数値の利用者識別番号', { userRiyoshaId: 1234567890123456 }],
    ['安全な整数を超える利用者識別番号', { userRiyoshaId: 9007199254740993 }],
    ['物の郵便番号', { userFilerZip: {} }],
    ['物の住所', { userFilerAddress: {} }],
    ['物の利用者識別番号', { userRiyoshaId: {} }],
    ['登録の無い税務署コード', { userZeimushoCode: '1101' }],
    ['数値の税務署コード', { userZeimushoCode: 1101 }],
    ['物の登録番号', { userInvoiceNumber: [] }],
  ])('%s は invalid', (_label, overrides) => {
    expect(readStoredFiler({ ...base, ...overrides }).invalid).toBe(true);
  });

  test('任意の郵便番号・屋号・登録番号が未設定でも invalid にしない', () => {
    const r = readStoredFiler({
      ...base,
      userFilerZip: undefined,
      userBusinessName: undefined,
      userInvoiceNumber: undefined,
    });
    expect(r.invalid).toBe(false);
    expect(r.missing).toBe(false);
  });

  test('非文字列の値を渡しても投げない', () => {
    expect(() => isRiyoshaIdInvalid(1234567890123456)).not.toThrow();
    expect(isRiyoshaIdInvalid(1234567890123456)).toBe(true);
    expect(isFilerZipInvalid(1000001)).toBe(false);
    expect(normalizeFilerZip({})).toBe('');
  });
});
