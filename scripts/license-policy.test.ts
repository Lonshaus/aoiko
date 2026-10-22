import { describe, expect, it } from 'vitest';
import { ALLOWED_LICENSES, disallowedLicenses } from './license-policy';

const entry = (license: string) => ({ name: 'pkg', version: '1.0.0', license });

describe('disallowedLicenses', () => {
  it('許可済みの 6 種類はすべて通す', () => {
    expect(ALLOWED_LICENSES).toHaveLength(6);
    expect(disallowedLicenses(ALLOWED_LICENSES.map(entry))).toEqual([]);
  });

  it.each(['GPL-3.0', '', 'mit', 'MIT ', '(不明)'])('「%s」は許可外として返す', (license) => {
    expect(disallowedLicenses([entry(license)])).toEqual([entry(license)]);
  });

  it('許可外の項目だけを、名前とバージョンを保ったまま返す', () => {
    const bad = { name: 'bad-pkg', version: '2.3.4', license: 'GPL-3.0' };
    expect(disallowedLicenses([entry('MIT'), bad, entry('OFL-1.1')])).toEqual([bad]);
  });
});
