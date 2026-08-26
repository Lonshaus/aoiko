// バックアップフォルダ配下のファイル入出力。plugin-fs を webview の capability から
// 落とすための置き換えで、JS からパスを受け取る唯一の経路になる。
//
// 実処理は base: &Path を取る素の関数に置いてある。tauri::command は AppHandle が要り
// テストから呼べないので、コマンド側はフォルダを解決して渡すだけの薄い殻にする。
// ある環境 は SAF 経由で ネイティブ側 側が入出力を持つので、この module のパス操作は通らない。
#![cfg_attr(target_os = "android", allow(dead_code))]
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use crate::path::{resolve_within, validate_single_segment, SafeTarget};
use crate::{Error, Result};
// ページ上のどのスクリプトからでも呼べる。上限が無いと、閉じない open を繰り返すだけで
// File を無制限に積み上げられる。
const MAX_OPEN: usize = 8;

const META_FOUND: &[u8] = br#"{"found":true}"#;
const META_NOT_FOUND: &[u8] = br#"{"found":false}"#;

fn io(e: std::io::Error) -> Error {
    Error::Io(e.to_string())
}

#[derive(Default)]
struct Registry {
    next: u32,
    files: HashMap<u32, File>,
}
/// 書き込み途中のファイルの置き場。web 側へ渡るのは rid だけで、パスは渡らない。
#[derive(Default)]
pub(crate) struct OpenFiles(Mutex<Registry>);

impl OpenFiles {
    fn registry(&self) -> Result<MutexGuard<'_, Registry>> {
        self.0
            .lock()
            .map_err(|_| Error::Io("書き込み状態が壊れています".to_string()))
    }

    pub(crate) fn open(&self, base: &Path, rel_path: &str) -> Result<u32> {
        self.open_target(resolve_within(base, rel_path)?)
    }
    /// 検査済みの書き出し先を開く。ここが登録簿への唯一の入口で、素の PathBuf は渡せない。
    ///
    /// SafeTarget を作れるのは path.rs の resolve_within と from_os_chosen だけ。どちらを
    /// 通ってきたかは呼び側のコードにそのまま名前で残る。
    pub(crate) fn open_target(&self, target: SafeTarget) -> Result<u32> {
        let target = target.as_path();
        let mut registry = self.registry()?;
        if registry.files.len() >= MAX_OPEN {
            return Err(Error::TooManyOpenFiles);
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(target)
            .map_err(io)?;
        // 使用中の rid を再発行しない。同時に 8 本までなので、一周しても数回で空きに当たる。
        loop {
            registry.next = registry.next.wrapping_add(1);
            if !registry.files.contains_key(&registry.next) {
                break;
            }
        }
        let rid = registry.next;
        registry.files.insert(rid, file);
        Ok(rid)
    }

    pub(crate) fn write_chunk(&self, rid: u32, chunk: &[u8]) -> Result<()> {
        let mut registry = self.registry()?;
        let file = registry.files.get_mut(&rid).ok_or(Error::UnknownFile)?;
        file.write_all(chunk).map_err(io)
    }

    pub(crate) fn close(&self, rid: u32) -> Result<()> {
        let file = self
            .registry()?
            .files
            .remove(&rid)
            .ok_or(Error::UnknownFile)?;
        drop(file);
        Ok(())
    }
}
/// 台帳エクスポートの書き出し先を ask で決め、rid を返す。取り消しは Ok(None) で、
/// エラーにはしない（呼出側は「保存しなかった」と「失敗した」を区別する）。
///
/// 書き出し先を決める手順だけ引数で受ける。AppHandle が要る部分を外へ出しておけば、
/// 「file_name を検査してから書き出し先を決める」順序をテストで固定できる。
/// デスクトップは保存ダイアログ、モバイルは下の mobile_export_target。
pub(crate) fn export_open(
    files: &OpenFiles,
    file_name: &str,
    ask: impl FnOnce(&str) -> Result<Option<SafeTarget>>,
) -> Result<Option<u32>> {
    let suggested = validate_single_segment(file_name)?;
    let Some(target) = ask(suggested)? else {
        return Ok(None);
    };
    files.open_target(target).map(Some)
}
/// モバイルの台帳エクスポート先。保存先を選ばせる仕組みが無いので Documents 直下に固定する。
///
/// file_name は export_open の validate_single_segment を通ったものだけ。join は絶対パスを
/// 渡されると documents ごと差し替えるので、区切りもドライブ指定も弾かれていることが前提。
#[cfg(any(target_os = "ios", test))]
pub(crate) fn mobile_export_target(documents: &Path, file_name: &str) -> SafeTarget {
    SafeTarget::from_os_chosen(documents.join(file_name))
}
/// [meta 長 4 バイト LE][meta JSON][本文]。aoiko_fetch と同じ枠。
///
/// 「まだ同期されていない」はエラーではなく正常な分岐で、空のファイルとは区別が要る。
/// 本文の有無では表せないので meta を前に付ける。
fn frame(meta: &[u8], body: &[u8]) -> Vec<u8> {
    let mut framed = Vec::with_capacity(4 + meta.len() + body.len());
    framed.extend_from_slice(&(meta.len() as u32).to_le_bytes());
    framed.extend_from_slice(meta);
    framed.extend_from_slice(body);
    framed
}

