use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use crate::backup::{self, OpenFiles};
use crate::path::SafeTarget;
use crate::store::{self, StoredFolder};
use crate::{Error, PickedFolder, RecognizedText, Resolved, ResolvedFolder, Result};

#[cfg(target_os = "ios")]
use crate::ios::AoikoNativeExt;
// (async) が要る。同期コマンドはメインスレッドで走り、選択ダイアログも run_mobile_plugin も
// 応答までそのスレッドを止める。どちらも表示にメインスレッドを要求するので、同期のままだと
// 互いに待ち合って UI ごと固まる（スクロールだけ生きて操作が死ぬ）。
#[tauri::command(async)]
pub(crate) fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<Option<PickedFolder>> {
    let Some(folder) = pick(&app)? else {
        return Ok(None);
    };
    store::save(&app, &folder)?;
    // 選び直したら前のフォルダの解決結果は用済み。
    app.state::<Resolved>().clear();
    Ok(Some(PickedFolder {
        token: folder.handle,
        name: folder.name,
    }))
}

#[cfg(target_os = "ios")]
fn pick<R: Runtime>(app: &AppHandle<R>) -> Result<Option<StoredFolder>> {
    let Some(picked) = app.aoiko_native().pick_folder()? else {
        return Ok(None);
    };
    Ok(Some(StoredFolder {
        name: picked.name,
        handle: picked.token,
    }))
}

#[cfg(not(target_os = "ios"))]
fn pick<R: Runtime>(app: &AppHandle<R>) -> Result<Option<StoredFolder>> {
    let Some(dir) = crate::desktop::pick_folder(app) else {
        return Ok(None);
    };
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| dir.to_string_lossy().into_owned());
    Ok(Some(StoredFolder {
        name,
        handle: crate::desktop::make_handle(&dir),
    }))
}
// 記録済みのフォルダが今この場で読み書きできるかを返すだけ。実際の入出力は下の
// backup_* が同じ resolved_dir を通して行う。解決できなければ ready=false
// （web 側は理由を問わず「選び直し」へ倒す）。
#[tauri::command(async)]
pub(crate) fn resolve_folder<R: Runtime>(app: AppHandle<R>) -> Result<ResolvedFolder> {
    let Some((path, _dir)) = resolved_dir(&app) else {
        return Ok(ResolvedFolder::unavailable());
    };
    Ok(ResolvedFolder {
        ready: true,
        path: Some(path),
    })
}
// 記録済みのフォルダを実パスへ解くのはここだけにする。ready の判定と実際に読み書きする
// 場所が別々の手順で決まると、片方だけ検査が抜けても気付けない。
// 解決できなければ None（web 側は理由を問わず「選び直し」へ倒す）。
fn resolved_dir<R: Runtime>(app: &AppHandle<R>) -> Option<(String, PathBuf)> {
    let folder = store::load(app)?;
    let cache = app.state::<Resolved>();
    let path = match cache.get(&folder.handle) {
        Some(path) => path,
        None => {
            let path = resolve(app, &folder.handle)?;
            cache.set(&folder.handle, &path);
            path
        }
    };
    // 解決できても、フォルダごと消えている・外付けが外れていることはある。
    let dir = to_file_path(&path);
    dir.is_dir().then_some((path, dir))
}

#[cfg(target_os = "ios")]
fn resolve<R: Runtime>(app: &AppHandle<R>, handle: &str) -> Option<String> {
    app.aoiko_native()
        .resolve_bookmark(handle.to_string())
        .ok()?
        .path
}

#[cfg(not(target_os = "ios"))]
fn resolve<R: Runtime>(_app: &AppHandle<R>, handle: &str) -> Option<String> {
    Some(
        crate::desktop::resolve(handle)?
            .to_string_lossy()
            .into_owned(),
    )
}
// ある環境 の解決結果は file:// URL、デスクトップは素のパス。存在確認も入出力もパスで行う。
fn to_file_path(path: &str) -> std::path::PathBuf {
    tauri::Url::parse(path)
        .ok()
        .and_then(|u| u.to_file_path().ok())
        .unwrap_or_else(|| std::path::PathBuf::from(path))
}

