import { describe, expect, it } from 'vitest';
import { clampPage, pageBounds, pageCount } from './pagination';

describe('pageCount', () => {
  it('ゼロ件は1ページ扱い', () => {
    expect(pageCount(0, 500)).toBe(1);
  });
  it('ちょうどページサイズの倍数', () => {
    expect(pageCount(1000, 500)).toBe(2);
  });
  it('端数がある場合は切り上げ', () => {
    expect(pageCount(1001, 500)).toBe(3);
  });
});

describe('clampPage', () => {
  it('負の値は0に丸める', () => {
    expect(clampPage(-1, 1000, 500)).toBe(0);
  });
  it('末尾を超える値は最終ページに丸める', () => {
    expect(clampPage(99, 1000, 500)).toBe(1);
  });
  it('範囲内はそのまま', () => {
    expect(clampPage(1, 1000, 500)).toBe(1);
  });
});

describe('pageBounds', () => {
  it('ゼロ件は空区間', () => {
    expect(pageBounds(0, 500, 0)).toEqual({ start: 0, end: 0 });
  });
  it('1ページに収まる件数', () => {
    expect(pageBounds(300, 500, 0)).toEqual({ start: 0, end: 300 });
  });
  it('ページサイズちょうどの境界', () => {
    expect(pageBounds(1000, 500, 1)).toEqual({ start: 500, end: 1000 });
  });
  it('末尾を超えるページ指定は最終ページに丸めて返す', () => {
    expect(pageBounds(1000, 500, 5)).toEqual({ start: 500, end: 1000 });
  });
});
