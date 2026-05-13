import { describe, expect, test } from 'vitest';
import {
  SMALL_ASSET_ANNUAL_CAP,
  SMALL_ASSET_EXPIRY,
  isSmallAssetEligible,
  smallAssetThreshold,
} from './limits';

describe('smallAssetThreshold', () => {
  test('2026-03-31 以前取得は 300_000', () => {
    expect(smallAssetThreshold('2025-12-31')).toBe(300_000);
    expect(smallAssetThreshold('2026-01-01')).toBe(300_000);
    expect(smallAssetThreshold('2026-03-31')).toBe(300_000);
  });

  test('2026-04-01 以降取得は 400_000', () => {
    expect(smallAssetThreshold('2026-04-01')).toBe(400_000);
    expect(smallAssetThreshold('2026-04-02')).toBe(400_000);
    expect(smallAssetThreshold('2028-12-31')).toBe(400_000);
  });
});

describe('isSmallAssetEligible', () => {
  test('閾値未満なら true（境界：30 万）', () => {
    expect(isSmallAssetEligible('2026-03-31', '299999')).toBe(true);
    expect(isSmallAssetEligible('2026-03-31', '300000')).toBe(false);
  });

  test('閾値未満なら true（境界：40 万）', () => {
    expect(isSmallAssetEligible('2026-04-01', '399999')).toBe(true);
    expect(isSmallAssetEligible('2026-04-01', '400000')).toBe(false);
  });

  test('適用期限後は常に false', () => {
    expect(SMALL_ASSET_EXPIRY).toBe('2029-03-31');
    expect(isSmallAssetEligible('2029-04-01', '100000')).toBe(false);
    expect(isSmallAssetEligible('2030-01-01', '50000')).toBe(false);
  });

  test('無効な価額（負・NaN）は false', () => {
    expect(isSmallAssetEligible('2026-04-01', '-1')).toBe(false);
    expect(isSmallAssetEligible('2026-04-01', 'abc')).toBe(false);
  });
});

describe('SMALL_ASSET_ANNUAL_CAP', () => {
  test('300 万円据置', () => {
    expect(SMALL_ASSET_ANNUAL_CAP).toBe(3_000_000);
  });
});