#[tauri::command(async)]
pub(crate) fn print_page<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(target_os = "ios")]
    {
        app.aoiko_native().print_page()
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err(Error::UnsupportedPlatform)
    }
}

// Vision の perform は同期。(async) がワーカースレッドへ逃がすので、DispatchQueue.main には
// 乗せない（乗せると画像 1 枚ぶんの認識のあいだメインスレッド、ひいては UI が止まる）。
#[tauri::command(async)]
pub(crate) fn recognize_text<R: Runtime>(
    app: AppHandle<R>,
    image_base64: String,
) -> Result<RecognizedText> {
    #[cfg(target_os = "ios")]
    {
        app.aoiko_native().recognize_text(image_base64)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = &app;
        use base64::{engine::general_purpose::STANDARD, Engine};
        let bytes = STANDARD
            .decode(image_base64.as_bytes())
            .map_err(|e| Error::Ocr(format!("base64 を解けません: {e}")))?;
        crate::desktop::recognize_text(&bytes)
    }
    #[cfg(not(any(target_os = "ios", target_os = "macos")))]
    {
        let _ = (app, image_base64);
        Err(Error::UnsupportedPlatform)
    }
}

#[tauri::command(async)]
pub(crate) fn open_in_app<R: Runtime>(app: AppHandle<R>, url: String) -> Result<()> {
    #[cfg(target_os = "ios")]
    {
        app.aoiko_native().open_in_app(url)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, url);
        Err(Error::UnsupportedPlatform)
    }
}
// 未保存の入力を抱えたまま終了・再読み込みしようとしたときの確認。true が「破棄して進む」。
// これがあるので webview へ渡す dialog の権限は 1 つも要らず、plugin-dialog ごと外せる。
// 見出しは kind と一緒に固定する。呼び元は 2 か所とも同じ警告で、文面とボタン名だけが違う。
#[tauri::command(async)]
pub(crate) fn confirm_discard<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    message: String,
    ok_label: String,
    cancel_label: String,
) -> Result<bool> {
    #[cfg(not(target_os = "ios"))]
    {
        Ok(crate::desktop::confirm_discard(
            window,
            "aoiko".to_string(),
            message,
            ok_label,
            cancel_label,
        ))
    }
    // ある環境/ある環境 はウィンドウを閉じる操作もメニューの再読み込みも無く、これを呼ぶ
    // __aoikoRequestClose / __aoikoRequestReload へ届く経路が存在しない。
    #[cfg(target_os = "ios")]
    {
        let _ = (window, message, ok_label, cancel_label);
        Err(Error::UnsupportedPlatform)
    }
}
// 以降の入出力が受け取る base はここでしか作れない。JS が渡せるのはこの base からの
// 相対パスだけで、実パスへ解くのは path.rs の resolve_within に限る。
//
// ある環境 も同じ経路で足りる。resolved_dir が file:// URL を実パスへ解いており、ネイティブ側 側は
// resolveBookmark で取った security-scoped のスコープを選び直しまで手放さないので、
// Rust の std::fs はそのスコープの下で走る。バイト列を ネイティブ側 へ渡す必要は無い。
fn backup_base<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    resolved_dir(app)
        .map(|(_, dir)| dir)
        .ok_or(Error::FolderUnavailable)
}
// ファイル入出力も (async) にする。同期コマンドはメインスレッドで走るので、数十 MB の
// バックアップを書いている間ずっと UI が止まる。
#[tauri::command(async)]
pub(crate) fn backup_open<R: Runtime>(app: AppHandle<R>, rel_path: String) -> Result<u32> {
    let base = backup_base(&app)?;
    app.state::<OpenFiles>().open(&base, &rel_path)
}
// チャンクは殻を被せず生バイトで受ける。JSON へ載せると 1 バイトが数字 1 個へ膨らみ、
// 行き先の rid だけをヘッダーで渡す。
//
// 生バイトが届かない経路もある。シェル の custom protocol IPC が一度でも失敗すると
// customProtocolIpcFailed が立ち、以降そのページでは postMessage へ固定される
// （tauri/scripts/ipc-protocol.js）。その状態では ArrayBuffer が JSON 化されて
// InvokeBody::Raw にならない。落とさず書き切れるよう、base64 で載せた形も受ける。
// 膨張は 1.37 倍で、数字の配列（数百倍）とは桁が違う。
#[tauri::command(async)]
pub(crate) fn backup_write_chunk<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<()> {
    let rid_header = request
        .headers()
        .get("x-aoiko-rid")
        .and_then(|value| value.to_str().ok());
    let (rid, chunk) = parse_chunk(request.body(), rid_header)?;
    app.state::<OpenFiles>().write_chunk(rid, &chunk)
}

