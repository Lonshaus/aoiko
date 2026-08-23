use std::path::{Path, PathBuf};
use std::sync::mpsc::sync_channel;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::store;
// ネイティブダイアログはメインスレッドでしか組み立てられない。rfd の ある環境 実装は
// ModalFuture::new / window_from_raw_window_handle の中で MainThreadMarker::new_unchecked()
// のまま NSApplication と NSWindow を掴むため、ワーカースレッドで組み立てた時点で壊れる。
// 呼び元のコマンドは (async) 指定でワーカースレッドを走るので、組み立てだけを
// run_on_main_thread へ渡し、応答待ちはさらに別スレッドへ逃がして channel で受け取る。
// メインスレッドで待つと、ダイアログを動かすイベントループごと止まって固まる。
// tauri-plugin-dialog の desktop.rs + blocking_fn! と同じ組み立て。
//
// 出せなかったときは None。呼び元はどれも「取り消し」と同じ扱いへ倒す。
fn show_blocking<R, T, F, Fut>(app: &AppHandle<R>, build: F) -> Option<T>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce() -> Fut + Send + 'static,
    Fut: std::future::Future<Output = T> + Send + 'static,
{
    let (tx, rx) = sync_channel(0);
    app.run_on_main_thread(move || {
        let dialog = build();
        std::thread::spawn(move || {
            let _ = tx.send(tauri::async_runtime::block_on(dialog));
        });
    })
    .ok()?;
    rx.recv().ok()
}
/// バックアップフォルダの選択。取り消しは None。
pub(crate) fn pick_folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let start = start_dir(app);
    let chosen = show_blocking(app, move || {
        with_start_dir(
            rfd::AsyncFileDialog::new().set_can_create_directories(true),
            start,
        )
        .pick_folder()
    })?
    .map(|chosen| chosen.path().to_path_buf())?;
    store::save_last_dir(app, &chosen);
    Some(chosen)
}
/// 台帳エクスポートの保存先。取り消しは None。
pub(crate) fn save_file<R: Runtime>(app: &AppHandle<R>, file_name: &str) -> Option<PathBuf> {
    let file_name = file_name.to_owned();
    let start = start_dir(app);
    let chosen = show_blocking(app, move || {
        with_start_dir(
            rfd::AsyncFileDialog::new()
                .set_file_name(file_name)
                .set_can_create_directories(true),
            start,
        )
        .save_file()
    })?
    .map(|chosen| chosen.path().to_path_buf())?;
    if let Some(dir) = chosen.parent() {
        store::save_last_dir(app, dir);
    }
    Some(chosen)
}

