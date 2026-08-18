import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHUNK_SIZE,
  exportFile,
  readBackupFile,
  resetChunkTransportForTests,
  writeBackupFile,
} from './file-io.js';
// invoke そのものは試さない。ここで固定するのは「どのコマンドへ何という名前の引数を
// 渡すか」と、チャンク分割・rid の後始末・応答の解き方。
function fakeInvoke(replies = {}) {
  const calls = [];
  async function invoke(cmd, args, options) {
    calls.push({ cmd, args, options });
    const reply = replies[cmd];
    return typeof reply === 'function' ? reply(args, options) : reply;
  }
  return { calls, invoke };
}

function names(calls) {
  return calls.map((call) => call.cmd.replace('plugin:aoiko-native|', ''));
}

function bodies(calls) {
  return calls.filter((call) => call.cmd.endsWith('backup_write_chunk')).map((call) => call.args);
}

function concat(parts) {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}
// Rust 側 backup::read が返す枠。[4 バイト LE: meta 長][meta JSON][本文]。
function framed(meta, body) {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const reply = new Uint8Array(4 + metaBytes.byteLength + body.byteLength);
  new DataView(reply.buffer).setUint32(0, metaBytes.byteLength, true);
  reply.set(metaBytes, 4);
  reply.set(body, 4 + metaBytes.byteLength);
  return reply.buffer;
}

test('Uint8Array は CHUNK_SIZE ごとに割られ、繋ぎ直すと元に戻る', async () => {
  const sent = new Uint8Array(CHUNK_SIZE * 2 + 7);
  for (let i = 0; i < sent.byteLength; i += 1) {
    sent[i] = i % 251;
  }
  const { calls, invoke } = fakeInvoke({ 'plugin:aoiko-native|backup_open': 3 });
  await writeBackupFile(invoke, 'aoiko-ledger.zip', sent);

  // Rust の rel_path は シェル が camelCase へ寄せた relPath で届く。
  assert.deepEqual(calls[0].args, { relPath: 'aoiko-ledger.zip' });
  assert.deepEqual(names(calls), [
    'backup_open',
    'backup_write_chunk',
    'backup_write_chunk',
    'backup_write_chunk',
    'backup_close',
  ]);
  assert.deepEqual(
    bodies(calls).map((chunk) => chunk.byteLength),
    [CHUNK_SIZE, CHUNK_SIZE, 7],
  );
  assert.deepEqual(concat(bodies(calls)), sent);
  assert.deepEqual(calls.at(-1).args, { rid: 3 });
});

test('チャンクは生バイトのまま、rid はヘッダーで渡る', async () => {
  const { calls, invoke } = fakeInvoke({ 'plugin:aoiko-native|backup_open': 7 });
  await writeBackupFile(invoke, 'snapshots/a.json', new Uint8Array([1, 2, 3]));

  const [chunk] = calls.filter((call) => call.cmd.endsWith('backup_write_chunk'));
  assert.ok(ArrayBuffer.isView(chunk.args), '生バイトでないと JSON へ載って膨らむ');
  assert.deepEqual(chunk.options, { headers: { 'x-aoiko-rid': '7' } });
});

test('空の Uint8Array でも開いて閉じる（空ファイルは作られる）', async () => {
  const { calls, invoke } = fakeInvoke({ 'plugin:aoiko-native|backup_open': 1 });
  await writeBackupFile(invoke, 'empty.bin', new Uint8Array(0));
  assert.deepEqual(names(calls), ['backup_open', 'backup_close']);
});

test('ReadableStream は溜めずに、1 チャンク埋まった時点から書き始める', async () => {
  const total = 3;
  let produced = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (produced === total) {
        controller.close();
        return;
      }
      produced += 1;
      controller.enqueue(new Uint8Array(CHUNK_SIZE).fill(produced));
    },
  });
  const producedAtWrite = [];
  const { calls, invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_open': 2,
    'plugin:aoiko-native|backup_write_chunk': () => {
      producedAtWrite.push(produced);
    },
  });
  await writeBackupFile(invoke, 'stream.zip', stream);

  // 全部読んでから書くと、最初の書き込みの時点で produced が total に達している。
  assert.ok(producedAtWrite[0] < total, `溜めてから書いている: ${producedAtWrite[0]}`);
  assert.deepEqual(
    bodies(calls).map((chunk) => chunk.byteLength),
    [CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE],
  );
  assert.equal(names(calls).at(-1), 'backup_close');
});

