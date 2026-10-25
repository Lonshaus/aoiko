use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Manager, Runtime,
};

use crate::{PickedFolder, ResolvedFolder, Result};

tauri::ios_plugin_binding!(init_plugin_aoiko_native);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<AoikoNative<R>> {
    let handle = api.register_ios_plugin(init_plugin_aoiko_native)?;
    Ok(AoikoNative(handle))
}

pub struct AoikoNative<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> AoikoNative<R> {
    pub fn pick_folder(&self) -> Result<Option<PickedFolder>> {
        self.0
            .run_mobile_plugin("pickFolder", ())
            .map_err(Into::into)
    }

    pub fn resolve_bookmark(&self, token: String) -> Result<ResolvedFolder> {
        self.0
            .run_mobile_plugin("resolveBookmark", serde_json::json!({ "token": token }))
            .map_err(Into::into)
    }

    pub fn print_page(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("printPage", ())
            .map_err(Into::into)
    }

    pub fn open_in_app(&self, url: String) -> Result<()> {
        self.0
            .run_mobile_plugin("openInApp", serde_json::json!({ "url": url }))
            .map_err(Into::into)
    }

    pub fn is_text_recognition_available(&self) -> bool {
        self.0
            .run_mobile_plugin("isTextRecognitionAvailable", ())
            .unwrap_or(false)
    }

    pub fn recognize_text(&self, image_base64: String) -> Result<crate::RecognizedText> {
        self.0
            .run_mobile_plugin(
                "recognizeText",
                serde_json::json!({ "imageBase64": image_base64 }),
            )
            .map_err(Into::into)
    }
}

pub trait AoikoNativeExt<R: Runtime> {
    fn aoiko_native(&self) -> &AoikoNative<R>;
}

impl<R: Runtime, T: Manager<R>> AoikoNativeExt<R> for T {
    fn aoiko_native(&self) -> &AoikoNative<R> {
        self.state::<AoikoNative<R>>().inner()
    }
}
// SwiftPM の tauri-plugin-aoiko-native ターゲットは Rust と 1 つの静的ライブラリへ
// リンクされる（ios_plugin_binding! の init_plugin_aoiko_native と同じ経路）。
// Plugin クラスの invoke を介さず、desktop.rs の macOS 版と同じく直接呼べる。
pub(crate) mod apple_intelligence {
    use std::ffi::{c_char, CStr};

    extern "C" {
        fn aoiko_ai_availability() -> i32;
        fn aoiko_ai_extract(bytes: *const u8, length: usize, out_err: *mut i32) -> *mut c_char;
        fn aoiko_ai_run(
            task: i32,
            bytes: *const u8,
            length: usize,
            out_err: *mut i32,
        ) -> *mut c_char;
        fn aoiko_ai_free(p: *mut c_char);
    }
    pub(crate) fn availability() -> u8 {
        unsafe { aoiko_ai_availability() as u8 }
    }
    // desktop.rs 側と同じ橋渡し。ポインタは中身を写し終えた後、成功・失敗どちらの経路でも
    // aoiko_ai_free で解放する。
    pub(crate) fn extract(image_data: &[u8]) -> Result<String, u8> {
        let mut err: i32 = 0;
        let ptr = unsafe { aoiko_ai_extract(image_data.as_ptr(), image_data.len(), &mut err) };
        if ptr.is_null() {
            return Err(err as u8);
        }
        let json = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { aoiko_ai_free(ptr) };
        Ok(json)
    }
    // 分類・注文取込。desktop.rs 側と同じ橋渡し。
    pub(crate) fn run(task: i32, data: &str) -> Result<String, u8> {
        let mut err: i32 = 0;
        let bytes = data.as_bytes();
        let ptr = unsafe { aoiko_ai_run(task, bytes.as_ptr(), bytes.len(), &mut err) };
        if ptr.is_null() {
            return Err(err as u8);
        }
        let json = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { aoiko_ai_free(ptr) };
        Ok(json)
    }
}
// 解析の完了通知。AnalysisNotify.swift の入口を直に呼ぶ（desktop.rs の macOS 版と同じ形）。
// 文面は notify.rs の固定表の CStr だけを渡し、ポインタは呼び出しの間しか使われない。
pub(crate) mod analysis_notify {
    use std::ffi::{c_char, CStr};

    use tauri::{AppHandle, Emitter, EventTarget, Runtime};

    use crate::notify::{self, AnalysisKind, NotifyStatus};

    extern "C" {
        fn aoiko_notify_status() -> i32;
        fn aoiko_notify_request() -> i32;
        fn aoiko_notify_post(kind: i32, title: *const c_char, body: *const c_char) -> i32;
        fn aoiko_notify_set_open_handler(handler: extern "C" fn(i32));
    }
    // 呼び出しはどれもワーカースレッドから。ネイティブ側が待つので、メインスレッドで呼ばない。
    pub(crate) fn status() -> NotifyStatus {
        NotifyStatus::from_code(unsafe { aoiko_notify_status() })
    }

    pub(crate) fn request() -> NotifyStatus {
        NotifyStatus::from_code(unsafe { aoiko_notify_request() })
    }

    pub(crate) fn post(kind: AnalysisKind, title: &CStr, body: &CStr) -> bool {
        unsafe { aoiko_notify_post(kind.index(), title.as_ptr(), body.as_ptr()) == 0 }
    }

    #[derive(Clone, serde::Serialize)]
    struct OpenPayload {
        kind: AnalysisKind,
    }
    // 画面を開く合図だけを送る。iOS は通知を押した時点でアプリが前面へ出る。
    fn open_main<R: Runtime>(app: &AppHandle<R>, kind: AnalysisKind) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = app.emit_to(
                EventTarget::WebviewWindow {
                    label: "main".to_string(),
                },
                "aoiko-analysis-open",
                OpenPayload { kind },
            );
        });
    }
    // ネイティブ側から呼ばれる。panic を C の側へ出さず、重い処理はここでは行わない。
    extern "C" fn on_open(kind: i32) {
        notify::dispatch_open(kind);
    }

    pub(crate) fn install<R: Runtime>(app: &AppHandle<R>) {
        let emitter = app.clone();
        notify::set_open_emitter(Box::new(move |kind| open_main(&emitter, kind)));
        unsafe { aoiko_notify_set_open_handler(on_open) };
    }
}
