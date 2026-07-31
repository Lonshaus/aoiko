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
  // click 時点で DOM に入っていることを確認する（入っていないと Firefox で発火しない）
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
    await saveFile(new Uint8Array([1, 2, 3]), 'aoiko-ledger-2026-07-27.zip', 'application/zip');

    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('application/zip');
    expect(new Uint8Array(await created[0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('aoiko-ledger-2026-07-27.zip');
  });

  test('click は DOM に追加された状態で行う', async () => {
    await saveFile(new Uint8Array([0]), 'a.bin', 'application/octet-stream');
    expect(clicked[0]?.inDocument).toBe(true);
  });
  // 一時要素と object URL を残すと、大きなバックアップを何度も書き出した際に
  // メモリを保持し続けてしまう。
  test('一時要素と object URL を残さない', async () => {
    await saveFile(new Uint8Array([0]), 'a.bin', 'application/octet-stream');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoked).toEqual(['blob:test/1']);
  });

  test('ReadableStream も受け取り、MIME を付け直して保存する', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    await saveFile(stream, 'aoiko-ledger-2026-07-27.zip', 'application/zip');

    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('application/zip');
    expect(new Uint8Array(await created[0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('saveTextFile', () => {
  test('UTF-8 で符号化する（日本語を含む .xtx / XML 用）', async () => {
    await saveTextFile('<?xml version="1.0"?><a>青色申告</a>', 'aoiko-2026.xtx', 'application/xml');

    expect(created[0]?.type).toBe('application/xml');
    expect(await created[0]!.text()).toBe('<?xml version="1.0"?><a>青色申告</a>');
    expect(clicked[0]?.download).toBe('aoiko-2026.xtx');
  });
});

describe('保存の完了判定', () => {
  const w = window as unknown as { showSaveFilePicker?: unknown };
  const original = w.showSaveFilePicker;
  afterEach(() => {
    if (original === undefined) {
      delete w.showSaveFilePicker;
    } else {
      w.showSaveFilePicker = original;
    }
  });

  test('保存先の選択を取り消したら false（時刻を刻ませない）', async () => {
    w.showSaveFilePicker = () => Promise.reject(new DOMException('cancel', 'AbortError'));
    const ok = await saveFile(new TextEncoder().encode('x'), 'a.zip', 'application/zip', {
      confirmCompletion: true,
    });
    expect(ok).toBe(false);
  });

  test('保存先が確定して書き込めたら true', async () => {
    const written: unknown[] = [];
    w.showSaveFilePicker = () =>
      Promise.resolve({
        createWritable: () =>
          Promise.resolve({
            write: (b: unknown) => {
              written.push(b);
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
          }),
      });
    const ok = await saveFile(new TextEncoder().encode('x'), 'a.zip', 'application/zip', {
      confirmCompletion: true,
    });
    expect(ok).toBe(true);
    expect(written).toHaveLength(1);
  });

  test('picker が無い環境（<a> ダウンロード）は true', async () => {
    delete w.showSaveFilePicker;
    const ok = await saveFile(new TextEncoder().encode('x'), 'a.zip', 'application/zip', {
      confirmCompletion: true,
    });
    expect(ok).toBe(true);
  });

  test('confirmCompletion を指定しなければ picker があっても <a> のまま', async () => {
    let pickerCalled = false;
    w.showSaveFilePicker = () => {
      pickerCalled = true;
      return Promise.reject(new DOMException('cancel', 'AbortError'));
    };
    // .xtx・CSV の書き出しはこちら。picker を挟むと e2e の download イベントが来なくなる。
    const ok = await saveFile(new TextEncoder().encode('x'), 'a.xtx', 'application/xml');
    expect(pickerCalled).toBe(false);
    expect(ok).toBe(true);
  });
});
