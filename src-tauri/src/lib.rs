use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
#[cfg(desktop)]
use tauri::Manager;
use tauri::{WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;

#[cfg(desktop)]
mod menu_i18n;

const INIT_SCRIPT: &str = include_str!("../init.js");
// 商店ごとに品目 ID が違うので、走っている場所を init.js へ渡す。JS 側から OS を
// 見分ける手段（userAgent 等）は web view だと ある環境 と ある環境 の区別が付かない。
const PLATFORM: &str = if cfg!(target_os = "macos") {
    "macos"
} else if cfg!(target_os = "ios") {
    "ios"
} else if cfg!(target_os = "windows") {
    "windows"
} else {
    "other"
};
// ウィンドウ終了要求を JS 側の未保存判定へ渡す。init.js が未読込のときだけ即座に閉じる
// （画面が出ていない＝未保存の入力も存在しないため）。
const CLOSE_SCRIPT: &str = r#"
(function () {
  if (typeof window.__aoikoRequestClose === 'function') {
    window.__aoikoRequestClose();
  } else {
    window.__aoikoForceClose();
  }
})();
"#;
// 再読み込みも同じ未保存判定を通す。init.js が未読込のときは画面も未保存の入力も
// 存在しないため、そのまま location.reload() してよい。呼び元はメニューだけなので desktop 限定。
#[cfg(desktop)]
const RELOAD_SCRIPT: &str = r#"
(function () {
  if (typeof window.__aoikoRequestReload === 'function') {
    window.__aoikoRequestReload();
  } else {
    location.reload();
  }
})();
"#;
// 未保存確認を通過したあとの実際の終了。CloseRequested を握り潰しているため
// JS から明示的に呼ぶ必要がある。destroy() は CloseRequested を再発火しない。
#[tauri::command]
fn force_close(window: tauri::WebviewWindow) {
    let _ = window.destroy();
}
// 題名欄と Alt+Tab のアイコンは exe に埋めた .ico が既定で、1 枚しか持てない。座布団なしの猫は
// 明るい題名欄では読めるが暗い題名欄では沈むため、暗いときだけ白い座布団を敷いた版へ差し替える。
// 猫そのものの色は変えない。
//
// 絵は icons/titlebar-*.png。build.rs が RGBA へ展開して OUT_DIR へ出す。
#[cfg(target_os = "windows")]
fn apply_titlebar_icon(window: &tauri::WebviewWindow) {
    const SIDE: u32 = 64;
    const LIGHT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/titlebar-light.rgba"));
    const DARK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/titlebar-dark.rgba"));
    let rgba = match window.theme() {
        Ok(tauri::Theme::Dark) => DARK,
        _ => LIGHT,
    };
    let _ = window.set_icon(tauri::image::Image::new(rgba, SIDE, SIDE));
}
// src-init/index.js が印刷と外部リンクの実装を出し分けるためのフラグ。ある環境/ある環境 だけ
// plugin-aoiko-native の print_page / open_in_app へ回す。
#[tauri::command]
fn is_ios() -> bool {
    cfg!(target_os = "ios")
}
// web view 上の window.print() は例外を投げる（tauri#3066）。印刷スタイルは公開 repo に
// 揃っているので、出力そのものはネイティブの印刷機構へ渡せばよい。
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(|webview| {
                use objc2_app_kit::{NSPrintInfo, NSWindow};
                use objc2_web_kit::WKWebView;

                let wk = webview.inner().cast::<WKWebView>();
                let ns_window = webview.ns_window().cast::<NSWindow>();
                if wk.is_null() || ns_window.is_null() {
                    return;
                }
                // with_webview のクロージャは主スレッドで実行されるため OS の UI を直接触れる。
                unsafe {
                    let wk = &*wk;
                    let ns_window = &*ns_window;
                    let operation = wk.printOperationWithPrintInfo(&NSPrintInfo::sharedPrintInfo());
                    operation.setShowsPrintPanel(true);
                    operation.setShowsProgressPanel(true);
                    // シートとして出す。runOperation() では別ウィンドウのモーダルになり、
                    // 印刷対象の画面が隠れる。
                    operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                        ns_window,
                        None,
                        None,
                        std::ptr::null_mut(),
                    );
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        window
            .with_webview(|webview| {
                use webview2_com::Microsoft::Web::WebView2::Win32::{
                    ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
                };
                use windows_core::Interface;

                // controller() が返すのは基底の ICoreweb view で、ShowPrintUI は
                // ICoreweb view_16 で追加された。QueryInterface で降りる必要がある。
                // クロージャは Send + 'static のため、ある環境 側と同じく内部の失敗を
                // コマンドの戻り値へは返せない。失敗した場合はダイアログが出ないだけになる。
                unsafe {
                    let Ok(core) = webview.controller().CoreWebView2() else {
                        return;
                    };
                    let Ok(printable) = core.cast::<ICoreWebView2_16>() else {
                        return;
                    };
                    // BROWSER は web view 自身の印刷プレビューを出す。あるブラウザ の Ctrl+P と同じで、
                    // 用紙に載った結果をページ送りごと確認してから印刷できる。SYSTEM だと
                    // OS の印刷ダイアログのみでプレビューが無い。
                    let _ = printable.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        Err("この環境の印刷は未実装です".into())
    }
}
// 外部 fetch はすべてこのコマンドが受ける。invoke の引数が ArrayBuffer のときだけ
// octet-stream のまま届く（JSON 化すると 1 MB の body で数百 MB に膨らむ、#26）ので、
// 往復とも [4 バイト LE: meta 長][meta JSON][body] の 1 本に詰める。
#[derive(Deserialize)]
struct FetchRequestMeta {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchResponseMeta {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
}
// 壊れた枠でプロセスを落とせないよう、長さは必ず境界と突き合わせてから切る。
fn split_frame(frame: &[u8]) -> Result<(&[u8], &[u8]), String> {
    let mut length = [0u8; 4];
    length.copy_from_slice(frame.get(..4).ok_or("フレームが 4 バイト未満です")?);
    let rest = &frame[4..];
    let meta_length = u32::from_le_bytes(length) as usize;
    let meta = rest
        .get(..meta_length)
        .ok_or("meta 長がフレームの長さを超えています")?;
    Ok((meta, &rest[meta_length..]))
}
// 外向きの通信先を決める唯一の場所。capabilities の scope はプラグインのコマンドにしか効かず、
// アプリ側で定義したこのコマンドは素通りするため、ここで自前に効かせる。
fn is_allowed_url(url: &reqwest::Url) -> bool {
    match url.scheme() {
        "https" => true,
        // 公開 repo の LOCAL_HOSTS（domain/llm.ts）と同じ集合。あちらが「この端末」とみなした
        // 宛先は送信前確認を省くので、こちらだけ狭いと確認も出ないまま通信だけ失敗する。
        // host_str は IPv6 を角括弧付きで返すが、素の形も併記して取りこぼしを無くす。
        "http" => matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "0.0.0.0" | "::1" | "[::1]")
        ),
        _ => false,
    }
}
// fetch 仕様の禁止ヘッダー。通すと Origin や Cookie を詐称できる。HeaderName は常に小文字。
fn is_forbidden_header(name: &HeaderName) -> bool {
    let name = name.as_str();
    matches!(
        name,
        "accept-charset"
            | "accept-encoding"
            | "access-control-request-headers"
            | "access-control-request-method"
            | "connection"
            | "content-length"
            | "cookie"
            | "date"
            | "dnt"
            | "expect"
            | "host"
            | "origin"
            | "referer"
            | "set-cookie"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "via"
    ) || name.starts_with("proxy-")
        || name.starts_with("sec-")
}
// 1 リクエストごとに Client を作ると root 証明書の読み込みも TLS ハンドシェイクも毎回やり直しに
// なる。接続を使い回すため 1 個だけ持つ。
fn http_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                // リダイレクト先も allowlist に通す。入口だけ見ても 302 で範囲外へ飛べてしまう。
                // 打ち切り回数は reqwest の既定と同じ 10 回。
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if !is_allowed_url(attempt.url()) {
                        attempt.stop()
                    } else if attempt.previous().len() >= 10 {
                        attempt.error("リダイレクトが多すぎます")
                    } else {
                        attempt.follow()
                    }
                }))
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

