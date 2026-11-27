import { describe, expect, test } from 'vitest';
import { isLegacyHost } from './legacy-host';

describe('isLegacyHost', () => {
  test('旧URLは大文字小文字を問わず true', () => {
    expect(isLegacyHost('aoiko.pages.dev')).toBe(true);
    expect(isLegacyHost('AOIKO.PAGES.DEV')).toBe(true);
  });

  test.each([
    'abc123.aoiko.pages.dev',
    'aoiko.lonshaus.net',
    'localhost',
    '127.0.0.1',
    'tauri.localhost',
    '',
  ])('%s は false', (hostname) => {
    expect(isLegacyHost(hostname)).toBe(false);
  });
});
