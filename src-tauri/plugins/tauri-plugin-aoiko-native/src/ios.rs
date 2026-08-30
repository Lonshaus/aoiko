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
