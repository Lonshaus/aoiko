use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::{Error, Result};

const FOLDER_FILE: &str = "backup-folder.json";
#[cfg(not(any(target_os = "ios", target_os = "android")))]
const LAST_DIR_FILE: &str = "last-dir";
// バックアップフォルダの記録はここが持つ。web 側にも token を返すが、解決に使うのは
// 常にこのファイルのほう。JS から渡された文字列をそのままスコープへ通すと、ページ上の
// どのスクリプトからでも任意の場所を読み書きできる口になる。
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct StoredFolder {
    /// 画面に出すフォルダ名。
    pub name: String,
    /// OS が発行した security-scoped bookmark か、素のパス。
    /// 中身の見分けは platform 側の resolve に任せる。
    pub handle: String,
}

fn path<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| Error::Store(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| Error::Store(e.to_string()))?;
    Ok(dir.join(name))
}
// 読めない・壊れている場合は「未設定」に倒す。ここで失敗を投げると、web 側の
// 「選び直し」導線まで到達できずに初期化が止まる。
pub(crate) fn load<R: Runtime>(app: &AppHandle<R>) -> Option<StoredFolder> {
    let raw = std::fs::read(path(app, FOLDER_FILE).ok()?).ok()?;
    serde_json::from_slice(&raw).ok()
}

pub(crate) fn save<R: Runtime>(app: &AppHandle<R>, folder: &StoredFolder) -> Result<()> {
    let raw = serde_json::to_vec(folder).map_err(|e| Error::Store(e.to_string()))?;
    std::fs::write(path(app, FOLDER_FILE)?, raw).map_err(|e| Error::Store(e.to_string()))
}
// 保存・フォルダ選択ダイアログを前回の場所から開くための記録。パス 1 行だけなので JSON に
// しない。読めなければ「記録無し」に倒す（desktop.rs が書類フォルダへ落とす）。
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub(crate) fn load_last_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(path(app, LAST_DIR_FILE).ok()?).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}
// 書けなくてもダイアログは出せる。次回また書類フォルダから開くだけなので握り潰す。
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub(crate) fn save_last_dir<R: Runtime>(app: &AppHandle<R>, dir: &std::path::Path) {
    if let Ok(file) = path(app, LAST_DIR_FILE) {
        let _ = std::fs::write(file, dir.to_string_lossy().as_bytes());
    }
}
