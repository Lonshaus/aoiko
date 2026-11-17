import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { db } from '../db/db';
import { setSetting } from '../lib/settings';
import { formatJPY } from '../lib/decimal';
import { estimateTransferIncome, separateTransferIncomeByTerm } from '../domain/asset-disposal';
import { m } from '../paraglide/messages';
import type { FixedAsset } from '../db/types';

const { default: Settings } = await import('./Settings.svelte');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const MOUNT_SENTINEL = 'ZZZ9';
let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function text(): string {
  return container?.textContent ?? '';
}

function type(name: string, value: string): void {
  const el = container!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function rowTexts(name: string): string {
  const row = Array.from(container!.querySelectorAll('tbody tr')).find((tr) =>
    tr.querySelector('td')?.textContent?.trim().startsWith(name),
  ) as HTMLTableRowElement;
  return (row.nextElementSibling?.textContent ?? '').replace(/\s+/g, ' ');
}

function headingParagraphs(title: string): string {
  const h = Array.from(container!.querySelectorAll('h4')).find(
    (e) => e.textContent?.trim() === title,
  );
  return h ? (h.parentElement?.textContent ?? '').replace(/\s+/g, ' ') : '';
}

const building: FixedAsset = {
  id: 'b1',
  name: '事務所建物',
  acquisitionDate: '2020-07-01',
  acquisitionCost: '10000000',
  usefulLifeYears: 24,
  depreciationMethod: 'straight-line',
  accountCode: '1511',
  disposedDate: '2025-12-01',
  disposalType: 'sale',
  salePrice: '12000000',
};

const equipment: FixedAsset = {
  id: 'e1',
  name: '棚',
  acquisitionDate: '2022-01-01',
  acquisitionCost: '1000000',
  usefulLifeYears: 4,
  depreciationMethod: 'straight-line',
  accountCode: '1510',
  disposedDate: '2025-06-30',
  disposalType: 'sale',
  salePrice: '1500000',
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  await setSetting('currentYear', 2025);
  await db.fixedAssets.bulkAdd([building, equipment]);
  await db.settings.put({
    key: 'homeOfficeAccountRatios',
    value: { [MOUNT_SENTINEL]: '0.30' },
    updatedAt: Date.now(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(Settings, { target: container, props: {} });
  await waitFor(() => text().includes(MOUNT_SENTINEL) && text().includes('事務所建物'));
  type('depreciationTargetNen', '2025');
  await waitFor(() => text().includes(m.settings_transfer_income_separate_title({ year: 2025 })));
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  await db.delete();
});

describe('建物等の売却は分離課税で試算する', () => {
  test('建物の個別試算は分離課税・短期、器具備品は総合課税の試算のまま', () => {
    const b = estimateTransferIncome(building)!;
    expect(b.taxation).toBe('separate');
    expect(rowTexts('事務所建物')).toContain(
      m.settings_asset_disposal_transfer_estimate_separate({
        term: m.settings_transfer_term_short(),
        proceeds: formatJPY(b.proceeds),
        acquisitionExpense: formatJPY(b.acquisitionExpense),
        estimate: formatJPY(b.estimate),
        years: b.holdingYears,
      }),
    );
    const e = estimateTransferIncome(equipment)!;
    expect(rowTexts('棚')).toContain(
      m.settings_asset_disposal_transfer_estimate({
        proceeds: formatJPY(e.proceeds),
        acquisitionExpense: formatJPY(e.acquisitionExpense),
        estimate: formatJPY(e.estimate),
        years: e.holdingYears,
      }),
    );
  });

  test('総合課税の年度合計は器具備品だけ、分離課税の年度合計は建物の金額', () => {
    const e = estimateTransferIncome(equipment)!;
    const general = headingParagraphs(m.settings_transfer_income_aggregate_title({ year: 2025 }));
    expect(general).toContain(formatJPY(e.estimate));
    const terms = separateTransferIncomeByTerm([building], 2025);
    expect(terms.shortTerm).not.toBe('0');
    expect(general).not.toContain(formatJPY(terms.shortTerm));
    const separate = headingParagraphs(m.settings_transfer_income_separate_title({ year: 2025 }));
    expect(separate).toContain(
      m.settings_transfer_income_separate_result({
        shortTerm: formatJPY(terms.shortTerm),
        longTerm: formatJPY(terms.longTerm),
      }),
    );
    expect(separate).toContain(m.settings_transfer_income_separate_note());
  });
});
