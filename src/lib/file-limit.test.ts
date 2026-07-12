import { describe, expect, test } from 'vitest';
import {
  exceedsLimit,
  formatBytes,
  MAX_BACKUP_BYTES,
  MAX_CSV_BYTES,
  MAX_IMAGE_BYTES,
} from './file-limit';

describe('formatBytes', () => {
  test('B / KB / MB の境界', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(15 * 1024 * 1024)).toBe('15.0 MB');
  });
});

describe('exceedsLimit', () => {
  test('上限以下は false、超過は true', () => {
    expect(exceedsLimit(100, 200)).toBe(false);
    expect(exceedsLimit(200, 200)).toBe(false);
    expect(exceedsLimit(201, 200)).toBe(true);
  });

  test('各上限値の関係（画像 < CSV < バックアップ）', () => {
    expect(MAX_IMAGE_BYTES).toBeLessThan(MAX_CSV_BYTES);
    expect(MAX_CSV_BYTES).toBeLessThan(MAX_BACKUP_BYTES);
  });
});
