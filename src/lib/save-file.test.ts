import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { saveFile, saveTextFile } from './save-file';

let created: Blob[] = [];
let revoked: string[] = [];
let clicked: { download: string; href: string; inDocument: boolean }[] = [];

beforeEach(() => {
  created = [];
  revoked = [];
  clicked = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });
  // click 時点で DOM に入っていることを確認する（入っていないと あるブラウザ で発火しない）
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({
      download: this.download,
      href: this.href,
      inDocument: document.body.contains(this),
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saveFile', () => {
  test('指定した名前と MIME で保存し、後始末をする', async () => {
    saveFile(new Uint8Array([1, 2, 3]), 'aoiko-ledger-2026-07-27.zip', 'application/zip');

    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('application/zip');
    expect(new Uint8Array(await created[0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('aoiko-ledger-2026-07-27.zip');
  });

  test('click は DOM に追加された状態で行う', () => {
    saveFile(new Uint8Array([0]), 'a.bin', 'application/octet-stream');
    expect(clicked[0]?.inDocument).toBe(true);
  });
  // 一時要素と object URL を残すと、大きなバックアップを何度も書き出した際に
  // メモリを保持し続けてしまう。
  test('一時要素と object URL を残さない', () => {
    saveFile(new Uint8Array([0]), 'a.bin', 'application/octet-stream');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoked).toEqual(['blob:test/1']);
  });
});

describe('saveTextFile', () => {
  test('UTF-8 で符号化する（日本語を含む .xtx / XML 用）', async () => {
    saveTextFile('<?xml version="1.0"?><a>青色申告</a>', 'aoiko-2026.xtx', 'application/xml');

    expect(created[0]?.type).toBe('application/xml');
    expect(await created[0]!.text()).toBe('<?xml version="1.0"?><a>青色申告</a>');
    expect(clicked[0]?.download).toBe('aoiko-2026.xtx');
  });
});
