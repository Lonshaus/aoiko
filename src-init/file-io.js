// window.__aoikoNative のファイル入出力。プラグインのコマンドを呼ぶだけの層だが、
// チャンク分割・rid の後始末・見つからないファイルの扱いはここにしか無い。
// invoke を引数で受けるのは、window も シェル も無い node --test から回すため（frame.js と同じ）。
//
// Rust の引数名は snake_case だが、JS から渡す名前は シェル が camelCase へ寄せた側。
// commands.rs の rel_path / file_name は relPath / fileName で送る。
import { parseReplyFrame } from './frame.js';
// IPC 1 往復ぶんの大きさ。1 本にまとめると数百 MiB のコピーが webview 側と Rust 側に
// 同時に載り、細かすぎると往復回数だけが増える。
//
// ある環境 の実機で 300 MiB を書いて測った結果、頭打ちはこの幅で来ている。
// 256 KiB=520 MB/s（1200 往復）、1 MiB=2013 MB/s（300 往復）、4 MiB=3000 MB/s（75 往復）、
// 16 MiB=3000 MB/s（19 往復）。16 MiB へ上げても速度は変わらず、1 往復あたりの
// 山だけが 4 倍になる。
export const CHUNK_SIZE = 4 * 1024 * 1024;

async function* chunksOf(data) {
  // ReadableStream が刻む幅は生成側の都合で決まる。そのまま流すと 1 片ごとに IPC が 1 往復
  // 増え、全部溜めると証憑写真込みの zip 全体がメモリに載る。抱えるのは常に 1 チャンクまで。
  if (typeof data.getReader === 'function') {
    const reader = data.getReader();
    let buffer = new Uint8Array(CHUNK_SIZE);
    let filled = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done === true) {
        break;
      }
      let offset = 0;
      while (offset < value.byteLength) {
        const take = Math.min(CHUNK_SIZE - filled, value.byteLength - offset);
        buffer.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === CHUNK_SIZE) {
          yield buffer;
          // 送り終えた buffer は使い回さない。呼出側が参照を持ち越していると、次のチャンクの
          // 書き込みで中身を差し替えてしまう。
          buffer = new Uint8Array(CHUNK_SIZE);
          filled = 0;
        }
      }
    }
    // 端数を捨てると zip が末尾で切れる。
    if (filled > 0) {
      yield buffer.subarray(0, filled);
    }
    return;
  }
  for (let offset = 0; offset < data.byteLength; offset += CHUNK_SIZE) {
    yield data.subarray(offset, offset + CHUNK_SIZE);
  }
}
// シェル の custom protocol IPC は一度失敗すると customProtocolIpcFailed が立ち、以降
// そのページでは postMessage へ固定される（tauri/scripts/ipc-protocol.js）。旗は閉包の
// 中なので消せず、再読込まで戻らない。その状態では ArrayBuffer が JSON 化されて Rust に
// 生バイトとして届かず、書き出しが全部落ちる。
//
// 落とさずに済ませる。一度落ちたら以降は base64 で載せる。1.37 倍に膨らむが、数字の配列
// （1 バイトが数字 1 個。#26）とは桁が違う。速度は落ちても書き切れる方を採る。
let rawChunksUnavailable = false;
// テストから経路の記憶を戻すためだけの口。実行時に呼ぶ場所は無い。
export function resetChunkTransportForTests() {
  rawChunksUnavailable = false;
}

function toBase64(bytes) {
  // String.fromCharCode(...bytes) は 4 MiB 分を一度に展開すると引数の上限を超える。
  let binary = '';
  const STEP = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += STEP) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + STEP));
  }
  return btoa(binary);
}

async function sendChunk(invoke, rid, chunk) {
  if (!rawChunksUnavailable) {
    try {
      // 生バイトを引数そのものとして渡したときだけ octet-stream で届く。行き先の rid は
      // 本文に混ぜられないのでヘッダーに載せる。
      await invoke('plugin:aoiko-native|backup_write_chunk', chunk, {
        headers: { 'x-aoiko-rid': String(rid) },
      });
      return;
    } catch (rawError) {
      // 経路が変わっただけなのか、本当に書けないのかはここでは区別できない。載せ方を
      // 変えて一度だけ試し、それも駄目なら最初の失敗をそのまま返す（「ディスクが
      // いっぱい」が「base64 が不正」に化けると原因を追えなくなる）。
      try {
        await invoke('plugin:aoiko-native|backup_write_chunk', {
          rid,
          b64: toBase64(chunk),
        });
      } catch {
        throw rawError;
      }
      rawChunksUnavailable = true;
      return;
    }
  }
  await invoke('plugin:aoiko-native|backup_write_chunk', { rid, b64: toBase64(chunk) });
}
// 開けた rid は途中で失敗しても必ず閉じる。開きっぱなしの rid は File を掴んだまま
// プラグインの同時 8 本の枠を埋め、以後の書き出しが全部落ちる。
async function writeAll(invoke, rid, data) {
  let written = false;
  try {
    for await (const chunk of chunksOf(data)) {
      if (chunk.byteLength > 0) {
        await sendChunk(invoke, rid, chunk);
      }
    }
    written = true;
  } finally {
    try {
      await invoke('plugin:aoiko-native|backup_close', { rid });
    } catch (closeError) {
      // 書き込みが落ちているなら原因はそちら。close の失敗で上書きすると、
      // 「ディスクがいっぱい」が「閉じられません」に化けて呼出側に届く。
      if (written) {
        throw closeError;
      }
    }
  }
}

export async function writeBackupFile(invoke, relPath, data) {
  const rid = await invoke('plugin:aoiko-native|backup_open', { relPath });
  await writeAll(invoke, rid, data);
}
// 台帳の書き出し。戻り値は「保存したか」。取り消し（rid が null）を握り潰すと、公開 repo の
// downloadBackup が書き出していない export に最終ダウンロード時刻を刻み、
// 「端末外バックアップがありません」の警告が消えたままになる。
export async function exportFile(invoke, data, fileName) {
  const rid = await invoke('plugin:aoiko-native|export_open', { fileName });
  if (rid === null) {
    return false;
  }
  await writeAll(invoke, rid, data);
  return true;
}
// 見つからなければ null。「まだ同期されていない」は正常な分岐で、呼出側は長さ 0 の
// ファイルと区別する。本文の有無では表せないので meta が前に付いている。
export async function readBackupFile(invoke, relPath) {
  const reply = new Uint8Array(await invoke('plugin:aoiko-native|backup_read', { relPath }));
  const { head, payload } = parseReplyFrame(reply);
  // payload は応答バッファへの view。そのまま返すと、呼出側が書き換えたつもりの無い
  // 領域まで巻き添えで壊れる。持ち主を分けて渡す。
  return head.found ? payload.slice() : null;
}
