# Modifications to tao 0.35.3

This directory contains tao 0.35.3 (Apache-2.0, Copyright 2014-2021 The winit contributors, Copyright 2021-2025 Tauri Programme within The Commons Conservancy) with the changes listed below, made by Lonshaus for aoiko on 2026-10-05. The original license is kept in `LICENSE`. Files not listed here are unchanged, except that `.cargo-ok`, `.cargo_vcs_info.json`, `Cargo.toml.orig`, `Cargo.lock` and `examples/` were left out and `rustfmt.toml` and this file were added.

## `src/platform_impl/ios/view.rs`

- `configuration_for_connecting_scene_session` returned a pointer to a `Retained` value that is dropped on return (use-after-free, tauri-apps/tao#1340). It now returns the configuration with `Retained::autorelease_ptr`, following tauri-apps/tao#1245.
- `application:configurationForConnectingSceneSession:options:` is now always registered on the application delegate. It used to be registered only when `multiple_scenes_enabled()` returned true.

## `src/platform_impl/ios/scene.rs`

- `multiple_scenes_enabled()` now returns true when the app's Info.plist declares `UIApplicationSceneManifest`, instead of reading `UIApplicationSupportsMultipleScenes`. This makes the app adopt the UIScene lifecycle, which iOS 27 requires. The now unused imports (`Retained`, `NSDictionary`, `NSNumber`) were removed.