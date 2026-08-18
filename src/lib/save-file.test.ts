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

  test('保存先の選択を取り消したら cancelled（時刻を刻ませない）', async () => {
    w.showSaveFilePicker = () => Promise.reject(new DOMException('cancel', 'AbortError'));
    const result = await saveFile(new TextEncoder().encode('x'), 'a.zip', 'application/zip', {
      confirmCompletion: true,
    });
    expect(result).toBe('cancelled');
  });

  test('保存先が確定して書き込めたら saved', async () => {
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
    const result = await saveFile(new TextEncoder().encode('x'), 'a.zip', 'application/zip', {
      confirmCompletion: true,
    });
    expect(result).toBe('saved');
    expect(written).toHaveLength(1);
  });

  // picker が無い環境（<a> ダウンロード）は完了も取消も観測できないため unknown。
  // ここを saved にすると、取消したダウンロードが「保存済み」として記録される（issue#390）。
  test('picker が無い環境（<a> ダウンロード）は unknown', async () => {
    delete w.showSaveFilePicker;
    const result = await saveFile(new TextEncoder().encode('x'), 'a.zip', 'application/zip', {
      confirmCompletion: true,
    });
    expect(result).toBe('unknown');
  });

  test('confirmCompletion を指定しなければ picker があっても <a> のまま', async () => {
    let pickerCalled = false;
    w.showSaveFilePicker = () => {
      pickerCalled = true;
      return Promise.reject(new DOMException('cancel', 'AbortError'));
    };
    // .xtx・CSV の書き出しはこちら。picker を挟むと e2e の download イベントが来なくなる。
    const result = await saveFile(new TextEncoder().encode('x'), 'a.xtx', 'application/xml');
    expect(pickerCalled).toBe(false);
    expect(result).toBe('unknown');
  });
});
// FileSystemWritableFileStream の代役。ReadableStream 経路は WritableStream として
// pipeTo され、バイト列経路は write/close を呼ぶため、両方を備えたものを用意する。
class FakeWritable extends WritableStream<Uint8Array> {
  readonly chunks: Uint8Array[];
  closed = false;

  constructor() {
    const chunks: Uint8Array[] = [];
    super({
      write(chunk) {
        chunks.push(chunk);
      },
    });
    this.chunks = chunks;
  }

  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('picker を中身の組み立てより先に呼ぶ（issue#386）', () => {
  const w = window as unknown as { showSaveFilePicker?: unknown };
  afterEach(() => {
    delete w.showSaveFilePicker;
  });

  test('データ生成関数は保存先が確定してから実行される', async () => {
    const order: string[] = [];
    const writable = new FakeWritable();
    w.showSaveFilePicker = () => {
      order.push('picker');
      return Promise.resolve({ createWritable: () => Promise.resolve(writable) });
    };
    const ok = await saveFile(
      async () => {
        order.push('build');
        return new Uint8Array([1, 2, 3]);
      },
      'a.zip',
      'application/zip',
      { confirmCompletion: true },
    );
    expect(ok).toBe('saved');
    expect(order).toEqual(['picker', 'build']);
  });
  // 取り消したのに zip を組み立てると、大きな帳簿で無駄に待たされる。
  test('保存先の選択を取り消したらデータ生成関数は呼ばれない', async () => {
    const build = vi.fn();
    w.showSaveFilePicker = () => Promise.reject(new DOMException('cancel', 'AbortError'));
    const ok = await saveFile(build, 'a.zip', 'application/zip', { confirmCompletion: true });
    expect(ok).toBe('cancelled');
    expect(build).not.toHaveBeenCalled();
  });

  test('AbortError 以外の picker の失敗はそのまま投げる', async () => {
    w.showSaveFilePicker = () => Promise.reject(new DOMException('no gesture', 'SecurityError'));
    await expect(
      saveFile(new Uint8Array([1]), 'a.zip', 'application/zip', { confirmCompletion: true }),
    ).rejects.toThrow('no gesture');
  });
  // 保存先が決まった後の失敗を取消（false）扱いにすると、書き出せていないのに
  // 「バックアップ済み」の時刻が刻まれてしまう。
  test('保存先の確定後の失敗は false ではなく例外で伝える', async () => {
    w.showSaveFilePicker = () =>
      Promise.resolve({
        createWritable: () =>
          Promise.reject(new DOMException('locked', 'NoModificationAllowedError')),
      });
    await expect(
      saveFile(new Uint8Array([1]), 'a.zip', 'application/zip', { confirmCompletion: true }),
    ).rejects.toThrow('locked');
  });
  // zip 全体を Blob に展開すると、ストリーミングで抑えたメモリ増が元に戻る。
  test('ReadableStream は Blob 化せず pipeTo で流す', async () => {
    const writable = new FakeWritable();
    const blobSpy = vi.spyOn(Response.prototype, 'blob');
    w.showSaveFilePicker = () =>
      Promise.resolve({ createWritable: () => Promise.resolve(writable) });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    const ok = await saveFile(stream, 'a.zip', 'application/zip', { confirmCompletion: true });
    expect(ok).toBe('saved');
    expect(writable.chunks.map((c) => [...c])).toEqual([[1, 2], [3]]);
    expect(blobSpy).not.toHaveBeenCalled();
  });

  test('<a> ダウンロード経路でも遅延生成の関数を受け取れる', async () => {
    const ok = await saveFile(async () => new Uint8Array([7]), 'a.csv', 'text/csv');
    expect(ok).toBe('unknown');
    expect(new Uint8Array(await created[0]!.arrayBuffer())).toEqual(new Uint8Array([7]));
  });
});

describe('ネイティブのシェルがあるとき', () => {
  afterEach(() => {
    delete (window as unknown as { __aoikoNative?: unknown }).__aoikoNative;
  });

  test('保存はシェルへ渡し、<a> ダウンロードは行わない', async () => {
    const calls: { filename: string; data: unknown }[] = [];
    (window as unknown as { __aoikoNative?: unknown }).__aoikoNative = {
      saveFile: async (data: unknown, filename: string) => {
        calls.push({ filename, data });
        return true;
      },
    };
    const result = await saveFile(new Uint8Array([1, 2]), 'a.zip', 'application/zip');
    expect(result).toBe('saved');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.filename).toBe('a.zip');
    expect(clicked).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  test('シェルが false を返したら cancelled', async () => {
    (window as unknown as { __aoikoNative?: unknown }).__aoikoNative = {
      saveFile: async () => false,
    };
    expect(await saveFile(new Uint8Array([1]), 'a.zip', 'application/zip')).toBe('cancelled');
  });
  // 遅延生成を受け付けるのは picker の transient activation 対策（#386）で、
  // シェル側にその制限は無い。ダイアログの前に解決してよい。
  test('遅延生成の関数も解決してから渡す', async () => {
    let made = 0;
    (window as unknown as { __aoikoNative?: unknown }).__aoikoNative = {
      saveFile: async () => true,
    };
    await saveFile(
      async () => {
        made += 1;
        return new Uint8Array([9]);
      },
      'a.zip',
      'application/zip',
    );
    expect(made).toBe(1);
  });
  // saveFile を持たないシェル（能力が段階的に増える）ではブラウザ経路へ落ちる。
  test('saveFile を持たない橋渡しなら <a> ダウンロードのまま', async () => {
    (window as unknown as { __aoikoNative?: unknown }).__aoikoNative = {
      setUiLocale: async () => {},
    };
    expect(await saveFile(new Uint8Array([1]), 'a.zip', 'application/zip')).toBe('unknown');
    expect(clicked).toHaveLength(1);
  });
});
