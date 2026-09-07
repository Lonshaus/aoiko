use std::{env, fs, io::BufReader, path::Path};
// 題名欄のアイコンは実行時に差し替えるため、PNG ではなく展開済みの RGBA が要る
// （tauri の image-png feature を足すと出荷物へ画像デコーダが 4 crate 増える）。
// 絵は repo へ PNG で置き、ここで展開して OUT_DIR へ出す。手で作った .rgba を
// 併置すると、絵を直したときに黙って古いままになる。
const TITLEBAR_ICONS: [&str; 2] = ["titlebar-light", "titlebar-dark"];

fn main() {
    // build.rs は host 向けに構築されるため cfg!(target_os) は host を指す。
    // 目的の環境は環境変数でしか分からない。
    let target_os = env::var("CARGO_CFG_TARGET_OS");
    if target_os.as_deref() == Ok("windows") {
        expand_titlebar_icons();
    }
    if matches!(target_os.as_deref(), Ok("macos") | Ok("ios")) {
        link_foundation_models_weak();
    }
    tauri_build::build()
}
// FoundationModels は macOS 26 / iOS 26 未満では存在しないフレームワークなので、
// 通常の -framework だと古い OS で起動できない（未解決シンボルで即クラッシュ）。
// -weak_framework にすると実行時まで解決を遅らせられる。
// 依存 crate（tauri-plugin-aoiko-native）の build.rs から cargo:rustc-link-arg を出しても
// 最終バイナリのリンク行には届かない（rustc-link-lib / rustc-link-search しか伝播しない）ため、
// この最終クレートの build.rs からでしか出せない。
fn link_foundation_models_weak() {
    println!("cargo:rustc-link-arg=-weak_framework");
    println!("cargo:rustc-link-arg=FoundationModels");
}

fn expand_titlebar_icons() {
    let out = env::var("OUT_DIR").expect("OUT_DIR");
    for name in TITLEBAR_ICONS {
        let src = format!("icons/{name}.png");
        println!("cargo:rerun-if-changed={src}");
        let decoder = png::Decoder::new(BufReader::new(fs::File::open(&src).expect(&src)));
        let mut reader = decoder.read_info().expect("PNG ヘッダ");
        let mut buffer = vec![0; reader.output_buffer_size().expect("PNG の大きさ")];
        let info = reader.next_frame(&mut buffer).expect("PNG 本体");
        assert_eq!(
            info.color_type,
            png::ColorType::Rgba,
            "{src} は RGBA ではない"
        );
        buffer.truncate(info.buffer_size());
        fs::write(Path::new(&out).join(format!("{name}.rgba")), &buffer).expect("書き出し");
    }
}