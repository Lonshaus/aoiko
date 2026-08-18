fn main() {
    // tauri-plugin-iap の macOS 実装は Swift で書かれている。Swift の並行実行ランタイムは
    // dyld shared cache に在り、/usr/lib/swift を rpath に持たないと解決できない。
    // .app にすると Xcode が同じ rpath を入れるので気付かないが、cargo test が作る裸の
    // 実行ファイルは起動時点で dyld に落とされる。
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    tauri_build::build()
}
