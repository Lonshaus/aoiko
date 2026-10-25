import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { getSetting, setSetting } from '../lib/settings';
import { m } from '../paraglide/messages';
import { setLocale } from '../paraglide/runtime';
import AnalysisNotifyToggle from './AnalysisNotifyToggle.svelte';
// このプロジェクトは __NATIVE__ = false（web のビルド設定）。
const requestPermission = vi.fn(async () => 'granted');
let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function stubBrowser(permission: NotificationPermission | 'none', answer = 'granted'): void {
  requestPermission.mockResolvedValue(answer);
  vi.stubGlobal('isSecureContext', true);
  if (permission === 'none') {
    vi.stubGlobal('Notification', undefined);
    return;
  }
  vi.stubGlobal('Notification', { permission, requestPermission });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
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
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  requestPermission.mockReset();
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.settings.clear();
});

describe('通知のトグル', () => {
  test('既定ではオフで、説明が出る', async () => {
    stubBrowser('default');
    const input = await mountToggle();
    expect(input).not.toBeNull();
    expect(input!.checked).toBe(false);
    expect(input!.disabled).toBe(false);
    expect(container!.textContent).toContain(m.settings_analysis_notify_label());
    expect(container!.textContent).toContain(m.settings_analysis_notify_hint());
  });

  test('保存値がオンで許可も残っていればオンで表示する', async () => {
    stubBrowser('granted');
    await setSetting('analysisNotifyEnabled', true);
    const input = await mountToggle();
    expect(input!.checked).toBe(true);
  });

  test('保存値がオンでも、ブラウザの許可が外れていればオフで表示する（保存値は変えない）', async () => {
    stubBrowser('denied');
    await setSetting('analysisNotifyEnabled', true);
    const input = await mountToggle();
    expect(input!.checked).toBe(false);
    expect(await getSetting('analysisNotifyEnabled')).toBe(true);
  });

  test('オンにすると許可を求め、通れば設定を保存する', async () => {
    stubBrowser('default', 'granted');
    const input = await mountToggle();
    toggle(input!, true);
    await vi.waitFor(async () => expect(await getSetting('analysisNotifyEnabled')).toBe(true));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(container!.textContent).not.toContain(m.settings_analysis_notify_denied());
  });

  test('オンにした操作の中で、await を挟まずに許可を求める（操作の有効期間を切らさない）', async () => {
    stubBrowser('default', 'granted');
    const input = await mountToggle();
    requestPermission.mockClear();
    toggle(input!, true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect(await getSetting('analysisNotifyEnabled')).toBe(true));
  });

  test('許可されなければ戻して、理由を出し、設定は保存しない', async () => {
    stubBrowser('default', 'denied');
    const input = await mountToggle();
    toggle(input!, true);
    await vi.waitFor(() =>
      expect(container!.textContent).toContain(m.settings_analysis_notify_denied()),
    );
    expect(input!.checked).toBe(false);
    expect(await getSetting('analysisNotifyEnabled')).toBeUndefined();
  });

  test('ブラウザで拒否済みならブロック中と示して無効にし、尋ね直さない', async () => {
    stubBrowser('denied');
    await setSetting('analysisNotifyEnabled', true);
    const input = await mountToggle();
    expect(input!.disabled).toBe(true);
    expect(input!.checked).toBe(false);
    expect(container!.textContent).toContain(m.settings_analysis_notify_blocked());
    expect(container!.textContent).not.toContain(m.settings_analysis_notify_unsupported());
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test.each(['default', 'granted'] as const)(
    '%s のときはブロック中の説明を出さない',
    async (permission) => {
      stubBrowser(permission);
      const input = await mountToggle();
      expect(input!.disabled).toBe(false);
      expect(container!.textContent).not.toContain(m.settings_analysis_notify_blocked());
    },
  );

  test('オフにすると設定を false にする。許可は求めない', async () => {
    stubBrowser('granted');
    await setSetting('analysisNotifyEnabled', true);
    const input = await mountToggle();
    toggle(input!, false);
    await vi.waitFor(async () => expect(await getSetting('analysisNotifyEnabled')).toBe(false));
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test('ブラウザ向けの文言を使う', async () => {
    stubBrowser('default', 'denied');
    const input = await mountToggle();
    toggle(input!, true);
    await vi.waitFor(() =>
      expect(container!.textContent).toContain(m.settings_analysis_notify_denied()),
    );
    expect(container!.textContent).toContain(m.settings_analysis_notify_hint());
    expect(container!.textContent).not.toContain(m.settings_analysis_notify_hint_native());
    expect(container!.textContent).not.toContain(m.settings_analysis_notify_denied_native());
  });

  test('通知を使えない環境では無効にして、理由を出す', async () => {
    stubBrowser('none');
    const input = await mountToggle();
    expect(input!.disabled).toBe(true);
    expect(container!.textContent).toContain(m.settings_analysis_notify_unsupported());
  });
});

describe('トグルを有効にする条件（web）', () => {
  test.each([
    [
      'serviceWorker が無い',
      () => {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      },
    ],
    [
      'Notification が無い',
      () => {
        vi.stubGlobal('Notification', undefined);
      },
    ],
    [
      'ネイティブの橋渡しが居る',
      () => {
        vi.stubGlobal('window', { ...window, __aoikoNative: {} });
      },
    ],
  ])('%s ときは許可済みでも無効にし、使えない理由を出す', async (_name, breakIt) => {
    stubBrowser('granted');
    await setSetting('analysisNotifyEnabled', true);
    breakIt();
    const input = await mountToggle();
    expect(input!.disabled).toBe(true);
    expect(input!.checked).toBe(false);
    expect(container!.textContent).toContain(m.settings_analysis_notify_unsupported());
    expect(container!.textContent).not.toContain(m.settings_analysis_notify_insecure());
  });

  test.each([
    ['isSecureContext が false', false],
    ['isSecureContext が無い', undefined],
  ])('%s ときは無効にし、https で開く必要があると示す', async (_name, value) => {
    stubBrowser('granted');
    vi.stubGlobal('isSecureContext', value);
    const input = await mountToggle();
    expect(input!.disabled).toBe(true);
    expect(container!.textContent).toContain(m.settings_analysis_notify_insecure());
    expect(container!.textContent).not.toContain(m.settings_analysis_notify_unsupported());
  });

  test('表示しただけでは許可を求めない', async () => {
    stubBrowser('default');
    const input = await mountToggle();
    expect(input!.disabled).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
