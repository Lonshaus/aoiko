// JS から渡されるパス引数の検査。ここが本物の信頼境界になる。
//
// init.js はページと同じ realm で走り、__TAURI_INTERNALS__.invoke は無条件で注入される
// ため、web 側や init.js 側の検査はすべて迂回できる。バックアップフォルダの外へ出られる
// かどうかは、この関数群だけで決まる。
//
// 方針は「正規化しない、拒否する」。受け取った文字列を綺麗にして通すのではなく、
// 少しでも解釈の余地があれば弾く。
use std::path::{Component, Path, PathBuf};

use crate::{Error, Result};

fn invalid(what: &str) -> Error {
    Error::InvalidPath(what.to_string())
}
/// 開いてよいと確かめ終えた書き出し先。ファイル登録簿へ渡せるのはこの型だけにする。
///
/// 中身は private なので、この型を作れるのは path.rs の中の 2 つだけになる。
/// resolve_within（バックアップフォルダ配下だと確かめたもの）と、from_os_chosen
/// （OS の保存ダイアログや Documents から来た、そもそも IPC を通っていないもの）。
///
/// クレート内から意図的に破ること（JS 由来の文字列を from_os_chosen へ流し込むこと）を
/// Rust は止められない。この型が担保するのはそこではなく、素の PathBuf を登録簿へ渡す
/// 書き方はコンパイルが通らない＝うっかりでは迂回できないことと、意図した迂回は必ず
/// from_os_chosen という名前で書かれる＝grep 1 回で全部見つかることの 2 つ。
pub(crate) struct SafeTarget(PathBuf);

impl SafeTarget {
    /// 検査を掛けずに信頼する唯一の入口。バックアップフォルダの外を指してよい。
    ///
    /// 台帳の書き出し先はフォルダの外が正しいので、配下という条件を掛けると機能そのものが
    /// 成り立たない。前提は「IPC を通ってきた文字列をここへ渡さないこと」ただ 1 つ。
    pub(crate) fn from_os_chosen(path: PathBuf) -> Self {
        Self(path)
    }

