// ネイティブ側 側を書くまでの仮置き。register_android_plugin は ネイティブ側 の実体が無いと失敗するので、
// ここでは登録せず、全ての指令を未対応として返す。
use std::marker::PhantomData;

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Manager, Runtime};

use crate::{Error, HttpRequest, HttpResponse, PickedFolder, ResolvedFolder, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<AoikoNative<R>> {
    Ok(AoikoNative(PhantomData))
}

pub struct AoikoNative<R: Runtime>(PhantomData<fn() -> R>);

impl<R: Runtime> AoikoNative<R> {
    pub fn pick_folder(&self) -> Result<Option<PickedFolder>> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn resolve_bookmark(&self, _token: String) -> Result<ResolvedFolder> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn print_page(&self) -> Result<()> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn open_in_app(&self, _url: String) -> Result<()> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn is_text_recognition_available(&self) -> bool {
        false
    }

    pub fn recognize_text(&self, _image_base64: String) -> Result<crate::RecognizedText> {
        Err(Error::UnsupportedPlatform)
    }
    // ある環境 には Rust から借りられる system TLS が無い。送信だけ ネイティブ側 へ渡し、
    // 宛先の検査もリダイレクトの判断も本体 crate 側に残す。
    pub fn http_send(&self, _request: HttpRequest) -> Result<HttpResponse> {
        Err(Error::UnsupportedPlatform)
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
