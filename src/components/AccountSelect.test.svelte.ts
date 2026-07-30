import { describe, expect, it, afterEach } from 'vitest';
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import AccountSelect from './AccountSelect.svelte';
import type { AccountGroup } from '../stores/ledger.svelte';
import type { Account } from '../db/types';

function makeAccount(code: string, name: string, category: Account['category']): Account {
  return { code, year: 2026, name, category, displayOrder: 0 };
}

const groups: AccountGroup[] = [
  {
    category: 'asset',
    label: '資産',
    items: [
      makeAccount('101', '現金', 'asset'),
      makeAccount('102', '普通預金', 'asset'),
      makeAccount('103', '売掛金', 'asset'),
    ],
  },
  {
    category: 'expense',
    label: '費用',
    items: [
      makeAccount('501', '仕入高', 'expense'),
      makeAccount('502', '通信費', 'expense'),
      makeAccount('503', '旅費交通費', 'expense'),
    ],
  },
];

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;

function mountSelect(props: ComponentProps<typeof AccountSelect>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(AccountSelect, { target: container, props });
  return container.querySelector('select') as HTMLSelectElement;
}

afterEach(() => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  if (container !== undefined) {
    container.remove();
    container = undefined;
  }
});

describe('AccountSelect', () => {
  it('collapsed + placeholder + empty value: プレースホルダーの option 1件のみ', () => {
    const select = mountSelect({ value: '', groups, placeholder: '選択してください' });
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(1);
    expect(options[0]?.value).toBe('');
    expect(options[0]?.textContent).toBe('選択してください');
    expect(select.querySelectorAll('optgroup').length).toBe(0);
  });

  it('collapsed + 非空の value: 選択中の科目 1件のみ、コード・科目名を含む', () => {
    const select = mountSelect({ value: '502', groups, placeholder: '選択してください' });
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(1);
    expect(options[0]?.value).toBe('502');
    expect(options[0]?.textContent).toContain('502');
    expect(options[0]?.textContent).toContain('通信費');
    expect(select.querySelectorAll('optgroup').length).toBe(0);
  });

  it('collapsed + placeholder なし + 空の value: option 0件（OrderImport の呼び出し方）', () => {
    const select = mountSelect({ value: '', groups });
    expect(select.querySelectorAll('option').length).toBe(0);
  });

  it('pointerdown で全件展開される（optgroup・placeholder 込み）', () => {
    const select = mountSelect({ value: '', groups, placeholder: '選択してください' });
    select.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    flushSync();

    const optgroups = select.querySelectorAll('optgroup');
    expect(optgroups.length).toBe(2);
    expect(optgroups[0]?.label).toBe('資産');
    expect(optgroups[1]?.label).toBe('費用');

    const options = select.querySelectorAll('option');
    const totalAccounts = groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(options.length).toBe(totalAccounts + 1);
    expect(options[0]?.value).toBe('');
  });

  it('展開は冪等（2 回目の pointerdown で重複しない）', () => {
    const select = mountSelect({ value: '', groups, placeholder: '選択してください' });
    select.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    flushSync();
    const countAfterFirst = select.querySelectorAll('option').length;
    select.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    flushSync();
    expect(select.querySelectorAll('option').length).toBe(countAfterFirst);
  });

  it('focus でも展開される', () => {
    const select = mountSelect({ value: '', groups, placeholder: '選択してください' });
    select.dispatchEvent(new Event('focus', { bubbles: false }));
    flushSync();
    const totalAccounts = groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(select.querySelectorAll('option').length).toBe(totalAccounts + 1);
  });

  it('disabled prop が DOM の disabled プロパティに反映される', () => {
    const select = mountSelect({ value: '', groups, disabled: true });
    expect(select.disabled).toBe(true);
  });

  it('option 選択で value が更新され onchange が呼ばれる', () => {
    let changeCount = 0;
    const select = mountSelect({
      value: '',
      groups,
      placeholder: '選択してください',
      onchange: () => {
        changeCount += 1;
      },
    });
    select.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    flushSync();

    select.value = '103';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    expect(changeCount).toBe(1);
    expect(select.value).toBe('103');
  });
});
