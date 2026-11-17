import { afterEach, describe, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import BackupPartsChecklist from './BackupPartsChecklist.svelte';
import { BACKUP_PART_IDS, type BackupPartId } from '../backup/parts';
import { m } from '../paraglide/messages';

let target: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;
let calls: BackupPartId[][] = [];

function render(options: {
  selected: BackupPartId[];
  locked?: BackupPartId[];
  mode?: 'export' | 'import';
  available?: readonly BackupPartId[];
}): void {
  const state = $state({ selected: options.selected });
  calls = [];
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(BackupPartsChecklist, {
    target,
    props: {
      available: options.available ?? BACKUP_PART_IDS,
      get selected() {
        return state.selected;
      },
      ...(options.locked ? { locked: options.locked } : {}),
      mode: options.mode ?? 'export',
      namePrefix: 'test-parts',
      onchange: (next: BackupPartId[]) => {
        calls.push(next);
        state.selected = next;
      },
    },
  });
  flushSync();
}

function input(id: BackupPartId): HTMLInputElement {
  const el = target!.querySelector<HTMLInputElement>(`input[name="test-parts-${id}"]`);
  if (!el) {
    throw new Error(`input が無い: ${id}`);
  }
  return el;
}

function click(id: BackupPartId): void {
  input(id).click();
  flushSync();
}

afterEach(() => {
  if (component !== null) {
    unmount(component);
    component = null;
  }
  target?.remove();
  target = null;
});

describe('BackupPartsChecklist', () => {
  test('帳簿データを外すと証憑写真も外れ、証憑写真は選べなくなる', () => {
    render({ selected: ['books', 'attachments', 'business'] });
    click('books');
    expect(calls.at(-1)).toEqual(['business']);
    expect(input('attachments').checked).toBe(false);
    expect(input('attachments').disabled).toBe(true);
  });

  test('帳簿データを戻すと証憑写真を選べる', () => {
    render({ selected: ['business'] });
    expect(input('attachments').disabled).toBe(true);
    click('books');
    expect(input('attachments').disabled).toBe(false);
    click('attachments');
    expect(calls.at(-1)).toEqual(['books', 'attachments', 'business']);
  });

  test('locked の区分は選ばれた状態で外せない', () => {
    render({ selected: [], locked: ['books'] });
    expect(input('books').checked).toBe(true);
    expect(input('books').disabled).toBe(true);
    click('filer');
    expect(calls.at(-1)).toEqual(['books', 'filer']);
  });

  test('書き出しでは API キーの下にだけ平文の注意を出す', () => {
    render({ selected: [], mode: 'export' });
    const text = target!.textContent ?? '';
    expect(text).toContain(m.backup_parts_api_keys_export_warning());
    expect(text).not.toContain(m.backup_parts_import_overwrite_warning());
  });

  test('復元では AI と外部送信の設定・API キーの下に上書きの注意を出す', () => {
    render({ selected: [], mode: 'import' });
    const text = target!.textContent ?? '';
    expect(text).not.toContain(m.backup_parts_api_keys_export_warning());
    const warned = [...target!.querySelectorAll('label')]
      .filter((l) => (l.textContent ?? '').includes(m.backup_parts_import_overwrite_warning()))
      .map((l) => l.querySelector('input')!.name);
    expect(warned).toEqual(['test-parts-ai', 'test-parts-apiKeys']);
  });

  test('available の区分だけを標準の順序で出し、どの input にも name がある', () => {
    render({ selected: [], available: ['filer', 'business'] });
    const inputs = [...target!.querySelectorAll('input')];
    expect(inputs.map((i) => i.name)).toEqual(['test-parts-business', 'test-parts-filer']);
  });

  test('全区分の input に name がある', () => {
    render({ selected: [] });
    const inputs = [...target!.querySelectorAll('input')];
    expect(inputs).toHaveLength(6);
    for (const i of inputs) {
      expect(i.name).not.toBe('');
    }
  });
});