    pub(crate) fn as_path(&self) -> &Path {
        &self.0
    }
}
// セグメント 1 つ分の検査。区切り文字を含まないこと、上位を指さないこと。
fn check_segment(segment: &str) -> Result<()> {
    if segment.is_empty() {
        return Err(invalid("空のセグメントがあります"));
    }
    if segment == "." || segment == ".." {
        return Err(invalid("'.' と '..' は使えません"));
    }
    if segment.contains('\\') {
        return Err(invalid("逆スラッシュは使えません"));
    }
    if segment.chars().any(|c| (c as u32) < 0x20) {
        return Err(invalid("制御文字は使えません"));
    }
    // "C:" や "C:foo"。Windows ではドライブ相対パスとして解釈され得る。
    let bytes = segment.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && (bytes[0] as char).is_ascii_alphabetic() {
        return Err(invalid("ドライブ指定は使えません"));
    }
    Ok(())
}
/// バックアップフォルダ基準の相対パスを検査し、セグメントへ分解する。
pub(crate) fn validate_rel_path(rel: &str) -> Result<Vec<&str>> {
    if rel.is_empty() {
        return Err(invalid("パスが空です"));
    }
    let segments: Vec<&str> = rel.split('/').collect();
    for segment in &segments {
        check_segment(segment)?;
    }
    Ok(segments)
}
/// 書き出し先のファイル名など、階層を持てない引数の検査。
pub(crate) fn validate_single_segment(name: &str) -> Result<&str> {
    if name.contains('/') {
        return Err(invalid("ファイル名にディレクトリを含められません"));
    }
    check_segment(name)?;
    Ok(name)
}
/// base 配下の実パスへ解決する。base の外へ出る結果になるなら拒否する。
///
/// 検査を通ったセグメントだけを繋ぐので '..' で登ることは起きないが、フォルダの中に
/// 外を指すシンボリックリンクを置かれる経路が残る。実在する最深の祖先を canonicalize
/// して base 配下に留まっていることを確かめる。書き込み先はまだ存在しないため、
/// 対象そのものを canonicalize できるとは限らない。
pub(crate) fn resolve_within(base: &Path, rel: &str) -> Result<SafeTarget> {
    let segments = validate_rel_path(rel)?;
    let base_real = base
        .canonicalize()
        .map_err(|e| invalid(&format!("バックアップフォルダを解決できません: {e}")))?;
    let mut joined = base_real.clone();
    for segment in segments {
        joined.push(segment);
    }
    // canonicalize は存在しないパスで失敗するので、実在するところまで遡る。
    let mut probe: &Path = joined.as_path();
    let existing = loop {
        if let Ok(real) = probe.canonicalize() {
            break real;
        }
        match probe.parent() {
            Some(parent) => probe = parent,
            None => {
                return Err(invalid("パスを解決できません"));
            }
        }
    };
    if !existing.starts_with(&base_real) {
        return Err(invalid("バックアップフォルダの外を指しています"));
    }
    // 念のため。検査済みセグメントしか繋いでいないので通常は起きない。
    if joined
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(invalid("パスが上位を指しています"));
    }
    Ok(SafeTarget(joined))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aoiko-path-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_traversal_and_separators() {
        for bad in [
            "",
            "/a",
            "a/",
            "a//b",
            ".",
            "..",
            "a/../../etc/passwd",
            "../attachments/x",
            "snapshots/..",
            "a\\b",
            "C:",
            "C:foo",
            "a\u{0}b",
            "a\tb",
            "a\nb",
        ] {
            assert!(validate_rel_path(bad).is_err(), "通ってはいけない: {bad:?}");
        }
    }

    #[test]
    fn accepts_the_shapes_the_backup_format_uses() {
        assert_eq!(validate_rel_path("a.zip").unwrap(), vec!["a.zip"]);
        assert_eq!(
            validate_rel_path("snapshots/2026-08-09T120000Z.json").unwrap(),
            vec!["snapshots", "2026-08-09T120000Z.json"]
        );
        assert_eq!(
            validate_rel_path(&format!("attachments/{}", "a".repeat(64)))
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn single_segment_rejects_any_hierarchy() {
        assert!(validate_single_segment("aoiko-ledger.zip").is_ok());
        for bad in ["../x", "a/b", "", "..", "a\\b", "C:x"] {
            assert!(
                validate_single_segment(bad).is_err(),
                "通ってはいけない: {bad:?}"
            );
        }
    }

    #[test]
    fn resolves_nested_paths_under_the_base() {
        let base = temp_dir("nested");
        fs::create_dir_all(base.join("snapshots")).unwrap();
        let resolved = resolve_within(&base, "snapshots/x.json").unwrap();
        assert!(resolved.as_path().starts_with(base.canonicalize().unwrap()));
        assert!(resolved.as_path().ends_with("snapshots/x.json"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn resolves_targets_that_do_not_exist_yet() {
        // 書き込みは常にこの形。対象も途中のディレクトリもまだ無い。
        let base = temp_dir("absent");
        assert!(resolve_within(&base, "attachments/deadbeef").is_ok());
        let _ = fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_escape_through_a_symlink_inside_the_base() {
        let base = temp_dir("symlink");
        let outside = temp_dir("symlink-outside");
        fs::write(outside.join("secret.txt"), b"x").unwrap();
        std::os::unix::fs::symlink(&outside, base.join("escape")).unwrap();

        let err = resolve_within(&base, "escape/secret.txt");
        assert!(
            err.is_err(),
            "シンボリックリンク経由で外へ出られてはいけない"
        );

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn the_registry_target_has_exactly_two_doors() {
        let base = temp_dir("safe-target");
        // 片方は配下だと確かめる入口。上へ登る形はここで落ちる。
        assert!(resolve_within(&base, "../escape.zip").is_err());
        assert!(resolve_within(&base, "a.zip").is_ok());
        // もう片方は名前で分かる from_os_chosen だけ。SafeTarget の中身は private なので、
        // path.rs の外で素の PathBuf から SafeTarget を作る書き方は他に無い（コンパイルが通らない）。
        let outside = PathBuf::from("/tmp/aoiko-os-chosen.zip");
        assert_eq!(
            SafeTarget::from_os_chosen(outside.clone()).as_path(),
            outside
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rejects_when_the_base_itself_is_gone() {
        let base = temp_dir("gone");
        fs::remove_dir_all(&base).unwrap();
        assert!(resolve_within(&base, "a.zip").is_err());
    }
}
