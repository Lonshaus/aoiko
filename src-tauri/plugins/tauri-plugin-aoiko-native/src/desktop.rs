use std::path::{Path, PathBuf};
use std::sync::mpsc::sync_channel;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::store;
// ネイティブダイアログはメインスレッドでしか組み立てられない。rfd の実装は
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
// 前回の場所は自分で覚える。初回がプロセスの作業ディレクトリ（＝インストール先）に
// 落ち、そこはアンインストーラが消す場所なので、最初のバックアップが道連れになる（#87）。
// 保存パネルが前回の場所を app の設定へ自分で持つ環境もあるので、この記録が要るのは片方だけ。
// 加えて rfd の実装は保存ダイアログに限り
// ファイル名を足したパスを setDirectoryURL へ渡す（0.16〜0.17 の panel_ffi.rs の set_path）
// ため、そこでは set_directory 自体が効かない。フォルダ選択には効く。
fn start_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    choose_start_dir(store::load_last_dir(app), app.path().document_dir().ok())
}
// 記録したフォルダは消えたり外れたりする。無い場所を渡すと作業ディレクトリへ
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
// ':' を含まず、ドライブ修飾付きのパス（C:\...）とも衝突しない。
const BOOKMARK_PREFIX: &str = "bookmark:";
// 選んだフォルダを次の起動へ持ち越すための不透明な文字列にする。サンドボックスでは
// 利用者が選んだ場所への許可が起動 1 回きりなので、bookmark を作れるならそちらを使う。
pub(crate) fn make_handle(dir: &Path) -> String {
    #[cfg(target_os = "macos")]
    {
        if let Some(bookmark) = macos::create_bookmark(dir) {
            return format!("{BOOKMARK_PREFIX}{bookmark}");
        }
    }
    // サンドボックスが無い環境がある。署名前は bookmark を作れない環境もある
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
// モバイルだけはネイティブ実装へ委譲する（認識の呼び出しがそちらにある）。
#[cfg(target_os = "macos")]
pub(crate) fn recognize_text(image_data: &[u8]) -> crate::Result<crate::RecognizedText> {
    macos::recognize_text(image_data)
}

#[cfg(target_os = "windows")]
pub(crate) fn recognize_text(image_data: &[u8]) -> crate::Result<crate::RecognizedText> {
    windows_ocr::recognize_text(image_data)
}

// 左右に分かれたセルは別々に返るので、まとめないと「合計」と金額が離れて拾えない。
// 行内の区切りだけは環境で違うため呼び元が決める（一文字ずつ返す側で空白は挟めない）。
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn word_mid_y(word: &crate::RecognizedWord) -> f64 {
    word.y + word.height / 2.0
}
// 行の高さの半分より近ければ同じ行。実測では隣り合うセルの差が行高の 1/5 だった。
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn same_row(head: &crate::RecognizedWord, word: &crate::RecognizedWord) -> bool {
    (word_mid_y(head) - word_mid_y(word)).abs() <= head.height.max(word.height) / 2.0
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn words_to_lines(mut words: Vec<crate::RecognizedWord>, separator: &str) -> crate::RecognizedText {
    words.sort_by(|a, b| word_mid_y(a).total_cmp(&word_mid_y(b)));
    let mut rows: Vec<Vec<crate::RecognizedWord>> = Vec::new();
    for word in words {
        match rows.last_mut() {
            Some(row) if same_row(&row[0], &word) => row.push(word),
            _ => rows.push(vec![word]),
        }
    }
    let lines = rows
        .into_iter()
        .filter_map(|mut row| {
            row.sort_by(|a, b| a.x.total_cmp(&b.x));
            crate::RecognizedLine::from_words(row, separator)
        })
        .filter(|line| !line.text.is_empty())
        .collect();
    crate::RecognizedText::from_lines(lines)
}
// 関数が生えていることと読めることは別。対応言語は OS の版や導入内容で変わる。
#[cfg(target_os = "macos")]
pub(crate) fn is_text_recognition_available() -> bool {
    macos::supports_japanese()
}

#[cfg(target_os = "windows")]
pub(crate) fn is_text_recognition_available() -> bool {
    windows_ocr::supports_japanese()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn is_text_recognition_available() -> bool {
    false
}

#[cfg(target_os = "windows")]
mod windows_ocr {
    use windows::{
        core::HSTRING,
        Globalization::Language,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    use crate::{RecognizedText, RecognizedWord};

    // 日本語の言語機能は既定で入っておらず、利用者が追加するまで読めない。
    // 追加の有無は実行時にしか分からないので毎回問う。
    pub(super) fn supports_japanese() -> bool {
        let Ok(ja) = Language::CreateLanguage(&HSTRING::from("ja")) else {
            return false;
        };
        OcrEngine::IsLanguageSupported(&ja).unwrap_or(false)
    }

    pub(super) fn recognize_text(image_data: &[u8]) -> crate::Result<RecognizedText> {
        let bitmap = decode(image_data)?;
        let width = f64::from(bitmap.PixelWidth().map_err(to_err)?);
        let height = f64::from(bitmap.PixelHeight().map_err(to_err)?);
        if width <= 0.0 || height <= 0.0 {
            return Err(crate::Error::Ocr("画像の大きさを取れません".to_string()));
        }
        // 利用者の言語ではなく日本語で作る。表示言語が英語の端末でも領収書は日本語のため。
        let mut words = read_with(&bitmap, "ja", width, height)?;
        // この引擎は 1 言語しか持てない。英数の並びは日本語の引擎だと崩れやすいので、
        // 英語の引擎でも読んで、日本語側が拾えなかった位置だけ足す。
        if let Ok(en) = read_with(&bitmap, "en", width, height) {
            for word in en {
                if !words.iter().any(|w| overlaps(w, &word)) {
                    words.push(word);
                }
            }
        }
        // 一文字ずつ矩形が返るため、行内に空白を挟むと日本語が全部ばらける。
        let recognized = super::words_to_lines(words, "");
        if recognized.lines.is_empty() {
            return Err(crate::Error::Ocr("テキストが見つかりません".to_string()));
        }
        Ok(recognized)
    }

    fn read_with(
        bitmap: &windows::Graphics::Imaging::SoftwareBitmap,
        tag: &str,
        width: f64,
        height: f64,
    ) -> crate::Result<Vec<RecognizedWord>> {
        let language = Language::CreateLanguage(&HSTRING::from(tag))
            .map_err(|e| crate::Error::Ocr(format!("言語を作れません: {e}")))?;
        let engine = OcrEngine::TryCreateFromLanguage(&language)
            .map_err(|e| crate::Error::Ocr(format!("文字認識を用意できません: {e}")))?;
        let result = engine
            .RecognizeAsync(bitmap)
            .and_then(|op| op.get())
            .map_err(|e| crate::Error::Ocr(format!("文字を認識できません: {e}")))?;

        let mut words: Vec<RecognizedWord> = Vec::new();
        for line in result.Lines().map_err(to_err)? {
            for word in line.Words().map_err(to_err)? {
                let text = word.Text().map_err(to_err)?.to_string();
                if text.is_empty() {
                    continue;
                }
                let r = word.BoundingRect().map_err(to_err)?;
                words.push(RecognizedWord {
                    text,
                    // 画素の左上原点。0..1 へ正規化するだけで向きは合っている。
                    x: f64::from(r.X) / width,
                    y: f64::from(r.Y) / height,
                    width: f64::from(r.Width) / width,
                    height: f64::from(r.Height) / height,
                    // この引擎は語ごとの自信度も次の候補も返さない。
                    confidence: None,
                    alternates: Vec::new(),
                    // 向きは `OcrResult.TextAngle` に紙面で 1 つだけ乗る。語ごとには無い。
                    slope: None,
                });
            }
        }
        Ok(words)
    }
    // 同じ文字を 2 つの引擎が別々に読むので、重なっていれば同じ位置とみなす。
    // 中心が相手の矩形の内側にあるかで見る。
    fn overlaps(a: &RecognizedWord, b: &RecognizedWord) -> bool {
        let cx = b.x + b.width / 2.0;
        let cy = b.y + b.height / 2.0;
        cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height
    }

    fn decode(image_data: &[u8]) -> crate::Result<windows::Graphics::Imaging::SoftwareBitmap> {
        let stream = InMemoryRandomAccessStream::new().map_err(to_err)?;
        let writer = DataWriter::CreateDataWriter(&stream).map_err(to_err)?;
        writer.WriteBytes(image_data).map_err(to_err)?;
        writer
            .StoreAsync()
            .and_then(|op| op.get())
            .map_err(to_err)?;
        writer
            .FlushAsync()
            .and_then(|op| op.get())
            .map_err(to_err)?;
        stream.Seek(0).map_err(to_err)?;
        let decoder = BitmapDecoder::CreateAsync(&stream)
            .and_then(|op| op.get())
            .map_err(|e| crate::Error::Ocr(format!("画像を読めません: {e}")))?;
        decoder
            .GetSoftwareBitmapAsync()
            .and_then(|op| op.get())
            .map_err(to_err)
    }

    fn to_err(e: windows::core::Error) -> crate::Error {
        crate::Error::Ocr(format!("文字認識に失敗しました: {e}"))
    }
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

    use crate::{RecognizedText, RecognizedWord};
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
    #[cfg(test)]
    mod row_tests {
        use super::super::{same_row, word_mid_y};
        use crate::RecognizedWord;

        fn cell(mid_y: f64, height: f64) -> RecognizedWord {
            RecognizedWord {
                text: String::new(),
                x: 0.0,
                y: mid_y - height / 2.0,
                width: 0.0,
                height,
                confidence: None,
                alternates: Vec::new(),
                slope: None,
            }
        }

        #[test]
        fn mid_y_is_the_centre() {
            assert!((word_mid_y(&cell(0.5, 0.02)) - 0.5).abs() < 1e-12);
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

    // 対応言語は認識の水準と revision の組で変わる。読み取りと同じ設定に揃えてから
    // 問わないと、実際には使えない言語を「使える」と答えてしまう。
    pub(super) fn supports_japanese() -> bool {
        let request = VNRecognizeTextRequest::new();
        unsafe {
            request
                .as_super()
                .as_super()
                .setRevision(VNRecognizeTextRequestRevision3);
        }
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        let langs = match unsafe { request.supportedRecognitionLanguagesAndReturnError() } {
            Ok(langs) => langs,
            Err(_) => return false,
        };
        langs.iter().any(|l| l.to_string() == "ja-JP")
    }

    // ja-JP は VNRecognizeTextRequestRevision3 の .accurate でしか使えない（.fast は非対応）。
    // 圧縮バイト列のまま渡す。ビットマップへ先に展開すると Vision 側の対応形式判定を素通りする。
    pub(super) fn recognize_text(image_data: &[u8]) -> crate::Result<RecognizedText> {
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
        // 先頭が誤っていても次の候補が正しいことがある（`T` の欠けは実測）。
        let words: Vec<RecognizedWord> = (0..results.count())
            .filter_map(|i| {
                let obs = results.objectAtIndex(i);
                let candidates = obs.topCandidates(3);
                if candidates.count() == 0 {
                    return None;
                }
                let top = candidates.objectAtIndex(0);
                let text = top.string().to_string();
                if text.is_empty() {
                    return None;
                }
                let alternates: Vec<String> = (1..candidates.count())
                    .map(|n| candidates.objectAtIndex(n).string().to_string())
                    .filter(|t| !t.is_empty() && *t != text)
                    .collect();
                let r: CGRect = unsafe { obs.boundingBox() };
                // 外接矩形は軸に平行なので、傾けて撮ると基線の向きが失われる。四隅は
                // 実際に回るので、下辺から傾きを取る。y を反転すればこちらの正規化座標
                // での傾きになり、画素の縦横比を掛け戻す必要は無い（角度が要るときだけ）。
                let bl = unsafe { obs.bottomLeft() };
                let br = unsafe { obs.bottomRight() };
                let dx = br.x - bl.x;
                let slope = if dx.abs() < 1e-6 {
                    None
                } else {
                    Some((bl.y - br.y) / dx)
                };
                Some(RecognizedWord {
                    text,
                    x: r.origin.x,
                    // Vision は左下原点で y が上向き。左上原点・下向きへ揃える。
                    y: 1.0 - (r.origin.y + r.size.height),
                    width: r.size.width,
                    height: r.size.height,
                    confidence: Some(f64::from(top.confidence())),
                    alternates,
                    slope,
                })
            })
            .collect();
        // 単語のまとまりで返るので、行内は空白で繋ぐ。
        let recognized = super::words_to_lines(words, " ");
        if recognized.lines.is_empty() {
            return Err(crate::Error::Ocr("テキストが見つかりません".to_string()));
        }
        Ok(recognized)
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
        // OkCancelCustom で返るのは Custom だけ。素の Ok が来たら
        // 想定外なので、入力を捨てる側へは倒さない。
        assert!(!chose_ok(&MessageDialogResult::Ok, "破棄して終了"));
        // 終了と再読み込みでラベルが違う。取り違えると片方が必ず素通りする。
        assert!(!chose_ok(
            &MessageDialogResult::Custom("破棄して終了".to_string()),
            "破棄して再読み込み"
        ));
    }
}
