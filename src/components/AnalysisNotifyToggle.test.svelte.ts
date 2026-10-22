import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';
import { setLocale } from '../paraglide/runtime';
import AnalysisNotifyToggle from './AnalysisNotifyToggle.svelte';
// このプロジェクトは __NATIVE__ = true（ネイティブ向けのビルド設定）。
const serviceWorkerGetter = vi.fn(() => ({}));
const browserRequestPermission = vi.fn(async () => 'granted');
const notificationStatus = vi.fn(async () => 'default');
const requestNotification = vi.fn(async () => 'granted');
let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function installBridge(bridge: Record<string, unknown> | undefined): void {
  vi.stubGlobal('window', { ...window, __aoikoNative: bridge });
}

async function mountToggle(): Promise<HTMLInputElement | null> {
  instance = mount(AnalysisNotifyToggle, { target: container! });
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 30));
  flushSync();
  return container!.querySelector('input');
}

function toggle(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(async () => {
  setLocale('ja', { reload: false });
  await db.settings.clear();
  notificationStatus.mockReset().mockResolvedValue('default');
  requestNotification.mockReset().mockResolvedValue('granted');
  vi.stubGlobal('Notification', {
    permission: 'granted',
    requestPermission: browserRequestPermission,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    get: serviceWorkerGetter,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  serviceWorkerGetter.mockClear();
  browserRequestPermission.mockClear();
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.settings.clear();
});

function expectBrowserApisUntouched(): void {
  expect(serviceWorkerGetter).not.toHaveBeenCalled();
  expect(browserRequestPermission).not.toHaveBeenCalled();
}

describe('ネイティブ向けの設定で通知の仕組みが無い環境', () => {
  test.each([
    ['橋渡しが無い', undefined],
    ['入口が生えていない', {}],
    ['非対応と答える', { notificationStatus: async () => 'unsupported' }],
  ])('%sときはトグルを描かず、ブラウザの通知 API にも触れない', async (_name, bridge) => {
    installBridge(bridge);
    await setSetting('analysisNotifyEnabled', true);
    const input = await mountToggle();
    expect(input).toBeNull();
    expect(container!.textContent).toBe('');
    expectBrowserApisUntouched();
  });
});

describe('ネイティブ向けの設定で通知の仕組みがある環境', () => {
  beforeEach(() => {
    installBridge({ notificationStatus, requestNotification });
  });

  test('トグルを描き、ネイティブ向けの文言を出す。ブラウザ向けの文言は出さない', async () => {
    const input = await mountToggle();
    expect(input).not.toBeNull();
    expect(input!.checked).toBe(false);
    expect(input!.disabled).toBe(false);
    const text = container!.textContent!;
    expect(text).toContain(m.settings_analysis_notify_label());
    expect(text).toContain(m.settings_analysis_notify_hint_native());
    expect(text).not.toContain(m.settings_analysis_notify_hint());
    expect(text).not.toContain(m.settings_analysis_notify_unsupported());
    expectBrowserApisUntouched();
  });

  test('保存値がオンで OS の許可も残っていればオンで表示する', async () => {
    notificationStatus.mockResolvedValue('granted');
    await setSetting('analysisNotifyEnabled', true);
    const input = await mountToggle();
    expect(input!.checked).toBe(true);
  });

  test('保存値がオンでも OS の許可が外れていればオフで表示する（保存値は変えない）', async () => {
    notificationStatus.mockResolvedValue('denied');
    await setSetting('analysisNotifyEnabled', true);
    const input = await mountToggle();
    expect(input).not.toBeNull();
    expect(input!.checked).toBe(false);
    expect(await getSetting('analysisNotifyEnabled')).toBe(true);
  });

  test('オンにすると橋渡しで許可を求め、通れば設定を保存する', async () => {
    const input = await mountToggle();
    toggle(input!, true);
    expect(requestNotification).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect(await getSetting('analysisNotifyEnabled')).toBe(true));
    expect(container!.textContent).not.toContain(m.settings_analysis_notify_denied_native());
    expectBrowserApisUntouched();
  });

  test('許可されなければ戻して、ネイティブ向けの理由を出し、設定は保存しない', async () => {
    requestNotification.mockResolvedValue('denied');
    const input = await mountToggle();
    toggle(input!, true);
    await vi.waitFor(() =>
      expect(container!.textContent).toContain(m.settings_analysis_notify_denied_native()),
    );
    expect(container!.textContent).not.toContain(m.settings_analysis_notify_denied());
    expect(input!.checked).toBe(false);
    expect(await getSetting('analysisNotifyEnabled')).toBeUndefined();
  });

  test('オフにすると設定を false にする。許可は求めない', async () => {
    notificationStatus.mockResolvedValue('granted');
    await setSetting('analysisNotifyEnabled', true);
    const input = await mountToggle();
    toggle(input!, false);
    await vi.waitFor(async () => expect(await getSetting('analysisNotifyEnabled')).toBe(false));
    expect(requestNotification).not.toHaveBeenCalled();
  });
});
