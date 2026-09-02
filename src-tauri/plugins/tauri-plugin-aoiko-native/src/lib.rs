// バックアップフォルダの選択・記録・解決と、モバイルの印刷とアプリ内ブラウザ表示。
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
    /// 文字認識に失敗、または文字が 1 つも見つからなかった。
    Ocr(String),
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
            Error::Ocr(e) => write!(f, "文字を認識できません: {e}"),
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
    /// ready のときだけ入る。モバイルは file:// URL、デスクトップは素のパス。
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

/// 文字認識が返す 1 単語。座標は 0..1 の正規化・左上原点・y 下向き。
/// 環境ごとの座標系の違いはここで吸収する。web 側に分岐を持たせない。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizedWord {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// 返さない環境では None。
    pub confidence: Option<f64>,
    /// 第 2 候補以降を確からしい順に。
    pub alternates: Vec<String>,
    /// 文字の基線の傾き（この正規化座標での dy/dx）。向きを返せる引擎だけが入れる。
    /// 角度ではなく傾きで渡すのは、角度からの換算に画素の縦横比が要るため。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slope: Option<f64>,
}

/// 縦に重なる単語をまとめた 1 行。座標はそれらを囲む矩形。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizedLine {
    pub text: String,
    pub words: Vec<RecognizedWord>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 文字認識の結果一式。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizedText {
    pub lines: Vec<RecognizedLine>,
    /// 行を改行で繋いだ全文。座標が要らない抽出はこれで足りる。
    pub text: String,
}

impl RecognizedLine {
    // モバイルではネイティブ側が組んで返すため、Rust は受け取るだけ。
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn from_words(words: Vec<RecognizedWord>, separator: &str) -> Option<Self> {
        let first = words.first()?;
        let mut left = first.x;
        let mut top = first.y;
        let mut right = first.x + first.width;
        let mut bottom = first.y + first.height;
        for w in &words[1..] {
            left = left.min(w.x);
            top = top.min(w.y);
            right = right.max(w.x + w.width);
            bottom = bottom.max(w.y + w.height);
        }
        let text = words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(separator);
        Some(Self {
            text,
            words,
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        })
    }
}

impl RecognizedText {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn from_lines(lines: Vec<RecognizedLine>) -> Self {
        let text = lines
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        Self { lines, text }
    }
}
// 解決は 1 回で済ませる。bookmark は解決のたびに新しい URL の権限を取り、
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
            commands::recognize_text,
            commands::is_text_recognition_available,
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
