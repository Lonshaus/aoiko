// バックアップフォルダの選択・記録・解決と、ある環境/ある環境 の印刷とアプリ内ブラウザ表示。
//
// 選んだフォルダの記録はこのプラグインが持ち、読み書きの起点になる場所もここでしか決めない。
// JS から受け取れるのはその起点からの相対パスだけで、実パスへ解くのは path.rs の
// resolve_within に限る。起点そのものを JS から渡せる口があると、ページ上のどのスクリプト
// からでも任意の場所を読み書きできてしまう。
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod backup;
mod commands;
#[cfg(not(target_os = "ios"))]
mod desktop;
#[cfg(target_os = "ios")]
mod ios;
mod path;
mod store;

#[derive(Debug)]
pub enum Error {
    #[cfg(target_os = "ios")]
    PluginInvoke(tauri::plugin::mobile::PluginInvokeError),
    UnsupportedPlatform,
    Store(String),
    /// JS から渡されたパスが、バックアップフォルダの外を指し得る形だった。
    InvalidPath(String),
    Io(String),
    /// バックアップフォルダが未設定、または解決できない。
    FolderUnavailable,
    /// 未知の rid、または close 済みの rid が指定された。
    UnknownFile,
    TooManyOpenFiles,
    /// 書き込みチャンクの渡され方が違う（rid ヘッダーが無い、本文が生バイトでない）。
    BadChunkRequest(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            #[cfg(target_os = "ios")]
            Error::PluginInvoke(e) => write!(f, "{e}"),
            Error::UnsupportedPlatform => write!(f, "この機能は iOS/iPadOS でのみ利用できます"),
            Error::Store(e) => write!(f, "バックアップフォルダを記録できません: {e}"),
            Error::InvalidPath(e) => write!(f, "指定されたパスは使えません: {e}"),
            Error::Io(e) => write!(f, "ファイルを操作できません: {e}"),
            Error::FolderUnavailable => {
                write!(
                    f,
                    "バックアップフォルダが設定されていないか、見つかりません"
                )
            }
            Error::UnknownFile => write!(f, "対象のファイルは開かれていません"),
            Error::TooManyOpenFiles => write!(f, "同時に開けるファイルの上限を超えました"),
            Error::BadChunkRequest(e) => write!(f, "書き込みの指定が不正です: {e}"),
        }
    }
}

impl std::error::Error for Error {}

#[cfg(target_os = "ios")]
impl From<tauri::plugin::mobile::PluginInvokeError> for Error {
    fn from(e: tauri::plugin::mobile::PluginInvokeError) -> Self {
        Error::PluginInvoke(e)
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    /// web 側が保管する不透明な文字列。解決には使わない（記録はプラグインが持つ）。
    pub token: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedFolder {
    pub ready: bool,
    /// ready のときだけ入る。ある環境 は file:// URL、デスクトップは素のパス。
    pub path: Option<String>,
}

impl ResolvedFolder {
    fn unavailable() -> Self {
        Self {
            ready: false,
            path: None,
        }
    }
}
// 解決は 1 回で済ませる。ある環境 の bookmark は解決のたびに新しい URL の権限を取り、
// 手放さない実装（書き込み中に権限が消えないため）なので、毎回やると積み上がる。
#[derive(Default)]
pub(crate) struct Resolved(Mutex<Option<(String, String)>>);

impl Resolved {
    fn get(&self, handle: &str) -> Option<String> {
        let held = self.0.lock().ok()?;
        held.as_ref()
            .filter(|(cached, _)| cached == handle)
            .map(|(_, path)| path.clone())
    }

    fn set(&self, handle: &str, path: &str) {
        if let Ok(mut held) = self.0.lock() {
            *held = Some((handle.to_string(), path.to_string()));
        }
    }

    fn clear(&self) {
        if let Ok(mut held) = self.0.lock() {
            *held = None;
        }
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("aoiko-native")
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::resolve_folder,
            commands::print_page,
            commands::open_in_app,
            commands::confirm_discard,
            commands::backup_open,
            commands::backup_write_chunk,
            commands::backup_close,
            commands::backup_read,
            commands::backup_list,
            commands::backup_remove,
            commands::export_open,
        ])
        .setup(|app, _api| {
            app.manage(Resolved::default());
            app.manage(backup::OpenFiles::default());
            #[cfg(target_os = "ios")]
            {
                let handle = ios::init(app, _api)?;
                app.manage(handle);
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::Resolved;

    #[test]
    fn caches_only_the_current_handle() {
        let cache = Resolved::default();
        assert_eq!(cache.get("a"), None);
        cache.set("a", "/tmp/a");
        assert_eq!(cache.get("a"), Some("/tmp/a".to_string()));
        // 選び直したあとの古いハンドルで前のパスが返ると、消えたフォルダへ書き続ける。
        assert_eq!(cache.get("b"), None);
        cache.clear();
        assert_eq!(cache.get("a"), None);
    }
}