#[tauri::command]
async fn aoiko_fetch(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(frame) = request.body() else {
        return Err("aoiko_fetch には ArrayBuffer を渡してください".into());
    };
    Ok(tauri::ipc::Response::new(fetch_frame(frame).await?))
}
// IPC の殻から切り離してあるのはテストのため。tauri::ipc::Request は組み立てられない。
async fn fetch_frame(frame: &[u8]) -> Result<Vec<u8>, String> {
    let (meta, body) = split_frame(frame)?;
    let meta: FetchRequestMeta =
        serde_json::from_slice(meta).map_err(|e| format!("meta を解釈できません: {e}"))?;
    let url = reqwest::Url::parse(&meta.url).map_err(|e| format!("URL が不正です: {e}"))?;
    if !is_allowed_url(&url) {
        // Gemini は API キーを query に載せるため、URL をそのままエラー文へ入れない。
        return Err(format!(
            "許可されていない URL です: {}://{}",
            url.scheme(),
            url.host_str().unwrap_or("")
        ));
    }
    let method = reqwest::Method::from_bytes(meta.method.as_bytes())
        .map_err(|e| format!("メソッドが不正です: {e}"))?;
    let mut headers = HeaderMap::new();
    for (name, value) in &meta.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| format!("ヘッダー名が不正です: {e}"))?;
        if is_forbidden_header(&name) {
            continue;
        }
        let value =
            HeaderValue::from_str(value).map_err(|e| format!("ヘッダー値が不正です: {e}"))?;
        headers.append(name, value);
    }
    let mut builder = http_client()?.request(method, url).headers(headers);
    if !body.is_empty() {
        builder = builder.body(body.to_vec());
    }
    // reqwest のエラー文には URL がそのまま入る。API キーごとログや画面へ流れないよう落とす。
    let response = builder
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let status = response.status();
    let meta = FetchResponseMeta {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or_default().to_string(),
        // 値が ASCII に収まらないヘッダーは JS の Headers に載せられないので落とす。
        headers: response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                Some((name.as_str().to_string(), value.to_str().ok()?.to_string()))
            })
            .collect(),
    };
    let body = response
        .bytes()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let meta = serde_json::to_vec(&meta).map_err(|e| e.to_string())?;
    let mut frame = Vec::with_capacity(4 + meta.len() + body.len());
    frame.extend_from_slice(&(meta.len() as u32).to_le_bytes());
    frame.extend_from_slice(&meta);
    frame.extend_from_slice(&body);
    Ok(frame)
}