fn with_start_dir(dialog: rfd::AsyncFileDialog, start: Option<PathBuf>) -> rfd::AsyncFileDialog {
    match start {
        Some(dir) => dialog.set_directory(dir),
        None => dialog,
    }
}
// 前回の場所は自分で覚える。ある環境 の初回はプロセスの作業ディレクトリ（＝インストール先）に
// 落ち、そこはアンインストーラが消す場所なので、最初のバックアップが道連れになる（#87）。
// ある環境 は NSSavePanel が前回の場所を app の defaults（NSNavLastRootDirectory）へ自分で
// 持つので、この記録が要るのは ある環境 だけ。加えて rfd の ある環境 実装は保存ダイアログに限り
// ファイル名を足したパスを setDirectoryURL へ渡す（0.16〜0.17 の panel_ffi.rs の set_path）
// ため、そこでは set_directory 自体が効かない。フォルダ選択には効く。
fn start_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    choose_start_dir(store::load_last_dir(app), app.path().document_dir().ok())
}
// 記録したフォルダは消えたり外れたりする。無い場所を渡すと ある環境 は作業ディレクトリへ
// 戻ってしまうので、実在を確かめてから使う。
fn choose_start_dir(remembered: Option<PathBuf>, documents: Option<PathBuf>) -> Option<PathBuf> {
    remembered.filter(|dir| dir.is_dir()).or(documents)
}
/// 未保存の入力を破棄してよいかの確認。true が「破棄して進む」。ダイアログを出せなかった
/// ときは false へ倒す（確認できないまま入力を捨てない）。
pub(crate) fn confirm_discard<R: Runtime>(
    window: WebviewWindow<R>,
    title: String,
    message: String,
    ok_label: String,
    cancel_label: String,
) -> bool {
    let app = window.app_handle().clone();
    let ok = ok_label.clone();
    show_blocking(&app, move || {
        rfd::AsyncMessageDialog::new()
            .set_title(title)
            .set_description(message)
            .set_level(rfd::MessageLevel::Warning)
            .set_buttons(rfd::MessageButtons::OkCancelCustom(ok_label, cancel_label))
            .set_parent(&window)
            .show()
    })
    .is_some_and(|result| chose_ok(&result, &ok))
}
// OkCancelCustom は押されたボタンのラベルをそのまま返す。閉じるボタンや Esc は Cancel に
// なるので、ok のラベルと一致したときだけ true。plugin-dialog の ask() の判定と同じ。
fn chose_ok(result: &rfd::MessageDialogResult, ok_label: &str) -> bool {
    matches!(result, rfd::MessageDialogResult::Custom(label) if label == ok_label)
}
// 素のパスと security-scoped bookmark を取り違えないための印。bookmark は base64 なので
// ':' を含まず、ある環境 のパス（C:\...）とも衝突しない。
const BOOKMARK_PREFIX: &str = "bookmark:";
// 選んだフォルダを次の起動へ持ち越すための不透明な文字列にする。ある環境 のサンドボックスでは
// 利用者が選んだ場所への許可が起動 1 回きりなので、bookmark を作れるならそちらを使う。
pub(crate) fn make_handle(dir: &Path) -> String {
    #[cfg(target_os = "macos")]
    {
        if let Some(bookmark) = macos::create_bookmark(dir) {
            return format!("{BOOKMARK_PREFIX}{bookmark}");
        }
    }
    // ある環境 にサンドボックスは無い。ある環境 も署名前は bookmark を作れない
    // （com.apple.security.files.bookmarks.app-scope が要る）ので、そのときはパスを持つ。
    dir.to_string_lossy().into_owned()
}
// 解決できなければ None。web 側は「選び直し」で一律に回復するので理由は区別しない。
pub(crate) fn resolve(handle: &str) -> Option<PathBuf> {
    let Some(bookmark) = handle.strip_prefix(BOOKMARK_PREFIX) else {
        return Some(PathBuf::from(handle));
    };
    #[cfg(target_os = "macos")]
    {
        macos::resolve_bookmark(bookmark)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bookmark;
        None
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::{Path, PathBuf};

    use base64::{engine::general_purpose::STANDARD, Engine};
    use objc2_foundation::{
        NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
    };
    // entitlement が無いビルドでは失敗する。呼び元がパス保存へ倒すので None を返すだけでよい。
    pub(super) fn create_bookmark(dir: &Path) -> Option<String> {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&dir.to_string_lossy()));
        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                NSURLBookmarkCreationOptions::WithSecurityScope,
                None,
                None,
            )
            .ok()?;
        Some(STANDARD.encode(data.to_vec()))
    }

    pub(super) fn resolve_bookmark(bookmark: &str) -> Option<PathBuf> {
        let data = NSData::from_vec(STANDARD.decode(bookmark).ok()?);
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data,
                NSURLBookmarkResolutionOptions::WithSecurityScope,
                None,
                std::ptr::null_mut(),
            )
        }
        .ok()?;
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return None;
        }
        let path = PathBuf::from(url.path()?.to_string());
        // 許可はこの URL に紐づく。解放すると書き込みの途中で権限が消えるため、
        // プロセスが終わるまで手放さない（stop は呼ばない）。
        std::mem::forget(url);
        Some(path)
    }
}

#[cfg(test)]
mod tests {
    use super::{choose_start_dir, chose_ok};
    use rfd::MessageDialogResult;
    use std::path::PathBuf;

    #[test]
    fn a_missing_last_dir_falls_back_to_documents() {
        let documents = std::env::temp_dir();
        // 記録が外付けごと消えても、既定がインストール先へ戻ってはいけない。
        assert_eq!(
            choose_start_dir(
                Some(PathBuf::from("/aoiko/no-such-dir")),
                Some(documents.clone())
            ),
            Some(documents.clone())
        );
        assert_eq!(
            choose_start_dir(None, Some(documents.clone())),
            Some(documents.clone())
        );
        // 生きている記録のほうが書類フォルダより優先。
        assert_eq!(
            choose_start_dir(Some(documents.clone()), Some(PathBuf::from("/aoiko/docs"))),
            Some(documents)
        );
        // どちらも無ければ set_directory を呼ばず OS の既定に任せる。
        assert_eq!(choose_start_dir(None, None), None);
    }

    #[test]
    fn only_the_ok_label_discards() {
        assert!(chose_ok(
            &MessageDialogResult::Custom("破棄して終了".to_string()),
            "破棄して終了"
        ));
        assert!(!chose_ok(
            &MessageDialogResult::Custom("編集を続ける".to_string()),
            "破棄して終了"
        ));
        // 閉じるボタンと Esc。ここが true に倒れると、確認を出した意味ごと消える。
        assert!(!chose_ok(&MessageDialogResult::Cancel, "破棄して終了"));
        // OkCancelCustom で ある環境/ある環境 が返すのは Custom だけ。素の Ok が来たら
        // 想定外なので、入力を捨てる側へは倒さない。
        assert!(!chose_ok(&MessageDialogResult::Ok, "破棄して終了"));
        // 終了と再読み込みでラベルが違う。取り違えると片方が必ず素通りする。
        assert!(!chose_ok(
            &MessageDialogResult::Custom("破棄して終了".to_string()),
            "破棄して再読み込み"
        ));
    }
}
