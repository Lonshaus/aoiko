use std::{env, fs, io::BufReader, path::Path};
// 題名欄のアイコンは実行時に差し替えるため、PNG ではなく展開済みの RGBA が要る
// （tauri の image-png feature を足すと出荷物へ画像デコーダが 4 crate 増える）。
// 絵は repo へ PNG で置き、ここで展開して OUT_DIR へ出す。手で作った .rgba を
// 併置すると、絵を直したときに黙って古いままになる。
const TITLEBAR_ICONS: [&str; 2] = ["titlebar-light", "titlebar-dark"];

fn main() {
    // build.rs は host 向けに構築されるため cfg!(target_os) は host を指す。
    // 目的の環境は環境変数でしか分からない。
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        expand_titlebar_icons();
    }
    tauri_build::build()
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
        assert_eq!(info.color_type, png::ColorType::Rgba, "{src} は RGBA ではない");
        buffer.truncate(info.buffer_size());
        fs::write(Path::new(&out).join(format!("{name}.rgba")), &buffer).expect("書き出し");
    }
}