/// 今メニューが出している言語。web 側が渡してきた値を覚えておき、同じ言語で
/// 作り直さないようにする（ページを読み込むたびに渡ってくるため）。
#[cfg(desktop)]
struct UiLocale(std::sync::Mutex<menu_i18n::Locale>);

#[cfg(desktop)]
fn ui_locale_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("ui-locale"))
}
// 起動時点では web 側がまだ動いていない。覚えておかないと、日本語以外を選んでいる利用者は
// 起動のたびに日本語のメニューが一瞬出てから切り替わることになる。
// 初回起動だけは記録が無いので paraglide の baseLocale と同じ日本語から始める。
#[cfg(desktop)]
fn load_ui_locale(app: &tauri::AppHandle) -> menu_i18n::Locale {
    ui_locale_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|tag| menu_i18n::Locale::from_tag(tag.trim()))
        .unwrap_or(menu_i18n::Locale::Ja)
}

#[cfg(desktop)]
fn save_ui_locale(app: &tauri::AppHandle, locale: menu_i18n::Locale) {
    if let Some(path) = ui_locale_path(app) {
        let _ = std::fs::write(path, locale.tag());
    }
}

#[cfg(all(desktop, not(target_os = "windows")))]
fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    locale: menu_i18n::Locale,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use menu_i18n::{tr, Key};
    // 既定のメニューには印刷も再読み込みも無い。web 版ではブラウザがこの 2 つを
    // 提供していたため、画面側に入口の無い操作がそのまま失われていた。
    let print_item = MenuItemBuilder::with_id("print", tr(locale, Key::Print))
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let reload_item = MenuItemBuilder::with_id("reload", tr(locale, Key::Reload))
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    // quit_with_text() は OS の UI の terminate: にマップされ、windowShouldClose: を
    // 経由しない（CloseRequested が発火しない）ため未保存ガードを迂回できてしまう。
    // 赤い閉じるボタンと同じ CLOSE_SCRIPT 経路へ通すため自前の項目にする。
    let quit_item = MenuItemBuilder::with_id("quit", tr(locale, Key::Quit))
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    // ある環境 は先頭の submenu をアプリケーションメニューとして扱い、名前も
    // アプリ名で上書きする。ここを省くと「ファイル」がアプリメニューに化け、
    // 終了や環境設定の定位置が無くなる。
    let app_menu = SubmenuBuilder::new(app, "aoiko")
        .about_with_text(tr(locale, Key::About), None)
        .separator()
        .services_with_text(tr(locale, Key::Services))
        .separator()
        .hide_with_text(tr(locale, Key::Hide))
        .hide_others_with_text(tr(locale, Key::HideOthers))
        .show_all_with_text(tr(locale, Key::ShowAll))
        .separator()
        .item(&quit_item)
        .build()?;
    // 定義済み項目の既定ラベルは英語で入る。UI の言語と揃えるため明示的に与える。
    let file_menu = SubmenuBuilder::new(app, tr(locale, Key::FileMenu))
        .item(&print_item)
        .separator()
        .close_window_with_text(tr(locale, Key::CloseWindow))
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, tr(locale, Key::EditMenu))
        .undo_with_text(tr(locale, Key::Undo))
        .redo_with_text(tr(locale, Key::Redo))
        .separator()
        .cut_with_text(tr(locale, Key::Cut))
        .copy_with_text(tr(locale, Key::Copy))
        .paste_with_text(tr(locale, Key::Paste))
        .select_all_with_text(tr(locale, Key::SelectAll))
        .build()?;
    let view_menu = SubmenuBuilder::new(app, tr(locale, Key::ViewMenu))
        .item(&reload_item)
        .separator()
        .fullscreen_with_text(tr(locale, Key::FullScreen))
        .build()?;
    let window_menu = SubmenuBuilder::new(app, tr(locale, Key::WindowMenu))
        .minimize_with_text(tr(locale, Key::Minimize))
        .maximize_with_text(tr(locale, Key::Zoom))
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()
}
// ある環境 にアプリケーションメニューという枠は無く、綴りもニーモニック（&）も ある環境 と
// 違うので構成ごと分ける。Window サブメニューは作らない：Minimize の既定加速キーが
// 無条件 Ctrl+M、Maximize は元に戻せない一方向で、どちらも ある環境 の慣習に無い。
#[cfg(target_os = "windows")]
fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    locale: menu_i18n::Locale,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use menu_i18n::{tr, Key};
    let print_item = MenuItemBuilder::with_id("print", tr(locale, Key::WinPrint))
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let reload_item = MenuItemBuilder::with_id("reload", tr(locale, Key::WinReload))
        .accelerator("F5")
        .build(app)?;
    // 定義済みの Fullscreen は ある環境 で何もせず、しかも定義済み項目は MenuEvent を
    // 発火しないので後から拾うこともできない。自前の項目にする。
    let fullscreen_item = MenuItemBuilder::with_id("fullscreen", tr(locale, Key::WinFullScreen))
        .accelerator("F11")
        .build(app)?;
    // 定義済みの Quit は PostQuitMessage(0) で WM_CLOSE を経由せず、未保存ガードを
    // 迂回する。Alt+F4 と同じ CLOSE_SCRIPT 経路へ通すため自前の項目にする。
    let exit_item = MenuItemBuilder::with_id("quit", tr(locale, Key::WinExit)).build(app)?;
    let about_metadata = tauri::menu::AboutMetadataBuilder::new()
        .name(Some(app.package_info().name.clone()))
        .version(Some(app.package_info().version.to_string()))
        .license(Some("AGPL-3.0-or-later"))
        .website(Some("https://aoiko.pages.dev"))
        .copyright(Some("Copyright (C) 2026 Lonshaus"))
        .build();
    let file_menu = SubmenuBuilder::new(app, tr(locale, Key::WinFileMenu))
        .item(&print_item)
        .separator()
        .item(&exit_item)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, tr(locale, Key::WinEditMenu))
        .undo_with_text(tr(locale, Key::WinUndo))
        .redo_with_text(tr(locale, Key::WinRedo))
        .separator()
        .cut_with_text(tr(locale, Key::WinCut))
        .copy_with_text(tr(locale, Key::WinCopy))
        .paste_with_text(tr(locale, Key::WinPaste))
        .select_all_with_text(tr(locale, Key::WinSelectAll))
        .build()?;
    let view_menu = SubmenuBuilder::new(app, tr(locale, Key::WinViewMenu))
        .item(&reload_item)
        .separator()
        .item(&fullscreen_item)
        .build()?;
    let help_menu = SubmenuBuilder::new(app, tr(locale, Key::WinHelpMenu))
        .about_with_text(tr(locale, Key::WinAbout), Some(about_metadata))
        .build()?;
    MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &view_menu, &help_menu])
        .build()
}
// ネイティブメニューは WebView の外にあり、公開 repo のメッセージカタログを読めない。
// 言語を切り替えると web 側はページを再読み込みするので、読み込みのたびに現在の言語が
// ここへ渡ってくる。同じなら何もしないため、通常の再読み込みでは作り直さない。
//
// メニューの作り直しはウィンドウを閉じないので、未保存の入力は失われない。
// on_menu_event はメニューではなくアプリに紐づいているため、作り直しても外れない。
#[tauri::command]
fn set_ui_locale(app: tauri::AppHandle, locale: String) {
    #[cfg(desktop)]
    {
        // 知らない言語で作り直すと、訳の無い項目が出るより先にメニューが英語へ落ちる。
        // 今の表示のままにしておくほうが安全。
        let Some(next) = menu_i18n::Locale::from_tag(&locale) else {
            return;
        };
        let Some(state) = app.try_state::<UiLocale>() else {
            return;
        };
        {
            let Ok(mut current) = state.0.lock() else {
                return;
            };
            if *current == next {
                return;
            }
            *current = next;
        }
        save_ui_locale(&app, next);
        if let Ok(menu) = build_menu(&app, next) {
            let _ = app.set_menu(menu);
        }
    }
    #[cfg(not(desktop))]
    {
        // ある環境/ある環境 には tauri::menu 自体が無い。web 側は同じ呼び出しをするので受けるだけ。
        let _ = (&app, &locale);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // plugin-fs は登録しない。登録したままだと capabilities に fs:* を 1 行足すだけで
        // ページ上のスクリプトへファイル入出力が戻る。ファイルへ触るのは plugin-aoiko-native
        // のコマンドだけで、そちらが受け取れるのはバックアップフォルダからの相対パスに限る。
        // plugin-dialog も同じ理由で外してある。ダイアログを出すのは plugin-aoiko-native の
        // コマンドだけで、そちらは開く場所も文面も webview から指定できない。
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_aoiko_native::init())
        // 支援（アプリ内購入）。配る 3 つの環境（ある環境 / ある環境 / ある環境）にしか依存を入れて
        // いないので、Cargo.toml 側の target cfg で自動的にそこだけ有効になる。
        .plugin(tauri_plugin_iap::init())
        .invoke_handler(tauri::generate_handler![
            aoiko_fetch,
            force_close,
            is_ios,
            print_page,
            set_ui_locale
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("aoiko")
                .initialization_script(format!("window.__aoikoPlatform={PLATFORM:?};{INIT_SCRIPT}"))
                // マニュアルと UI の外部リンクは、そのままだとアプリのウィンドウごと外部サイトへ
                // 遷移し、戻る手段が無くなる。OS 標準のブラウザへ渡してナビゲーションは中止する。
                .on_navigation(move |url| {
                    let external = match url.scheme() {
                        "tauri" => false,
                        "http" | "https" => !matches!(
                            url.host_str().unwrap_or(""),
                            "localhost" | "127.0.0.1" | "tauri.localhost"
                        ),
                        _ => true,
                    };
                    if external {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    }
                    !external
                });
            // 寸法はデスクトップのウィンドウ用。モバイルへ持ち込むと画面ではなくこの値で
            // view 階層が作られ、layout viewport が画面幅に追従しなくなる（#39）。
            #[cfg(desktop)]
            let builder = builder
                .inner_size(1280.0, 860.0)
                .min_inner_size(400.0, 560.0);
            let window = builder.build()?;
            // メニューは desktop 専用。ある環境/ある環境 には tauri::menu 自体が無い。
            #[cfg(desktop)]
            {
                let locale = load_ui_locale(app.handle());
                app.manage(UiLocale(std::sync::Mutex::new(locale)));
                app.set_menu(build_menu(app.handle(), locale)?)?;

                app.on_menu_event(move |app, event| {
                    let Some(window) = app.get_webview_window("main") else {
                        return;
                    };
                    match event.id().as_ref() {
                        "print" => {
                            // OS の UI のモーダルを回すので、メニューのコールバックから抜けてから実行する。
                            tauri::async_runtime::spawn(async move {
                                let _ = print_page(window);
                            });
                        }
                        "reload" => {
                            // eval をこのコールバックの中で直接呼ぶと固まる（CLOSE_SCRIPT と同じ理由）。
                            tauri::async_runtime::spawn(async move {
                                let _ = window.eval(RELOAD_SCRIPT);
                            });
                        }
                        "quit" => {
                            // 赤い閉じるボタンと同じ経路。destroy() でウィンドウが消えれば
                            // プロセスは終了するため、確認後に別途終了処理を呼ぶ必要は無い。
                            tauri::async_runtime::spawn(async move {
                                let _ = window.eval(CLOSE_SCRIPT);
                            });
                        }
                        #[cfg(target_os = "windows")]
                        "fullscreen" => {
                            let on = window.is_fullscreen().unwrap_or(false);
                            let _ = window.set_fullscreen(!on);
                        }
                        _ => {}
                    }
                });
            }

            #[cfg(target_os = "windows")]
            apply_titlebar_icon(&window);

            let event_target = window.clone();
            window.on_window_event(move |event| {
                // ThemeChanged は builder で theme を指定していないときだけ届く（指定＝固定のため）。
                #[cfg(target_os = "windows")]
                if let WindowEvent::ThemeChanged(_) = event {
                    apply_titlebar_icon(&event_target);
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    // eval をこのコールバックの中で直接呼ぶと固まる。コールバックは主スレッドで走り、
                    // eval も主スレッドへディスパッチするため再入してデッドロックする（実機で確認）。
                    // 別スレッドへ逃がして、コールバックから抜けたあとにディスパッチさせる。
                    let target = event_target.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = target.eval(CLOSE_SCRIPT);
                    });
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_url, split_frame};
    // 属性が run() から離れると ある環境 だけ「required runtime symbols が無い」で落ち、desktop の
    // check も ある環境 の CI も通ってしまう（#88）。Apple SDK が要らない形で並びだけ見る。
    #[test]
    fn mobile_entry_point_stays_on_run() {
        let source = include_str!("lib.rs");
        let head = source
            .split("\npub fn run() {")
            .next()
            .expect("pub fn run() が無い");
        assert!(
            head.trim_end()
                .ends_with("#[cfg_attr(mobile, tauri::mobile_entry_point)]"),
            "run() の直上が mobile_entry_point ではない"
        );
    }

    fn frame(meta: &[u8], body: &[u8]) -> Vec<u8> {
        let mut out = (meta.len() as u32).to_le_bytes().to_vec();
        out.extend_from_slice(meta);
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn splits_frame() {
        let f = frame(b"{}", b"abc");
        assert_eq!(split_frame(&f), Ok((&b"{}"[..], &b"abc"[..])));
        assert_eq!(split_frame(&frame(b"", b"")), Ok((&b""[..], &b""[..])));
    }

    #[test]
    fn rejects_malformed_frame() {
        assert!(split_frame(&[]).is_err());
        assert!(split_frame(&[0, 0, 0]).is_err());
        // meta 長がバッファを超えている。
        assert!(split_frame(&[9, 0, 0, 0, 1, 2]).is_err());
        // 4 バイトが u32 の上限。usize へ広げるときに巻き戻らないこと。
        assert!(split_frame(&[255, 255, 255, 255, 1]).is_err());
    }

    #[test]
    fn allows_only_https_and_loopback() {
        let allowed = |u: &str| is_allowed_url(&reqwest::Url::parse(u).unwrap());
        assert!(allowed(
            "https://generativelanguage.googleapis.com/v1beta/x"
        ));
        assert!(allowed("http://localhost:11434/api/generate"));
        assert!(allowed("http://127.0.0.1:11434/api/generate"));
        // llm.ts の LOCAL_HOSTS と同じ集合。ここが狭いと Ollama の base URL を
        // これらで設定した利用者が、確認も出ないまま通信だけ失敗する。
        assert!(allowed("http://[::1]:11434/v1/models"));
        assert!(allowed("http://0.0.0.0:11434/v1/models"));
        assert!(!allowed("http://example.com/"));
        assert!(!allowed("http://192.168.1.1/"));
        assert!(!allowed("http://[::2]:11434/"));
        assert!(!allowed("file:///etc/passwd"));
        assert!(!allowed("ftp://example.com/"));
    }
}

#[cfg(test)]
mod frame_roundtrip {
    use super::fetch_frame;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc::{channel, Receiver};

    struct Received {
        method: String,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    }

    impl Received {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.as_str())
        }
    }
    // 1 接続だけ受けて、届いたものをそのまま返す。枠の組み立てが正しいかは
    // 「例外が出ない」ではなく「受け側に何が着いたか」でしか確かめられない。
    fn serve_once() -> (u16, Receiver<Received>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(stream);
            let mut start = String::new();
            reader.read_line(&mut start).expect("start line");
            let method = start
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_string();
            let mut headers = Vec::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("header line");
                let line = line.trim_end().to_string();
                if line.is_empty() {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
                }
            }
            let length = headers
                .iter()
                .find(|(k, _)| k == "content-length")
                .and_then(|(_, v)| v.parse::<usize>().ok())
                .unwrap_or(0);
            let mut body = vec![0u8; length];
            if length > 0 {
                reader.read_exact(&mut body).expect("body");
            }
            let mut stream = reader.into_inner();
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}",
                )
                .expect("respond");
            stream.flush().expect("flush");
            tx.send(Received {
                method,
                headers,
                body,
            })
            .expect("send");
        });
        (port, rx)
    }

    fn frame(meta: &str, body: &[u8]) -> Vec<u8> {
        let meta = meta.as_bytes();
        let mut out = (meta.len() as u32).to_le_bytes().to_vec();
        out.extend_from_slice(meta);
        out.extend_from_slice(body);
        out
    }
    // 応答も [4 バイト LE: meta 長][meta JSON][body]。
    fn response_status(frame: &[u8]) -> u16 {
        let length = u32::from_le_bytes(frame[..4].try_into().expect("meta 長")) as usize;
        let meta: serde_json::Value =
            serde_json::from_slice(&frame[4..4 + length]).expect("meta JSON");
        meta["status"].as_u64().expect("status") as u16
    }

    fn call(meta: &str, body: &[u8]) -> Result<Vec<u8>, String> {
        tauri::async_runtime::block_on(fetch_frame(&frame(meta, body)))
    }

    #[test]
    fn empty_body_get_arrives_intact() {
        let (port, rx) = serve_once();
        let meta = format!(
            r#"{{"url":"http://127.0.0.1:{port}/v1/models","method":"GET","headers":[["authorization","Bearer k"]]}}"#
        );
        let out = call(&meta, b"").expect("空 body の GET");
        assert_eq!(response_status(&out), 200);
        let got = rx.recv().expect("受信");
        assert_eq!(got.method, "GET");
        // ここが効くのは method の転送とヘッダーの保持。llm.ts のモデル一覧がこの形。
        // Content-Length の 2 行は reqwest 側の振る舞いを固定するためで、fetch_frame の
        // is_empty 分岐は捕まえない——分岐の有無で線に乗るものは変わらないことを実測済み。
        assert_eq!(got.header("content-length"), None);
        assert_eq!(got.header("transfer-encoding"), None);
        assert_eq!(got.body.len(), 0);
        assert_eq!(got.header("authorization"), Some("Bearer k"));
    }

    #[test]
    fn small_body_arrives_intact() {
        let (port, rx) = serve_once();
        let meta = format!(
            r#"{{"url":"http://127.0.0.1:{port}/v1/chat/completions","method":"POST","headers":[["content-type","application/json"]]}}"#
        );
        let sent = "{\"prompt\":\"領収書\"}".as_bytes();
        let out = call(&meta, sent).expect("小さい body の POST");
        assert_eq!(response_status(&out), 200);
        let got = rx.recv().expect("受信");
        assert_eq!(got.method, "POST");
        assert_eq!(got.header("content-type"), Some("application/json"));
        // 多バイト文字が途中で壊れないこと。
        assert_eq!(got.body, sent);
    }

    #[test]
    fn large_body_arrives_intact() {
        let (port, rx) = serve_once();
        let meta = format!(
            r#"{{"url":"http://127.0.0.1:{port}/ocr","method":"POST","headers":[["content-type","application/octet-stream"]]}}"#
        );
        let sent = vec![7u8; 200 * 1024];
        let out = call(&meta, &sent).expect("大きい body の POST");
        assert_eq!(response_status(&out), 200);
        let got = rx.recv().expect("受信");
        assert_eq!(got.body.len(), sent.len());
        assert_eq!(got.body, sent);
    }

    #[test]
    fn forbidden_headers_are_dropped() {
        let (port, rx) = serve_once();
        let meta = format!(
            r#"{{"url":"http://127.0.0.1:{port}/x","method":"POST","headers":[["cookie","a=1"],["origin","https://evil.example"],["content-type","application/json"]]}}"#
        );
        call(&meta, b"{}").expect("POST");
        let got = rx.recv().expect("受信");
        // 通すと Origin や Cookie を詐称できる別経路になる。
        assert_eq!(got.header("cookie"), None);
        assert_eq!(got.header("origin"), None);
        assert_eq!(got.header("content-type"), Some("application/json"));
    }

    #[test]
    fn disallowed_host_never_reaches_the_network() {
        let meta = r#"{"url":"http://example.com/v1/models","method":"GET","headers":[]}"#;
        let err = call(meta, b"").expect_err("許可外ホスト");
        assert!(err.contains("許可されていない"), "{err}");
    }
}
