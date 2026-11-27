import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { legacyHostNotice } from '../lib/legacy-host-notice.svelte';
import { takeSettingsTarget } from '../lib/settings-target';
import { m } from '../paraglide/messages';
import { setLocale } from '../paraglide/runtime';

const { default: LegacyHostNotice } = await import('./LegacyHostNotice.svelte');

const NEW_URL = 'https://aoiko.lonshaus.net';

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

function setUrl(url: string): void {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
}

function render(props: { endDate?: string | null } = {}): void {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(LegacyHostNotice, { target, props });
}

function unmountOnly(): void {
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
}

function text(): string {
  flushSync();
  return target?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function control(label: string): HTMLElement {
  const el = [...(target?.querySelectorAll<HTMLElement>('a, button') ?? [])].find(
    (e) => e.textContent?.trim() === label,
  );
  if (el === undefined) {
    throw new Error(`見つからない: ${label}`);
  }
  return el;
}

function closeButton(): HTMLButtonElement {
  const el = target?.querySelector<HTMLButtonElement>(`button[aria-label="${m.common_close()}"]`);
  if (el === null || el === undefined) {
    throw new Error('閉じるボタンが見つからない');
  }
  return el;
}

beforeEach(() => {
  sessionStorage.clear();
  legacyHostNotice.dismissed = false;
  setUrl('https://aoiko.pages.dev/');
});

afterEach(() => {
  unmountOnly();
  setUrl('http://localhost:3000/');
});

describe('LegacyHostNotice', () => {
  test('旧URLで開くと出る', () => {
    render();
    expect(text()).toContain(NEW_URL);
  });

  test.each([
    'https://aoiko.lonshaus.net/',
    'https://abc123.aoiko.pages.dev/',
    'http://localhost:10708/',
  ])('%s では出ない', (url) => {
    setUrl(url);
    render();
    expect(text()).toBe('');
  });

  test('英語では年月を月名で書き、時差で前月にずれない', () => {
    setLocale('en', { reload: false });
    render({ endDate: '2027-01' });
    expect(text()).toContain('This URL will stop working in January 2027.');
    setLocale('ja', { reload: false });
  });

  test('日付なしでは日付のない文言と新URLを出す', () => {
    render({ endDate: null });
    expect(text()).toContain(m.legacy_host_notice({ newUrl: NEW_URL }));
    expect(text()).not.toMatch(/\d{4}年/);
  });

  test('年月ありでは 2027/01 の予定の文言と新URLを出す', () => {
    render({ endDate: '2027-01' });
    expect(text()).toBe(
      'この URL は 2027/01 中に使えなくなる予定です。データは新しい URL https://aoiko.lonshaus.net へ自動では移りません。先にバックアップを書き出し、新しい URL で復元してください。 設定で操作 → ×',
    );
  });

  test('新URLは別のタブで開くリンクになる', () => {
    render();
    const a = control(NEW_URL) as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(NEW_URL);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  test('バックアップのリンクは /settings へ行き、backup を行き先として預ける', () => {
    render();
    const a = control(m.legacy_host_action_backup()) as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/settings');
    a.click();
    expect(window.location.pathname).toBe('/settings');
    expect(takeSettingsTarget()).toBe('backup');
  });

  test('閉じると隠れ、作り直しても隠れたまま', () => {
    render();
    closeButton().click();
    expect(text()).toBe('');
    unmountOnly();
    render();
    expect(text()).toBe('');
  });

  test('状態を作り直す（次の起動）と再び出る', () => {
    render();
    closeButton().click();
    expect(text()).toBe('');
    unmountOnly();
    legacyHostNotice.dismissed = false;
    render();
    expect(text()).toContain(NEW_URL);
  });
});
