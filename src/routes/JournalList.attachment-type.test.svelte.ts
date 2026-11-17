// 証憑の Blob URL は新しいタブで開ける。許可していない型のまま渡すと文書として描画され得る。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { mount, unmount } from 'svelte';
import { toIndexable } from '../lib/decimal';
// happy-dom の Blob は fake-indexeddb の structured clone で中身と型を失うため、Node 組込みの Blob を使う。
// Dexie は読み込み時の Blob を「複製しない型」として覚え、liveQuery の結果をそれ以外は複製するので、
// Dexie を読み込む間だけ Node の Blob を差しておく。
vi.stubGlobal('Blob', NodeBlob);
const { db } = await import('../db/db');
const { ledger } = await import('../stores/ledger.svelte');
const { default: JournalList } = await import('./JournalList.svelte');
vi.unstubAllGlobals();

function nodeBlob(type: string): Blob {
  return new NodeBlob([new Uint8Array([60, 98, 62])], { type }) as unknown as Blob;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor タイムアウト');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

const ATTACHMENT_TYPES: Record<string, string> = {
  'html.bin': 'text/html',
  'empty.bin': '',
  'nul.bin': 'text/html\u0000',
  'photo.png': 'image/png',
};

let container: HTMLElement | undefined;
let instance: Record<string, unknown> | undefined;
const urlBlobs = new Map<string, Blob>();

beforeEach(async () => {
  await db.delete();
  await db.open();
  urlBlobs.clear();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
    const url = `blob:test/${n++}`;
    urlBlobs.set(url, obj as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const year = ledger.currentYear;
  await db.journalEntries.add({
    id: 'e1',
    date: `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}-15`,
    year,
    description: '証憑つきの仕訳',
    status: 'confirmed',
    source: 'manual',
    createdAt: 1,
    confirmedAt: 1,
  });
  await db.journalLines.bulkAdd(
    (['debit', 'credit'] as const).map((side) => ({
      id: `e1-${side}`,
      entryId: 'e1',
      side,
      accountCode: side === 'debit' ? '5130' : '1130',
      amount: '1000',
      amountIndexed: toIndexable('1000'),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    })),
  );
  await db.attachments.bulkAdd(
    Object.entries(ATTACHMENT_TYPES).map(([fileName, type]) => ({
      id: fileName,
      entryId: 'e1',
      blob: nodeBlob(type),
      mimeType: type,
      fileName,
      createdAt: 1,
    })),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  instance = mount(JournalList, { target: container, props: {} });
});

afterEach(async () => {
  if (instance !== undefined) {
    unmount(instance);
    instance = undefined;
  }
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
  await db.delete();
});

function linkedBlobType(fileName: string): string | undefined {
  const img = container!.querySelector(`img[alt="${fileName}"]`);
  const href = img?.closest('a')?.getAttribute('href') ?? '';
  return urlBlobs.get(href)?.type;
}

describe('証憑の Blob URL', () => {
  test('許可していない型は application/octet-stream、画像の型はそのまま', async () => {
    await waitFor(() => (container!.textContent ?? '').includes('証憑つきの仕訳'));
    const row = Array.from(container!.querySelectorAll('tbody tr')).find((tr) =>
      (tr.textContent ?? '').includes('証憑つきの仕訳'),
    ) as HTMLElement;
    row.click();
    await waitFor(() => container!.querySelectorAll('img[alt]').length === 4);
    await waitFor(() => linkedBlobType('photo.png') !== undefined);
    expect(linkedBlobType('html.bin')).toBe('application/octet-stream');
    expect(linkedBlobType('empty.bin')).toBe('application/octet-stream');
    expect(linkedBlobType('nul.bin')).toBe('application/octet-stream');
    expect(linkedBlobType('photo.png')).toBe('image/png');
  });

  test('別名の image/x-ms-bmp は image/bmp で開く', async () => {
    await db.attachments.add({
      id: 'old.bmp',
      entryId: 'e1',
      blob: nodeBlob('image/x-ms-bmp'),
      mimeType: 'image/x-ms-bmp',
      fileName: 'old.bmp',
      createdAt: 1,
    });
    await waitFor(() => (container!.textContent ?? '').includes('証憑つきの仕訳'));
    const row = Array.from(container!.querySelectorAll('tbody tr')).find((tr) =>
      (tr.textContent ?? '').includes('証憑つきの仕訳'),
    ) as HTMLElement;
    row.click();
    await waitFor(() => container!.querySelectorAll('img[alt]').length === 5);
    await waitFor(() => linkedBlobType('old.bmp') !== undefined);
    expect(linkedBlobType('old.bmp')).toBe('image/bmp');
  });
});