test('細切れのチャンクはまとめて送られ、繋ぎ直すと元に戻る', async () => {
  const parts = [];
  for (let i = 0; i < 5000; i += 1) {
    parts.push(new Uint8Array(1000).fill(i % 251));
  }
  const sent = concat(parts);
  let next = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (next === parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(parts[next]);
      next += 1;
    },
  });
  const { calls, invoke } = fakeInvoke({ 'plugin:aoiko-native|backup_open': 8 });
  await writeBackupFile(invoke, 'many.zip', stream);

  // 届いた幅のまま送ると 5000 往復になる。端数の 1 本も落とさない。
  assert.deepEqual(
    bodies(calls).map((chunk) => chunk.byteLength),
    [CHUNK_SIZE, sent.byteLength - CHUNK_SIZE],
  );
  assert.deepEqual(concat(bodies(calls)), sent);
});

test('チャンクの書き込みが落ちても閉じる', async () => {
  const { calls, invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_open': 4,
    'plugin:aoiko-native|backup_write_chunk': () => {
      throw new Error('ディスクがいっぱいです');
    },
  });
  await assert.rejects(
    () => writeBackupFile(invoke, 'a.zip', new Uint8Array([1])),
    /ディスクがいっぱいです/,
  );
  // 閉じ損ねた rid は File を掴んだまま同時 8 本の枠を埋め、以後の書き出しを全部落とす。
  // 生バイトが弾かれた理由は JS 側では分からないので、載せ方を変えて 1 度だけ試す。
  // だから write_chunk は 2 回出る。
  assert.deepEqual(names(calls), [
    'backup_open',
    'backup_write_chunk',
    'backup_write_chunk',
    'backup_close',
  ]);
  assert.deepEqual(calls.at(-1).args, { rid: 4 });
});

test('書き込みと close が両方落ちたら、伝わるのは書き込みの側', async () => {
  const { calls, invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_open': 9,
    'plugin:aoiko-native|backup_write_chunk': () => {
      throw new Error('ディスクがいっぱいです');
    },
    'plugin:aoiko-native|backup_close': () => {
      throw new Error('閉じられません');
    },
  });
  // close の失敗が原因を覆い隠すと、呼出側にも記録にも「閉じられません」しか残らない。
  await assert.rejects(
    () => writeBackupFile(invoke, 'a.zip', new Uint8Array([1])),
    /ディスクがいっぱいです/,
  );
  assert.deepEqual(names(calls), [
    'backup_open',
    'backup_write_chunk',
    'backup_write_chunk',
    'backup_close',
  ]);
});

test('書き込みが通って close だけ落ちたら、その失敗は伝わる', async () => {
  const { invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_open': 10,
    'plugin:aoiko-native|backup_close': () => {
      throw new Error('閉じられません');
    },
  });
  // 書き切れたか分からないファイルを「保存済み」で通すと、壊れたバックアップに気付けない。
  await assert.rejects(
    () => writeBackupFile(invoke, 'a.zip', new Uint8Array([1])),
    /閉じられません/,
  );
});

test('保存ダイアログの取り消しは false で、書き込みも close も走らない', async () => {
  const { calls, invoke } = fakeInvoke({ 'plugin:aoiko-native|export_open': null });
  assert.equal(await exportFile(invoke, new Uint8Array([1, 2]), 'aoiko-ledger.zip'), false);
  assert.deepEqual(names(calls), ['export_open']);
  // Rust の file_name は fileName で届く。
  assert.deepEqual(calls[0].args, { fileName: 'aoiko-ledger.zip' });
});

test('保存できたら true', async () => {
  const { calls, invoke } = fakeInvoke({ 'plugin:aoiko-native|export_open': 6 });
  assert.equal(await exportFile(invoke, new Uint8Array([1, 2]), 'aoiko-ledger.zip'), true);
  assert.deepEqual(names(calls), ['export_open', 'backup_write_chunk', 'backup_close']);
});

test('読み出しは枠を解いて本文を返す', async () => {
  const body = new TextEncoder().encode('{"ok":true}');
  const { calls, invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_read': framed({ found: true }, body),
  });
  assert.deepEqual(await readBackupFile(invoke, 'blobs/ab/cd.json'), body);
  assert.deepEqual(calls[0].args, { relPath: 'blobs/ab/cd.json' });
});

