// 全文リンクの列が、開いた本文に割られないこと（issue#511）。見出しと本文を同じ
// 要素へ入れると、展開した瞬間に後続の見出しが本文の下へ押し出されて列が切れる。
import { afterEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import PolicyDocViewer from './PolicyDocViewer.svelte';

type Docs = ComponentProps<typeof PolicyDocViewer>['docs'];

const DOCS: Docs = [
  { doc: 'DISCLAIMER', label: 'DISCLAIMER.md' },
  { doc: 'PRIVACY', label: 'PRIVACY.md' },
  { doc: 'SECURITY', label: 'SECURITY.md' },
  { doc: 'LICENSE', label: 'LICENSE (AGPL-3.0)' },
  { doc: 'THIRD_PARTY', label: 'THIRD_PARTY_LICENSES.txt' },
];

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

function render(): void {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(PolicyDocViewer, { target, props: { docs: DOCS } });
  flushSync();
}

function buttons(): HTMLButtonElement[] {
  return Array.from(target?.querySelectorAll('button') ?? []);
}

function button(label: string): HTMLButtonElement {
  const hit = buttons().find((b) => b.textContent?.trim() === label);
  if (hit === undefined) {
    throw new Error(`ボタンが無い: ${label}`);
  }
  return hit;
}
// 本文の箱はリンクの列より後ろに出るので、末尾が div なら開いている。
function bodyBox(): Element | null {
  const last = target?.lastElementChild ?? null;
  return last !== null && last.tagName === 'DIV' ? last : null;
}

async function open(label: string): Promise<void> {
  button(label).click();
  await vi.waitFor(() => {
    flushSync();
    expect(bodyBox()?.querySelector('pre, .policy-doc-body')).toBeTruthy();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
});

describe('リンクの列', () => {
  test('本文を開いてもリンクは 1 つも欠けず、本文は列の後ろに出る', async () => {
    render();
    await open('DISCLAIMER.md');
    expect(buttons()).toHaveLength(DOCS.length);
    const box = bodyBox();
    expect(box).not.toBeNull();
    const kids = Array.from(target?.children ?? []);
    const boxAt = kids.indexOf(box as Element);
    for (const b of buttons()) {
      // 本文がリンクを抱え込んでも、リンクの間に挟まっても、その後ろの列が下へ落ちる。
      expect(box?.contains(b)).toBe(false);
      expect(kids.indexOf(b)).toBeLessThan(boxAt);
    }
  });

  test('別の文書を開くと前の文書は閉じ、本文は 1 つだけ', async () => {
    render();
    await open('DISCLAIMER.md');
    await open('LICENSE (AGPL-3.0)');
    expect(button('DISCLAIMER.md').getAttribute('aria-expanded')).toBe('false');
    expect(button('LICENSE (AGPL-3.0)').getAttribute('aria-expanded')).toBe('true');
    expect(target?.querySelectorAll('pre, .policy-doc-body')).toHaveLength(1);
  });

  test('同じ文書をもう一度押すと閉じる', async () => {
    render();
    await open('LICENSE (AGPL-3.0)');
    button('LICENSE (AGPL-3.0)').click();
    flushSync();
    expect(bodyBox()).toBeNull();
    expect(button('LICENSE (AGPL-3.0)').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('読み込み中の切り替え', () => {
  test('遅れて返った本文は、別の文書へ移った後なら捨てる', async () => {
    let release: ((text: string) => void) | null = null;
    let delivered = false;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise((resolve) => {
          release = (text: string) => {
            resolve({
              ok: true,
              text: async () => {
                delivered = true;
                return text;
              },
            });
          };
        }),
    );
    render();
    // 第三者ライセンスだけは実行時取得なので、返りを止めれば読み込み中を作れる。
    button('THIRD_PARTY_LICENSES.txt').click();
    flushSync();
    await open('LICENSE (AGPL-3.0)');
    (release as unknown as (text: string) => void)('第三者ライセンスの全文');
    await vi.waitFor(() => expect(delivered).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    expect(target?.textContent).not.toContain('第三者ライセンスの全文');
    expect(button('THIRD_PARTY_LICENSES.txt').getAttribute('aria-expanded')).toBe('false');
    expect(bodyBox()?.querySelector('pre')?.textContent).toContain('GNU AFFERO');
  });
});
