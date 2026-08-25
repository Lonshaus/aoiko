package net.lonshaus.aoiko.nativeplugin

import android.app.Activity
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin

// 指令の実装はまだ入っていない。Rust 側（android.rs）も register_android_plugin を呼ばず、
// 全て未対応として返している。骨組みだけ先に置くのは、ビルドツール が子プロジェクトを
// 解決できないと APK そのものが組めないため。
@TauriPlugin
class AoikoNativePlugin(private val activity: Activity) : Plugin(activity)