test('読み出しは応答バッファのコピーを返す', async () => {
  const body = new TextEncoder().encode('{"ok":true}');
  const { invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_read': framed({ found: true }, body),
  });
  const first = await readBackupFile(invoke, 'a.json');
  first[0] = 0;
  // view のまま返すと、1 度目の書き換えが同じ応答バッファを指す 2 度目に残る。
  assert.deepEqual(await readBackupFile(invoke, 'a.json'), body);
});

test('空のファイルは長さ 0 の Uint8Array で、null ではない', async () => {
  const { invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_read': framed({ found: true }, new Uint8Array(0)),
  });
  const got = await readBackupFile(invoke, 'empty.bin');
  assert.notEqual(got, null);
  assert.equal(got.byteLength, 0);
});

test('見つからないファイルは null（まだ同期されていない、を空と区別する）', async () => {
  const { invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_read': framed({ found: false }, new Uint8Array(0)),
  });
  assert.equal(await readBackupFile(invoke, 'absent.zip'), null);
});
test('生バイトが弾かれたら base64 で載せ直して書き切る', async () => {
  resetChunkTransportForTests();
  const written = [];
  const { calls, invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_open': 1,
    'plugin:aoiko-native|backup_write_chunk': (args) => {
      // custom protocol IPC が落ちた後、ArrayBuffer は Rust へ生バイトとして届かない。
      if (args instanceof Uint8Array) {
        throw new Error('書き込みの指定が不正です: チャンクは ArrayBuffer で渡してください');
      }
      written.push(Buffer.from(args.b64, 'base64'));
    },
  });
  const data = new Uint8Array([1, 2, 3, 250, 0, 255]);
  await writeBackupFile(invoke, 'a.zip', data);
  assert.deepEqual(names(calls), [
    'backup_open',
    'backup_write_chunk',
    'backup_write_chunk',
    'backup_close',
  ]);
  // 経路が変わっても中身は変わらない。
  assert.deepEqual(new Uint8Array(Buffer.concat(written)), data);
  assert.equal(bodies(calls).at(-1).rid, 1);
});

test('一度落ちたら以降は最初から base64（生バイトを毎回試さない）', async () => {
  resetChunkTransportForTests();
  const { calls, invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_open': 2,
    'plugin:aoiko-native|backup_write_chunk': (args) => {
      if (args instanceof Uint8Array) {
        throw new Error('生バイトは届きません');
      }
    },
  });
  await writeBackupFile(invoke, 'a.zip', new Uint8Array([1]));
  await writeBackupFile(invoke, 'b.zip', new Uint8Array([2]));
  const chunks = bodies(calls);
  // 1 本目は生バイト → base64 の 2 回、2 本目は base64 だけの 1 回。
  assert.equal(chunks.length, 3);
  assert.ok(chunks[0] instanceof Uint8Array);
  assert.equal(typeof chunks[1].b64, 'string');
  assert.equal(typeof chunks[2].b64, 'string');
});

test('base64 でも書けなければ、伝わるのは生バイト側の失敗', async () => {
  resetChunkTransportForTests();
  const { invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_open': 3,
    'plugin:aoiko-native|backup_write_chunk': (args) => {
      // 本当に書けない状態。載せ方の問題ではないので、原因の方を残す。
      throw new Error(args instanceof Uint8Array ? 'ディスクがいっぱいです' : 'base64 が不正です');
    },
  });
  await assert.rejects(
    () => writeBackupFile(invoke, 'a.zip', new Uint8Array([1])),
    /ディスクがいっぱいです/,
  );
});

test('CHUNK_SIZE 一杯のチャンクでも base64 に変換できる', async () => {
  resetChunkTransportForTests();
  const written = [];
  const { invoke } = fakeInvoke({
    'plugin:aoiko-native|backup_open': 4,
    'plugin:aoiko-native|backup_write_chunk': (args) => {
      if (args instanceof Uint8Array) {
        throw new Error('生バイトは届きません');
      }
      written.push(Buffer.from(args.b64, 'base64'));
    },
  });
  // String.fromCharCode(...bytes) に丸ごと渡すと引数の上限で落ちる大きさ。
  const data = new Uint8Array(CHUNK_SIZE);
  for (let i = 0; i < data.length; i++) {
    data[i] = i % 256;
  }
  await writeBackupFile(invoke, 'a.zip', data);
  assert.deepEqual(new Uint8Array(Buffer.concat(written)), data);
});