#[derive(serde::Deserialize)]
struct Base64Chunk {
    rid: u32,
    b64: String,
}
/// チャンクの本体と行き先を取り出す。生バイトと base64 の両方を受ける。
///
/// base64 の側は rid も本体に載せる。postMessage 経路ではヘッダーの扱いが
/// custom protocol と同じとは限らないため、届く保証のある場所へ置く。
fn parse_chunk(body: &tauri::ipc::InvokeBody, rid_header: Option<&str>) -> Result<(u32, Vec<u8>)> {
    match body {
        tauri::ipc::InvokeBody::Raw(chunk) => {
            let rid = rid_header
                .and_then(|value| value.parse::<u32>().ok())
                .ok_or_else(|| {
                    Error::BadChunkRequest("x-aoiko-rid ヘッダーがありません".to_string())
                })?;
            Ok((rid, chunk.clone()))
        }
        tauri::ipc::InvokeBody::Json(value) => {
            let parsed: Base64Chunk = serde_json::from_value(value.clone())
                .map_err(|e| Error::BadChunkRequest(format!("チャンクの形が不正です: {e}")))?;
            use base64::{engine::general_purpose::STANDARD, Engine};
            let bytes = STANDARD
                .decode(parsed.b64.as_bytes())
                .map_err(|e| Error::BadChunkRequest(format!("base64 を解けません: {e}")))?;
            Ok((parsed.rid, bytes))
        }
    }
}

#[tauri::command(async)]
pub(crate) fn backup_close<R: Runtime>(app: AppHandle<R>, rid: u32) -> Result<()> {
    app.state::<OpenFiles>().close(rid)
}
// 台帳エクスポートはバックアップフォルダの外へ書く。保存先を決められるのは下の
// ask_save_path だけで、web 側から渡せるのは初期ファイル名だけ。取り消しは Ok(None)。
#[tauri::command(async)]
pub(crate) fn export_open<R: Runtime>(app: AppHandle<R>, file_name: String) -> Result<Option<u32>> {
    let files = app.state::<OpenFiles>();
    backup::export_open(&files, &file_name, |suggested| {
        ask_save_path(&app, suggested)
    })
}
// 保存ダイアログを開くのはここだけ。webview からは呼べない（JS が渡せるのは初期ファイル名
// だけで、保存ダイアログ自体を開くコマンドは無い）。取り消しは Ok(None)。
#[cfg(not(target_os = "ios"))]
fn ask_save_path<R: Runtime>(app: &AppHandle<R>, file_name: &str) -> Result<Option<SafeTarget>> {
    // 利用者がダイアログで指した先。IPC を通っていないので配下の検査は掛けない（掛けると
    // バックアップフォルダの外へ書き出せなくなる）。
    Ok(crate::desktop::save_file(app, file_name).map(SafeTarget::from_os_chosen))
}
// ある環境/ある環境 には保存先を選ばせる仕組みが無く、plugin-dialog の save() は空ファイルを
// 書き出す（plugins-workspace#1763）。アプリの Documents 直下へ固定し、Info.ios.plist の
// UIFileSharingEnabled で「ファイル」アプリから取り出してもらう。選ばせないので
// 取り消しも起きず、常に Some を返す。
#[cfg(target_os = "ios")]
fn ask_save_path<R: Runtime>(app: &AppHandle<R>, file_name: &str) -> Result<Option<SafeTarget>> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|e| Error::Io(e.to_string()))?;
    Ok(Some(backup::ios_export_target(&documents, file_name)))
}

