import { afterEach, describe, expect, test } from 'vitest';
import { updateCard } from './update-card.svelte';

afterEach(() => {
  updateCard.height = 0;
  updateCard.isShown = null;
});

describe('updateCard.offset', () => {
  test('カードが無い環境では 0', () => {
    updateCard.height = 50;
    expect(updateCard.offset).toBe(0);
  });

  test('表示中は高さを返す', () => {
    updateCard.height = 50;
    updateCard.isShown = () => true;
    expect(updateCard.offset).toBe(50);
  });

  test('閉じた後は高さが残っていても 0', () => {
    updateCard.height = 50;
    updateCard.isShown = () => false;
    expect(updateCard.offset).toBe(0);
  });
});
