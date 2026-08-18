// デスクトップ版でのみ走る初期化スクリプトのソース。esbuild で IIFE に束ねて
// src-tauri/init.js を生成し、Rust 側が include_str! で読み込んでページの
// スクリプトより前に実行する。
//
// プラグインの JS API は npm パッケージとして別配布で、`withGlobalシェル` では注入されない
// （実機で確認：window.__TAURI__ に入るのは app/core/dpi/event/image/menu/mocks/
// path/tray/webview/webviewWindow/window だけ）。そのためデスクトップ側の repo で束ねて、
// 必要な入口だけを window.__aoikoNative へ出す。公開 repo の依存は増えない。
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { exportFile, readBackupFile, writeBackupFile } from './file-io.js';
import { frameRequest, parseReplyFrame, requestMeta } from './frame.js';

function isExternal(url) {
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return url.origin !== location.origin;
  }
  return false;
}

// 印刷とリンクの扱いだけプラットフォームで分ける。値は起動後変わらないため
// 一度だけ問い合わせて使い回す。
let isIosCache;
async function isIos() {
  if (isIosCache === undefined) {
    isIosCache = await invoke('is_ios');
  }
  return isIosCache;
}
// バックアップフォルダ（issue #38）。選択も記録も解決も、その配下の読み書きも
// plugin-aoiko-native が持つ。こちらから場所を指定する手段が無いのが要点で、渡せるのは
// フォルダからの相対パスだけ＝ページ上の任意のスクリプトが好きな場所を開かせることもできない。
// 移動・削除・権限切れはすべて ready=false になり、web 側は「選び直し」で一律に回復する。
async function backupFolderReady() {
  const resolved = await invoke('plugin:aoiko-native|resolve_folder');
  return resolved.ready;
}
// 公開 repo の src/lib/save-file.ts から呼ぶ唯一の入口。
// data は Uint8Array か ReadableStream。どちらもチャンクへ割って逐次書き込むので、
// 数 GiB の zip 全体をメモリに載せない。
window.__aoikoNative = {
  // デスクトップは保存ダイアログ、ある環境 はアプリの Documents 直下。どちらを通るかは
  // プラグイン側だけが決める（ある環境 には保存先を選ばせる仕組みが無い）。
  async saveFile(data, filename) {
    return exportFile(invoke, data, filename);
  },

  // ネイティブメニューは WebView の外にあるので、公開 repo のメッセージカタログを読めない。
  // 言語の切り替えはページの再読み込みを伴うため、読み込みのたびに現在の言語を渡す。
  // 同じ言語なら Rust 側は何もしない。
  async setUiLocale(locale) {
    return invoke('set_ui_locale', { locale });
  },

  // 取り消しは null。戻り値の token は web 側が保管するだけで、解決には使われない。
  async backupChooseFolder() {
    return invoke('plugin:aoiko-native|pick_folder');
  },
  // 引数の token は契約を合わせるためだけに受ける（下の 5 つも同じ）。
  async backupIsReady() {
    // ここは契約上 false を返すだけで、例外を投げてはいけない。IPC 失敗や権限エラーで
    // reject すると呼出側の初期化ごと落ち、状態表示が「初期化中」で固まったまま保存要求
    // だけが走り続ける。解決できない理由は「選び直し」で一律に回復するので区別しない。
    try {
      return await backupFolderReady();
    } catch {
      return false;
    }
  },

  async backupWrite(_token, fileName, data) {
    await writeBackupFile(invoke, fileName, data);
  },

  async backupList() {
    return invoke('plugin:aoiko-native|backup_list', {});
  },

  async backupListDir(_token, subdir) {
    return invoke('plugin:aoiko-native|backup_list', { subdir });
  },

  async backupRead(_token, path) {
    return readBackupFile(invoke, path);
  },

  async backupRemove(_token, fileName) {
    await invoke('plugin:aoiko-native|backup_remove', { relPath: fileName });
  },
};

// 1. 外部 API への fetch を IPC へ回す。WebView の origin は tauri://localhost で、
//    本機 Ollama の CORS allowlist には載っていないため素の fetch は拒否される。
//    同一 origin の取得（tesseract の worker・wasm・traineddata 等）は素のまま通す。
async function rawIpcFetch(req, body) {
  let reply;
  try {
    reply = new Uint8Array(await invoke('aoiko_fetch', frameRequest(requestMeta(req), body)));
  } catch (e) {
    // 素の fetch は通信の失敗を TypeError で投げる。公開 repo の判定（describeLlmError）が
    // それ前提で書かれているので、invoke の拒否をここで同じ形に揃える。
    throw new TypeError(typeof e === 'string' ? e : String(e));
  }
  const { head, payload } = parseReplyFrame(reply);
  return new Response(payload.byteLength > 0 ? payload : null, {
    status: head.status,
    statusText: head.statusText,
    headers: head.headers,
  });
}

async function externalFetch(input, init) {
  // 入力の形（文字列 / URL / Request、headers も Headers / object / 配列）を Request 1 つへ
  // 潰してから読む。body を文字列で渡されたときの content-type もここで確定する。
  const req = new Request(input, init);
  const body = await req.arrayBuffer();
  return rawIpcFetch(req, body);
}

const browserFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  const raw =
    typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  let url;
  try {
    url = new URL(raw, location.href);
  } catch {
    return browserFetch(input, init);
  }
  // ある環境 の IPC は http://ipc.localhost を通るため isExternal では外部扱いになる。素の
  // fetch へ戻さないと invoke がこの上書きを再入して止まらない（ある環境 の ipc://localhost は
  // protocol の時点で外れる）。
  if (!isExternal(url) || url.host === 'ipc.localhost') {
    return browserFetch(input, init);
  }
  return externalFetch(input, init);
};

// 2. 外部リンクを OS 標準のブラウザで開く。Rust 側の on_navigation はナビゲーションしか拾えず、
//    target="_blank" は新規ウィンドウの要求として別経路を通るため素通りする。実機では
//    マニュアルの外部リンクを押してもウィンドウは動かずブラウザも開かない＝無反応だった。
document.addEventListener(
  'click',
  function (e) {
    const anchor = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (anchor === null) {
      return;
    }
    let url;
    try {
      url = new URL(anchor.getAttribute('href'), location.href);
    } catch {
      return;
    }
    const isMail = url.protocol === 'mailto:' || url.protocol === 'tel:';
    if (!isExternal(url) && !isMail) {
      return;
    }
    e.preventDefault();
    void openExternal(url, isMail);
  },
  true,
);
// ある環境/ある環境 は SFあるブラウザViewController でアプリの上に重ねる。あるブラウザ へ飛ばすと
// アプリごと切り替わり、戻るのに手数が要る。mailto:/tel: は対象外なので OS へ渡す。
async function openExternal(url, isMail) {
  if (!isMail && (await isIos())) {
    await invoke('plugin:aoiko-native|open_in_app', { url: url.href });
    return;
  }
  await openUrl(url.href);
}

// 3. ネイティブのウィンドウ終了要求を web 版の未保存ガードへ繋ぐ。シェル の終了では beforeunload が
//    発火しない。router.svelte.ts が登録済みのリスナーをそのまま使えるよう、合成
//    イベントを投げて preventDefault の有無を見る。判定をデスクトップ版で書き直さない。
window.__aoikoRequestClose = async function () {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  if (event.defaultPrevented) {
    // 確認ダイアログもプラグイン側で出す。webview には dialog の権限を 1 つも渡していない。
    const discard = await invoke('plugin:aoiko-native|confirm_discard', {
      message: '保存していない入力内容があります。破棄して終了しますか？',
      okLabel: '破棄して終了',
      cancelLabel: '編集を続ける',
    });
    if (!discard) {
      return;
    }
  }
  await invoke('force_close');
};
// CLOSE_SCRIPT が未保存ガードを経ずに直接終了するときの入口。以前は withGlobalシェル で
// 注入される window.__TAURI__.core.invoke を直接呼んでいたが、この関数を出すだけで足りるため
// tauri.conf.json 側のフラグごと不要になった（__aoikoRequestClose と同じタイミングで定義される）。
window.__aoikoForceClose = function () {
  return invoke('force_close');
};
// 再読み込みも終了と同じ未保存ガードを通す。CmdOrCtrl+R がそのまま location.reload() を
// 呼ぶと beforeunload は発火してもブラウザのような確認パネルが出ず、素通りしてしまう。
window.__aoikoRequestReload = async function () {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  if (event.defaultPrevented) {
    const discard = await invoke('plugin:aoiko-native|confirm_discard', {
      message: '保存していない入力内容があります。破棄して再読み込みしますか？',
      okLabel: '破棄して再読み込み',
      cancelLabel: '編集を続ける',
    });
    if (!discard) {
      return;
    }
  }
  location.reload();
};
// 4. 印刷をネイティブへ回す。web view の window.print() は例外を投げるため（tauri#3066）、
//    請求書の印刷ボタンを押してもダイアログが開かず、未捕捉例外のバナーが出るだけだった。
//    印刷スタイルは公開 repo に揃っているので、出力は web view 自身に描かせる。
window.print = function () {
  void (async () => {
    // デスクトップの print_page は web view / web view をそれぞれ直接叩く実装で、
    // ある環境 には無い。ある環境 は plugin 側の UIPrintInteractionController へ回す。
    await invoke((await isIos()) ? 'plugin:aoiko-native|print_page' : 'print_page');
  })();
};
// 5. 永続化ストレージの判定をこの環境の実情に合わせる。web view の persist() は免除リスト
//    （app-bound / managed / persisted / standalone）にある origin にしか true を返さず、
//    app-bound は死んでおり残り 2 つは SPI なので、第三者アプリは公開 API では到達できない。
//    false は「破棄される」ではなく「リストに入れない」でしかないため、web 版の警告文は
//    ここでは過大。実際に残るクォータ退避は persist() では防げず、フォルダへの自動
//    バックアップ（__aoikoNative.backup*）で担保する。
if (navigator.storage !== undefined) {
  navigator.storage.persisted = async function () {
    return true;
  };
  navigator.storage.persist = async function () {
    return true;
  };
}
