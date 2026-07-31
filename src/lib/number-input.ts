// <input type="number"> の bind:value は Svelte が値を数値へ変換し、空欄を null にする
// （internal/client/dom/elements/bindings/input.js の to_number）。文字列で保持する金額欄が
// 壊れ、数値欄は空欄にした瞬間 null が下流へ流れるため、代入は input 側の生の値から行う。

import type { FormEventHandler } from 'svelte/elements';

export function assignInputString(
  assign: (value: string) => void,
): FormEventHandler<HTMLInputElement> {
  return (e) => {
    assign((e.currentTarget as HTMLInputElement).value);
  };
}
// 空欄・不正入力（valueAsNumber が NaN）のときは代入せず、直前の値を残す。
export function assignInputNumber(
  assign: (value: number) => void,
): FormEventHandler<HTMLInputElement> {
  return (e) => {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(v)) {
      assign(v);
    }
  };
}
