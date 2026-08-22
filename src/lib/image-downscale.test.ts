import { describe, expect, test } from 'vitest';
import { MAX_UPLOAD_EDGE, scaledSize } from './image-downscale';

describe('scaledSize', () => {
  test('長辺が上限以下なら縮小しない（null）', () => {
    expect(scaledSize(2048, 1000, MAX_UPLOAD_EDGE)).toBeNull();
    expect(scaledSize(800, 600, MAX_UPLOAD_EDGE)).toBeNull();
  });

  test('横長は幅を上限に合わせ縦横比を保つ', () => {
    expect(scaledSize(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
  });

  test('縦長は高さを上限に合わせる（スマホの領収書撮影）', () => {
    expect(scaledSize(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  test('極端な縦横比でも 0 にならない', () => {
    const size = scaledSize(10000, 3, 2048);
    expect(size).toEqual({ width: 2048, height: 1 });
  });
});
