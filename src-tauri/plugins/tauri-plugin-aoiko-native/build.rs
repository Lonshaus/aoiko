use std::{env, process::Command};

const COMMANDS: &[&str] = &[
    "pick_folder",
    "resolve_folder",
    "print_page",
    "open_in_app",
    "confirm_discard",
    "backup_open",
    "backup_write_chunk",
    "backup_close",
    "backup_read",
    "backup_list",
    "backup_remove",
    "export_open",
    "recognize_text",
    "is_text_recognition_available",
    "apple_ai_availability",
    "apple_ai_extract",
    "apple_ai_run",
];
// この Swift ファイルは iOS 側では SwiftPM（ios/Package.swift）がビルドする。
// macOS にはその仕組みが無く、ここで静的ライブラリへ手動でコンパイルする。
const APPLE_INTELLIGENCE_SWIFT: &str = "ios/Sources/AoikoNativePlugin/AppleIntelligence.swift";

fn main() {
    // build.rs は host 向けに構築されるため cfg!(target_os) は host を指す。
    // 目的の環境は環境変数でしか分からない（desktop.rs 冒頭のコメントと同じ理由）。
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_apple_intelligence_lib();
    }
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
// FoundationModels は -weak_framework でしかリンクできない（-framework だと macOS 13 で
// 起動に失敗する）。ただし依存 crate の build.rs が出す cargo:rustc-link-arg は最終バイナリの
// リンク行に届かない（rustc-link-lib / rustc-link-search しか伝播しない）ため、
// -weak_framework 自体はここではなく src-tauri/build.rs から出す。ここは静的ライブラリを
// 作って cargo に見つけさせるところまでを担う。
fn build_apple_intelligence_lib() {
    println!("cargo:rerun-if-changed={APPLE_INTELLIGENCE_SWIFT}");
    let out_dir = env::var("OUT_DIR").expect("OUT_DIR");
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => panic!("未対応の target arch: {other:?}"),
    };
    // tauri.conf.json の macOS.minimumSystemVersion と揃える。
    let target = format!("{arch}-apple-macos13.3");
    let sdk_path = xcrun_output(&["--sdk", "macosx", "--show-sdk-path"]);
    let lib_name = "aoiko_apple_intelligence";
    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-emit-library",
            "-static",
            "-parse-as-library",
            "-target",
            &target,
            "-sdk",
            &sdk_path,
            "-module-name",
            lib_name,
            "-o",
        ])
        .arg(format!("{out_dir}/lib{lib_name}.a"))
        .arg(APPLE_INTELLIGENCE_SWIFT)
        .status()
        .expect("swiftc を起動できません");
    assert!(
        status.success(),
        "AppleIntelligence.swift のビルドに失敗しました"
    );
    println!("cargo:rustc-link-lib=static={lib_name}");
    println!("cargo:rustc-link-search=native={out_dir}");
}

fn xcrun_output(args: &[&str]) -> String {
    let output = Command::new("xcrun")
        .args(args)
        .output()
        .expect("xcrun を起動できません");
    assert!(output.status.success(), "xcrun {args:?} に失敗しました");
    String::from_utf8(output.stdout)
        .expect("xcrun の出力が UTF-8 ではありません")
        .trim()
        .to_string()
}
