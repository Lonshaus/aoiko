use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Manager, Runtime,
};

use crate::{Error, HttpRequest, HttpResponse, PickedFolder, ResolvedFolder, Result};

const PLUGIN_IDENTIFIER: &str = "net.lonshaus.aoiko.nativeplugin";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<AoikoNative<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "AoikoNativePlugin")?;
    Ok(AoikoNative(handle))
}

pub struct AoikoNative<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> AoikoNative<R> {
    pub fn pick_folder(&self) -> Result<Option<PickedFolder>> {
        self.0
            .run_mobile_plugin("pickFolder", ())
            .map_err(Into::into)
    }
    // SAF の content:// はパスにならないので path は返らない。存在確認だけを持ち帰る。
    pub fn resolve_bookmark(&self, token: String) -> Result<ResolvedFolder> {
        self.0
            .run_mobile_plugin("resolveBookmark", serde_json::json!({ "token": token }))
            .map_err(Into::into)
    }
    pub fn close_app(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("closeApp", serde_json::json!({}))
            .map_err(Into::into)
    }

    pub fn confirm_discard(
        &self,
        message: &str,
        ok_label: &str,
        cancel_label: &str,
    ) -> Result<bool> {
        self.0
            .run_mobile_plugin(
                "confirmDiscard",
                serde_json::json!({
                    "message": message,
                    "okLabel": ok_label,
                    "cancelLabel": cancel_label,
                }),
            )
            .map_err(Into::into)
    }
    // 以下は SAF 配下の入出力。パスで触れないので ネイティブ側 側で完結させる。
    // 見つからないのは正常な分岐なので None。frame の found に translate するのは呼出側。
    pub fn backup_read(&self, token: &str, rel_path: &str) -> Result<Option<Vec<u8>>> {
        #[derive(serde::Deserialize)]
        struct Body {
            found: bool,
            b64: String,
        }
        let body: Body = self
            .0
            .run_mobile_plugin(
                "backupRead",
                serde_json::json!({ "token": token, "relPath": rel_path }),
            )
            .map_err(Error::PluginInvoke)?;
        if !body.found {
            return Ok(None);
        }
        use base64::{engine::general_purpose::STANDARD, Engine};
        let bytes = STANDARD
            .decode(body.b64.as_bytes())
            .map_err(|e| Error::Io(format!("読み込んだ内容を解けません: {e}")))?;
        Ok(Some(bytes))
    }

    // 保存ダイアログ相当。取り消しは None。rid は backup_* と同じ登記簿のもの。
    pub fn export_open(&self, file_name: &str) -> Result<Option<u32>> {
        self.0
            .run_mobile_plugin("exportOpen", serde_json::json!({ "fileName": file_name }))
            .map_err(Into::into)
    }

    pub fn backup_list(&self, token: &str, subdir: Option<&str>) -> Result<Vec<String>> {
        #[derive(serde::Deserialize)]
        struct Body {
            names: Vec<String>,
        }
        let body: Body = self
            .0
            .run_mobile_plugin(
                "backupList",
                serde_json::json!({ "token": token, "subdir": subdir }),
            )
            .map_err(Error::PluginInvoke)?;
        Ok(body.names)
    }

    pub fn backup_open(&self, token: &str, rel_path: &str) -> Result<u32> {
        self.0
            .run_mobile_plugin(
                "backupOpen",
                serde_json::json!({ "token": token, "relPath": rel_path }),
            )
            .map_err(Into::into)
    }
    // チャンクは base64 で渡す。ある環境 の IPC は生バイトを運べない。
    pub fn backup_write_chunk(&self, rid: u32, chunk: &[u8]) -> Result<()> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        self.0
            .run_mobile_plugin(
                "backupWriteChunk",
                serde_json::json!({ "rid": rid, "b64": STANDARD.encode(chunk) }),
            )
            .map_err(Into::into)
    }

    pub fn backup_close(&self, rid: u32) -> Result<()> {
        self.0
            .run_mobile_plugin("backupClose", serde_json::json!({ "rid": rid }))
            .map_err(Into::into)
    }

    pub fn backup_remove(&self, token: &str, rel_path: &str) -> Result<()> {
        self.0
            .run_mobile_plugin(
                "backupRemove",
                serde_json::json!({ "token": token, "relPath": rel_path }),
            )
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
    // ある環境 には Rust から借りられる system TLS が無い。送信だけ ネイティブ側 へ渡し、
    // 宛先の検査もリダイレクトの判断も本体 crate 側に残す。
    pub fn http_send(&self, request: HttpRequest) -> Result<HttpResponse> {
        self.0
            .run_mobile_plugin("httpSend", request)
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
