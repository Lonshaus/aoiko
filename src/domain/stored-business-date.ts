import { isValidIsoDate } from '../lib/date';

export interface StoredBusinessDate {
  value: unknown;
  valid: boolean;
}
export function readStoredBusinessDate(value: unknown): StoredBusinessDate | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return { value, valid: isValidIsoDate(value) };
}
// 保存済みの値は復元で型を検証しないため、取り出すたびに別の物になる物・配列は中身で比べる
export function sameStoredBusinessDate(a: unknown, b: unknown): boolean {
  const x = readStoredBusinessDate(a)?.value;
  const y = readStoredBusinessDate(b)?.value;
  if (typeof x === 'object' && x !== null && typeof y === 'object' && y !== null) {
    return JSON.stringify(x) === JSON.stringify(y);
  }
  return Object.is(x, y);
}
