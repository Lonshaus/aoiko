import { describe, expect, it, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DiscardCandidatesDialog from './DiscardCandidatesDialog.svelte';
import { m } from '../paraglide/messages';

let instance: Record<string, unknown> | undefined;

afterEach(() => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  document.body.innerHTML = '';
});

function findDialogButton(label: string): HTMLElement | null {
  return Array.from(document.body.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLElement | null;
}

describe('DiscardCandidatesDialog', () => {
  it('open が false の間はダイアログが描画されない', () => {
    instance = mount(DiscardCandidatesDialog, {
      target: document.body,
      props: { open: false, onconfirm: () => {}, oncancel: () => {} },
    });
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('open が true になるとタイトル・破棄しないボタン・破棄するボタンが出る', () => {
    instance = mount(DiscardCandidatesDialog, {
      target: document.body,
      props: { open: true, onconfirm: () => {}, oncancel: () => {} },
    });
    flushSync();
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(findDialogButton(m.discard_candidates_stay())).not.toBeNull();
    expect(findDialogButton(m.discard_candidates_discard())).not.toBeNull();
  });

  it('「編集を続ける」を押すと oncancel が呼ばれ onconfirm は呼ばれない', () => {
    let confirmed = 0;
    let cancelled = 0;
    instance = mount(DiscardCandidatesDialog, {
      target: document.body,
      props: {
        open: true,
        onconfirm: () => {
          confirmed += 1;
        },
        oncancel: () => {
          cancelled += 1;
        },
      },
    });
    flushSync();
    findDialogButton(m.discard_candidates_stay())?.click();
    flushSync();
    // Cancel クリックが閉じるのを onOpenChange 経由でも検知するため複数回になり得る、冪等な操作なので回数は問わない
    expect(cancelled).toBeGreaterThan(0);
    expect(confirmed).toBe(0);
  });

  it('「破棄する」を押すと onconfirm が呼ばれる', () => {
    let confirmed = 0;
    instance = mount(DiscardCandidatesDialog, {
      target: document.body,
      props: {
        open: true,
        onconfirm: () => {
          confirmed += 1;
        },
        oncancel: () => {},
      },
    });
    flushSync();
    findDialogButton(m.discard_candidates_discard())?.click();
    flushSync();
    expect(confirmed).toBe(1);
  });

  it("「don't ask again」相当のチェックボックスを持たない（非抑制のダイアログ）", () => {
    instance = mount(DiscardCandidatesDialog, {
      target: document.body,
      props: { open: true, onconfirm: () => {}, oncancel: () => {} },
    });
    flushSync();
    expect(document.body.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
