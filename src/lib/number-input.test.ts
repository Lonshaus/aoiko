import { describe, expect, it, vi } from 'vitest';
import { assignInputNumber, assignInputString } from './number-input';

function fireInput(
  value: string,
  handler: (e: Event & { currentTarget: HTMLInputElement }) => void,
) {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = value;
  input.addEventListener('input', handler as EventListener);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('assignInputString', () => {
  it('代入する', () => {
    const assign = vi.fn();
    fireInput('123', assignInputString(assign));
    expect(assign).toHaveBeenCalledWith('123');
  });
});

describe('assignInputNumber', () => {
  it('数値入力で代入する', () => {
    const assign = vi.fn();
    fireInput('42', assignInputNumber(assign));
    expect(assign).toHaveBeenCalledWith(42);
  });

  it('空欄では代入しない', () => {
    const assign = vi.fn();
    fireInput('', assignInputNumber(assign));
    expect(assign).not.toHaveBeenCalled();
  });

  it('不正入力では代入しない', () => {
    const assign = vi.fn();
    fireInput('abc', assignInputNumber(assign));
    expect(assign).not.toHaveBeenCalled();
  });
});