/// SAF から読んだ本文を read と同じ枠に載せる。ある環境 はパスで開けないので
/// 読み出しそのものは ネイティブ側 側にあり、枠だけこちらで揃える。
#[cfg(target_os = "android")]
pub(crate) fn frame_reply(body: Option<Vec<u8>>) -> Vec<u8> {
    match body {
        Some(body) => frame(META_FOUND, &body),
        None => frame(META_NOT_FOUND, &[]),
    }
}

pub(crate) fn read(base: &Path, rel_path: &str) -> Result<Vec<u8>> {
    let target = resolve_within(base, rel_path)?;
    match fs::read(target.as_path()) {
        Ok(body) => Ok(frame(META_FOUND, &body)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(frame(META_NOT_FOUND, &[])),
        Err(e) => Err(io(e)),
    }
}

pub(crate) fn list(base: &Path, subdir: Option<&str>) -> Result<Vec<String>> {
    let dir = match subdir {
        Some(subdir) => resolve_within(base, subdir)?.as_path().to_path_buf(),
        None => base.to_path_buf(),
    };
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        // まだ 1 つも書き出していないだけ。空として扱う。ほかの失敗は隠さない。
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(io(e)),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(io)?;
        // file_type はリンクを辿らないので、外を指すシンボリックリンクは file にならない。
        if entry.file_type().map_err(io)?.is_file() {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    Ok(names)
}

pub(crate) fn remove(base: &Path, rel_path: &str) -> Result<()> {
    let target = resolve_within(base, rel_path)?;
    // ディレクトリごと消せる口は作らない。remove_dir_all は持ち込まない。
    if target.as_path().is_dir() {
        return Err(Error::InvalidPath(
            "ディレクトリは削除できません".to_string(),
        ));
    }
    fs::remove_file(target.as_path()).map_err(io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_dir(tag: &str) -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "aoiko-backup-{}-{}-{}",
            tag,
            std::process::id(),
            unique
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn split(framed: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let mut length = [0u8; 4];
        length.copy_from_slice(&framed[..4]);
        let meta_length = u32::from_le_bytes(length) as usize;
        (
            framed[4..4 + meta_length].to_vec(),
            framed[4 + meta_length..].to_vec(),
        )
    }

    fn write_file(base: &Path, rel_path: &str, chunks: &[&[u8]]) {
        let files = OpenFiles::default();
        let rid = files.open(base, rel_path).unwrap();
        for chunk in chunks {
            files.write_chunk(rid, chunk).unwrap();
        }
        files.close(rid).unwrap();
    }

    #[test]
    fn writes_then_reads_the_same_bytes_back() {
        let base = temp_dir("roundtrip");
        write_file(&base, "aoiko-ledger.zip", &[b"hello"]);

        let (meta, body) = split(&read(&base, "aoiko-ledger.zip").unwrap());
        assert_eq!(meta, META_FOUND);
        assert_eq!(body, b"hello");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn writes_nested_paths_and_creates_the_parent() {
        let base = temp_dir("nested");
        write_file(&base, "snapshots/2026-08-09T120000Z.json", &[b"{}"]);
        assert!(base.join("snapshots/2026-08-09T120000Z.json").is_file());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn chunks_concatenate_in_order() {
        let base = temp_dir("chunks");
        write_file(&base, "a.bin", &[b"one", b"two", b"three"]);

        let (_, body) = split(&read(&base, "a.bin").unwrap());
        assert_eq!(body, b"onetwothree");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn truncates_a_file_that_already_exists() {
        let base = temp_dir("truncate");
        write_file(&base, "a.bin", &[b"0123456789"]);
        write_file(&base, "a.bin", &[b"ab"]);

        let (_, body) = split(&read(&base, "a.bin").unwrap());
        assert_eq!(body, b"ab");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rejects_chunks_for_unknown_and_closed_files() {
        let base = temp_dir("rid");
        let files = OpenFiles::default();
        let rid = files.open(&base, "a.bin").unwrap();

        assert!(files.write_chunk(rid.wrapping_add(1), b"x").is_err());
        files.close(rid).unwrap();
        // 閉じたあとの書き込みが黙って捨てられると、壊れたバックアップが完成扱いになる。
        assert!(files.write_chunk(rid, b"x").is_err());
        assert!(files.close(rid).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn caps_the_number_of_open_files() {
        let base = temp_dir("cap");
        let files = OpenFiles::default();
        let mut rids = Vec::new();
        for i in 0..MAX_OPEN {
            rids.push(files.open(&base, &format!("f{i}.bin")).unwrap());
        }
        assert!(files.open(&base, "overflow.bin").is_err());
        // 閉じれば枠は戻る。
        files.close(rids[0]).unwrap();
        assert!(files.open(&base, "overflow.bin").is_ok());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn reports_not_found_without_an_error() {
        let base = temp_dir("missing");
        let (meta, body) = split(&read(&base, "absent.zip").unwrap());
        assert_eq!(meta, META_NOT_FOUND);
        assert!(body.is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn distinguishes_an_empty_file_from_a_missing_one() {
        let base = temp_dir("empty");
        write_file(&base, "empty.bin", &[]);

        let (meta, body) = split(&read(&base, "empty.bin").unwrap());
        assert_eq!(meta, META_FOUND);
        assert!(body.is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn lists_only_file_names() {
        let base = temp_dir("list");
        write_file(&base, "a.zip", &[b"a"]);
        write_file(&base, "snapshots/b.json", &[b"b"]);

        let mut names = list(&base, None).unwrap();
        names.sort();
        assert_eq!(names, vec!["a.zip".to_string()]);
        assert_eq!(list(&base, Some("snapshots")).unwrap(), vec!["b.json"]);
        assert!(list(&base, Some("attachments")).unwrap().is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn removes_files_but_never_directories() {
        let base = temp_dir("remove");
        write_file(&base, "snapshots/b.json", &[b"b"]);

        remove(&base, "snapshots/b.json").unwrap();
        assert!(!base.join("snapshots/b.json").exists());
        // OS も remove_file をディレクトリに対して拒む（EISDIR）ので、is_err だけでは
        // 自前の防壁を外しても素通りする。どの理由で断ったのかまで見る。
        assert!(matches!(
            remove(&base, "snapshots"),
            Err(Error::InvalidPath(_))
        ));
        assert!(base.join("snapshots").is_dir());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn every_path_argument_goes_through_the_validator() {
        let base = temp_dir("escape");
        let files = OpenFiles::default();
        for bad in ["../escape", "/etc/passwd", "a\\b"] {
            assert!(files.open(&base, bad).is_err(), "open が通した: {bad:?}");
            assert!(read(&base, bad).is_err(), "read が通した: {bad:?}");
            assert!(remove(&base, bad).is_err(), "remove が通した: {bad:?}");
            assert!(list(&base, Some(bad)).is_err(), "list が通した: {bad:?}");
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn exports_write_through_the_same_rid_and_close() {
        let dir = temp_dir("export");
        // 書き出し先はバックアップフォルダの外。ダイアログが返した想定の絶対パスを渡す。
        let target = dir.join("台帳.zip");
        let files = OpenFiles::default();
        let rid = export_open(&files, "aoiko-ledger.zip", |suggested| {
            assert_eq!(suggested, "aoiko-ledger.zip");
            Ok(Some(SafeTarget::from_os_chosen(target.clone())))
        })
        .unwrap()
        .unwrap();

        files.write_chunk(rid, b"one").unwrap();
        files.write_chunk(rid, b"two").unwrap();
        files.close(rid).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"onetwo");
        // backup_open と同じ rid の枠。閉じたあとに書けると、途中で切れた zip が完成扱いになる。
        assert!(files.write_chunk(rid, b"x").is_err());
        assert!(files.close(rid).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cancelled_dialog_is_not_an_error() {
        let files = OpenFiles::default();
        assert!(export_open(&files, "a.zip", |_| Ok(None))
            .unwrap()
            .is_none());
    }

    #[test]
    fn exports_share_the_open_file_cap_with_backups() {
        let base = temp_dir("export-cap");
        let files = OpenFiles::default();
        for i in 0..MAX_OPEN {
            files.open(&base, &format!("f{i}.bin")).unwrap();
        }
        let target = base.join("over.zip");
        assert!(matches!(
            export_open(&files, "over.zip", |_| Ok(Some(
                SafeTarget::from_os_chosen(target)
            ))),
            Err(Error::TooManyOpenFiles)
        ));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn backups_share_the_open_file_cap_with_exports() {
        let base = temp_dir("export-cap-reverse");
        let files = OpenFiles::default();
        for i in 0..MAX_OPEN {
            let target = base.join(format!("e{i}.zip"));
            export_open(&files, "e.zip", |_| {
                Ok(Some(SafeTarget::from_os_chosen(target)))
            })
            .unwrap()
            .unwrap();
        }
        assert!(matches!(
            files.open(&base, "over.bin"),
            Err(Error::TooManyOpenFiles)
        ));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_suggested_name_is_checked_before_the_dialog_opens() {
        let files = OpenFiles::default();
        for bad in ["../x", "a/b", "", "..", "a\\b", "C:x"] {
            let opened = export_open(&files, bad, |_| {
                panic!("検査を通さずにダイアログを開いてはいけない: {bad:?}")
            });
            assert!(
                matches!(opened, Err(Error::InvalidPath(_))),
                "通ってはいけない: {bad:?}"
            );
        }
    }

    #[test]
    fn the_mobile_export_target_sits_directly_under_documents() {
        assert_eq!(
            mobile_export_target(Path::new("/var/mobile/Documents"), "aoiko-ledger.zip").as_path(),
            PathBuf::from("/var/mobile/Documents/aoiko-ledger.zip")
        );
    }

    #[test]
    fn the_ios_export_cannot_leave_documents() {
        let documents = temp_dir("ios-export");
        let files = OpenFiles::default();
        // ある環境 の ask は取り消しが無く必ず Some を返すので、検査が先に立たないと
        // Documents の外を指す名前でもそのまま開いてしまう。
        for bad in ["../escape.zip", "/etc/passwd", "a/b.zip", "C:x", ".."] {
            let opened = export_open(&files, bad, |suggested| {
                Ok(Some(mobile_export_target(&documents, suggested)))
            });
            assert!(
                matches!(opened, Err(Error::InvalidPath(_))),
                "通ってはいけない: {bad:?}"
            );
        }
        let rid = export_open(&files, "aoiko-ledger.zip", |suggested| {
            Ok(Some(mobile_export_target(&documents, suggested)))
        })
        .unwrap()
        .unwrap();
        files.write_chunk(rid, b"x").unwrap();
        files.close(rid).unwrap();
        assert_eq!(list(&documents, None).unwrap(), vec!["aoiko-ledger.zip"]);
        let _ = fs::remove_dir_all(&documents);
    }

    #[test]
    fn frames_round_trip() {
        for body in [Vec::new(), b"body".to_vec(), vec![0xa5u8; 3 * 1024 * 1024]] {
            let framed = frame(META_FOUND, &body);
            let (meta, decoded) = split(&framed);
            assert_eq!(meta, META_FOUND);
            assert_eq!(decoded, body);
            assert_eq!(framed.len(), 4 + META_FOUND.len() + body.len());
        }
    }
}
