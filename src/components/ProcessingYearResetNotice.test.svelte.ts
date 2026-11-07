import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { takeSettingsTarget } from '../lib/settings-target';
import { m } from '../paraglide/messages';

const { default: ProcessingYearResetNotice } = await import('./ProcessingYearResetNotice.svelte');

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

function text(): string {
  flushSync();
  return target?.textContent ?? '';
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

async function seed(resetTo: unknown, currentYear: unknown): Promise<void> {
  await db.settings.bulkPut([
    { key: 'processingYearResetTo', value: resetTo, updatedAt: 1 },
    { key: 'currentYear', value: currentYear, updatedAt: 1 },
  ]);
}

function render(): void {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(ProcessingYearResetNotice, { target });
}

const resetKeyGone = async () => (await db.settings.get('processingYearResetTo')) === undefined;

beforeEach(async () => {
  sessionStorage.clear();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
  await db.delete();
});

describe('ProcessingYearResetNotice', () => {
  test('置き換えた年が今の処理年度なら、その年を知らせる', async () => {
    await seed(2026, 2026);
    render();
    await waitFor(() => text().includes(m.processing_year_reset_notice({ year: 2026 })));
    expect(text()).toContain('2026 年');
  });

  test('今の処理年度が別の年なら出さず、記録を消す', async () => {
    await seed(2026, 2027);
    render();
    await waitFor(resetKeyGone);
    expect(text()).toBe('');
  });

  test('値が年度でなければ出さず、記録を消す', async () => {
    await seed('x', 2026);
    render();
    await waitFor(resetKeyGone);
    expect(text()).toBe('');
  });

  test('「閉じる」で記録を消してから隠す', async () => {
    await seed(2026, 2026);
    render();
    await waitFor(() => text().includes('2026 年'));
    control(m.processing_year_reset_action_close()).click();
    await waitFor(() => text() === '');
    expect(await resetKeyGone()).toBe(true);
  });

  test('記録を消せなければ出したまま', async () => {
    await seed(2026, 2026);
    render();
    await waitFor(() => text().includes('2026 年'));
    const close = control(m.processing_year_reset_action_close()) as HTMLButtonElement;
    db.close();
    try {
      close.click();
      flushSync();
      expect(close.disabled).toBe(true);
      await waitFor(() => !close.disabled);
      expect(text()).toContain('2026 年');
    } finally {
      await db.open();
    }
    expect(await resetKeyGone()).toBe(false);
  });

  test('「設定を開く」は基本設定を行き先として預ける', async () => {
    await seed(2026, 2026);
    render();
    await waitFor(() => text().includes('2026 年'));
    control(m.processing_year_reset_action_settings()).click();
    expect(takeSettingsTarget()).toBe('basic');
  });
});
