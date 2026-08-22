use std::path::{Path, PathBuf};
use std::sync::mpsc::sync_channel;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::store;
// ネイティブダイアログはメインスレッドでしか組み立てられない。rfd の macOS 実装は
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
// 前回の場所は自分で覚える。Windows の初回はプロセスの作業ディレクトリ（＝インストール先）に
// 落ち、そこはアンインストーラが消す場所なので、最初のバックアップが道連れになる（#87）。
// macOS は NSSavePanel が前回の場所を app の defaults（NSNavLastRootDirectory）へ自分で
// 持つので、この記録が要るのは Windows だけ。加えて rfd の macOS 実装は保存ダイアログに限り
// ファイル名を足したパスを setDirectoryURL へ渡す（0.16〜0.17 の panel_ffi.rs の set_path）
// ため、そこでは set_directory 自体が効かない。フォルダ選択には効く。
fn start_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    choose_start_dir(store::load_last_dir(app), app.path().document_dir().ok())
}
// 記録したフォルダは消えたり外れたりする。無い場所を渡すと Windows は作業ディレクトリへ
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
// ':' を含まず、Windows のパス（C:\...）とも衝突しない。
const BOOKMARK_PREFIX: &str = "bookmark:";
// 選んだフォルダを次の起動へ持ち越すための不透明な文字列にする。macOS のサンドボックスでは
// 利用者が選んだ場所への許可が起動 1 回きりなので、bookmark を作れるならそちらを使う。
pub(crate) fn make_handle(dir: &Path) -> String {
    #[cfg(target_os = "macos")]
    {
        if let Some(bookmark) = macos::create_bookmark(dir) {
            return format!("{BOOKMARK_PREFIX}{bookmark}");
        }
    }
    // Windows にサンドボックスは無い。macOS も署名前は bookmark を作れない
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
// OCR は macOS のみここで完結させる（iOS 側は Vision を呼ぶ Swift 実装へ委譲）。
#[cfg(target_os = "macos")]
pub(crate) fn recognize_text(image_data: &[u8]) -> crate::Result<String> {
    macos::recognize_text(image_data)
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::{Path, PathBuf};

    use base64::{engine::general_purpose::STANDARD, Engine};
    use objc2::{AnyThread, ClassType};
    use objc2_core_foundation::CGRect;
    use objc2_foundation::{
        NSArray, NSData, NSDictionary, NSString, NSURLBookmarkCreationOptions,
        NSURLBookmarkResolutionOptions, NSURL,
    };
    use objc2_vision::{
        VNImageRequestHandler, VNRecognizeTextRequest, VNRecognizeTextRequestRevision3, VNRequest,
        VNRequestTextRecognitionLevel,
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
    struct Cell {
        mid_y: f64,
        height: f64,
        min_x: f64,
        text: String,
    }
    // 行の高さの半分より近ければ同じ行とみなす。実測のレシートでは「登録番号」と番号で
    // 0.0027、行高は 0.013 ほどだった。
    fn same_row(head: &Cell, cell: &Cell) -> bool {
        (head.mid_y - cell.mid_y).abs() <= head.height.max(cell.height) / 2.0
    }
    #[cfg(test)]
    mod row_tests {
        use super::{same_row, Cell};

        fn cell(mid_y: f64, height: f64) -> Cell {
            Cell {
                mid_y,
                height,
                min_x: 0.0,
                text: String::new(),
            }
        }
        // 実測のレシートの「登録番号」と番号。ここが分かれると登録番号を取り出せない。
        #[test]
        fn near_enough_is_one_row() {
            assert!(same_row(&cell(0.8429, 0.0134), &cell(0.8406, 0.0142)));
        }

        #[test]
        fn next_line_is_another_row() {
            assert!(!same_row(&cell(0.7566, 0.0131), &cell(0.7442, 0.0117)));
        }
        // 高い方の文字に合わせないと、大きな見出しが次の行を巻き込む。
        #[test]
        fn threshold_follows_the_taller_cell() {
            assert!(same_row(&cell(0.8500, 0.0300), &cell(0.8400, 0.0100)));
            assert!(!same_row(&cell(0.8500, 0.0100), &cell(0.8400, 0.0100)));
        }
    }

    // ja-JP は VNRecognizeTextRequestRevision3 の .accurate でしか使えない（.fast は非対応）。
    // 圧縮バイト列のまま渡す。ビットマップへ先に展開すると Vision 側の対応形式判定を素通りする。
    pub(super) fn recognize_text(image_data: &[u8]) -> crate::Result<String> {
        let data = NSData::from_vec(image_data.to_vec());
        let handler = VNImageRequestHandler::initWithData_options(
            VNImageRequestHandler::alloc(),
            &data,
            &NSDictionary::new(),
        );

        let request = VNRecognizeTextRequest::new();
        // revision は VNRequest 側のプロパティ。3 未満だと ja-JP 自体が候補に出ない。
        unsafe {
            request
                .as_super()
                .as_super()
                .setRevision(VNRecognizeTextRequestRevision3);
        }
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        let ja = NSString::from_str("ja-JP");
        let en = NSString::from_str("en-US");
        request.setRecognitionLanguages(&NSArray::from_slice(&[&*ja, &*en]));
        request.setUsesLanguageCorrection(true);

        let vn_request: &VNRequest = request.as_super().as_super();
        handler
            .performRequests_error(&NSArray::from_slice(&[vn_request]))
            .map_err(|e| crate::Error::Ocr(e.to_string()))?;

        let Some(results) = request.results() else {
            return Err(crate::Error::Ocr("テキストが見つかりません".to_string()));
        };
        let mut cells: Vec<Cell> = (0..results.count())
            .filter_map(|i| {
                let obs = results.objectAtIndex(i);
                let candidates = obs.topCandidates(1);
                if candidates.count() == 0 {
                    return None;
                }
                let r: CGRect = unsafe { obs.boundingBox() };
                Some(Cell {
                    mid_y: r.origin.y + r.size.height / 2.0,
                    height: r.size.height,
                    min_x: r.origin.x,
                    text: candidates.objectAtIndex(0).string().to_string(),
                })
            })
            .collect();
        // Vision は読む順を保証せず、2 欄組みのレシートでは「合計」と金額を別々に返す。
        // 1 観測 1 行にすると「合計」の行から金額が消えるので、縦に重なるものを 1 行へまとめる。
        cells.sort_by(|a, b| b.mid_y.total_cmp(&a.mid_y));
        let mut rows: Vec<Vec<Cell>> = Vec::new();
        for cell in cells {
            match rows.last_mut() {
                Some(row) if same_row(&row[0], &cell) => row.push(cell),
                _ => rows.push(vec![cell]),
            }
        }

        let lines: Vec<String> = rows
            .into_iter()
            .map(|mut row| {
                row.sort_by(|a, b| a.min_x.total_cmp(&b.min_x));
                row.into_iter().map(|c| c.text).collect::<Vec<_>>().join(" ")
            })
            .filter(|line| !line.is_empty())
            .collect();
        if lines.is_empty() {
            return Err(crate::Error::Ocr("テキストが見つかりません".to_string()));
        }
        Ok(lines.join("\n"))
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
        // OkCancelCustom で macOS/Windows が返すのは Custom だけ。素の Ok が来たら
        // 想定外なので、入力を捨てる側へは倒さない。
        assert!(!chose_ok(&MessageDialogResult::Ok, "破棄して終了"));
        // 終了と再読み込みでラベルが違う。取り違えると片方が必ず素通りする。
        assert!(!chose_ok(
            &MessageDialogResult::Custom("破棄して終了".to_string()),
            "破棄して再読み込み"
        ));
    }
}