#[tauri::command(async)]
pub(crate) fn backup_read<R: Runtime>(
    app: AppHandle<R>,
    rel_path: String,
) -> Result<tauri::ipc::Response> {
    let base = backup_base(&app)?;
    Ok(tauri::ipc::Response::new(backup::read(&base, &rel_path)?))
}

#[tauri::command(async)]
pub(crate) fn backup_list<R: Runtime>(
    app: AppHandle<R>,
    subdir: Option<String>,
) -> Result<Vec<String>> {
    let base = backup_base(&app)?;
    backup::list(&base, subdir.as_deref())
}

#[tauri::command(async)]
pub(crate) fn backup_remove<R: Runtime>(app: AppHandle<R>, rel_path: String) -> Result<()> {
    let base = backup_base(&app)?;
    backup::remove(&base, &rel_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::InvokeBody;

    #[test]
    fn takes_raw_bytes_with_the_rid_header() {
        let body = InvokeBody::Raw(vec![1, 2, 3]);
        assert_eq!(parse_chunk(&body, Some("7")).unwrap(), (7, vec![1, 2, 3]));
    }

    #[test]
    fn raw_bytes_without_a_usable_header_are_refused() {
        let body = InvokeBody::Raw(vec![1]);
        assert!(matches!(
            parse_chunk(&body, None),
            Err(Error::BadChunkRequest(_))
        ));
        assert!(matches!(
            parse_chunk(&body, Some("いち")),
            Err(Error::BadChunkRequest(_))
        ));
    }
    // custom protocol IPC が落ちた後の経路。ここが通らないとバックアップが書けなくなる。
    #[test]
    fn takes_base64_when_raw_bytes_cannot_cross() {
        let body = InvokeBody::Json(serde_json::json!({ "rid": 3, "b64": "AQID" }));
        assert_eq!(parse_chunk(&body, None).unwrap(), (3, vec![1, 2, 3]));
    }

    #[test]
    fn base64_carries_its_own_rid_and_ignores_the_header() {
        let body = InvokeBody::Json(serde_json::json!({ "rid": 3, "b64": "AQID" }));
        assert_eq!(parse_chunk(&body, Some("99")).unwrap().0, 3);
    }

    #[test]
    fn a_broken_base64_body_is_refused_rather_than_written_as_garbage() {
        let bad_b64 = InvokeBody::Json(serde_json::json!({ "rid": 1, "b64": "こんにちは" }));
        assert!(matches!(
            parse_chunk(&bad_b64, None),
            Err(Error::BadChunkRequest(_))
        ));
        let missing = InvokeBody::Json(serde_json::json!({ "rid": 1 }));
        assert!(matches!(
            parse_chunk(&missing, None),
            Err(Error::BadChunkRequest(_))
        ));
    }
    // 空のチャンクは呼出側が送らない約束だが、届いても壊れないことは確かめておく。
    #[test]
    fn an_empty_base64_body_decodes_to_no_bytes() {
        let body = InvokeBody::Json(serde_json::json!({ "rid": 1, "b64": "" }));
        assert_eq!(parse_chunk(&body, None).unwrap(), (1, Vec::new()));
    }
}
