package net.lonshaus.aoiko.nativeplugin

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.net.Uri
import android.provider.MediaStore
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.browser.customtabs.CustomTabsIntent
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors
import org.json.JSONArray

@InvokeArg
class HttpSendArgs {
    var method: String = "GET"
    var url: String = ""
    var headers: List<List<String>> = emptyList()
    var body: List<Int> = emptyList()
}

@InvokeArg
class OpenInAppArgs {
    var url: String = ""
}

@InvokeArg
class RecognizeTextArgs {
    var imageBase64: String = ""
}

@InvokeArg
class ConfirmDiscardArgs {
    var message: String = ""
    var okLabel: String = ""
    var cancelLabel: String = ""
}

@InvokeArg
class ResolveBookmarkArgs {
    var token: String = ""
}

@InvokeArg
class BackupPathArgs {
    var token: String = ""
    var relPath: String = ""
}

@InvokeArg
class ExportOpenArgs {
    var fileName: String = ""
}

@InvokeArg
class BackupListArgs {
    var token: String = ""
    var subdir: String? = null
}

@InvokeArg
class BackupOpenArgs {
    var token: String = ""
    var relPath: String = ""
}

@InvokeArg
class BackupChunkArgs {
    var rid: Int = 0
    var b64: String = ""
}

@InvokeArg
class BackupRidArgs {
    var rid: Int = 0
}

// デスクトップの CLOSE_SCRIPT と同じ入口。呼べたかどうかを返す。
private const val REQUEST_CLOSE =
    "(function () {" +
        "if (typeof window.__aoikoRequestClose !== 'function') { return false; }" +
        "window.__aoikoRequestClose();" +
        "return true;" +
        "})()"

@TauriPlugin
class AoikoNativePlugin(private val activity: Activity) : Plugin(activity) {
    // 網路と SAF はメインスレッドで動かせない。単一スレッドで足りる（同時に何本も投げない）。
    private val network = Executors.newSingleThreadExecutor()
    private var webView: WebView? = null

    override fun load(webView: WebView) {
        this.webView = webView
        registerBackHandler(webView)
    }
    // BACK は既定だと Activity を終わらせる。そのとき発火するのは visibilitychange だけで
    // beforeunload は来ないため、未保存の入力が確認なしで消える。デスクトップの
    // 「閉じる要求」と同じ入口へ回して、破棄するかどうかを web 側に決めさせる。
    private fun registerBackHandler(webView: WebView) {
        // WryActivity は AppCompatActivity なので必ず通る。黙って諦めると、未保存の
        // 入力が確認なしで消える状態に静かに戻ってしまう。
        val owner = activity as? ComponentActivity
            ?: throw IllegalStateException("BACK を受け取れる Activity ではありません")
        owner.onBackPressedDispatcher.addCallback(
            owner,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    webView.evaluateJavascript(REQUEST_CLOSE) { handled ->
                        // init.js が未読込なら守るものが無い。素直に終わる。
                        if (handled != "true") {
                            owner.finish()
                        }
                    }
                }
            },
        )
    }
    // 送信だけを担う。宛先の検査もリダイレクトの判断も Rust 側にある。
    @Command
    fun httpSend(invoke: Invoke) {
        val args = invoke.parseArgs(HttpSendArgs::class.java)
        val headers = args.headers.mapNotNull { pair ->
            if (pair.size >= 2) pair[0] to pair[1] else null
        }
        val body = ByteArray(args.body.size) { args.body[it].toByte() }
        network.execute {
            try {
                val result = HttpSend.send(args.method, args.url, headers, body)
                val headerArray = JSONArray()
                for ((name, value) in result.headers) {
                    headerArray.put(JSONArray().put(name).put(value))
                }
                val bodyArray = JSONArray()
                for (b in result.body) {
                    bodyArray.put(b.toInt() and 0xff)
                }
                invoke.resolve(
                    JSObject()
                        .put("status", result.status)
                        .put("headers", headerArray)
                        .put("body", bodyArray),
                )
            } catch (e: Exception) {
                // 例外の文面には URL が入ることがある。Gemini は API キーを query に載せるので、
                // 種別だけを返して中身は捨てる。
                invoke.reject("通信に失敗しました: ${e.javaClass.simpleName}")
            }
        }
    }

    @Command
    fun printPage(invoke: Invoke) {
        activity.runOnUiThread {
            val webView = this.webView
            if (webView == null) {
                invoke.reject("表示中の画面が見つかりません")
                return@runOnUiThread
            }
            try {
                val manager = activity.getSystemService(Activity.PRINT_SERVICE) as PrintManager
                val adapter = webView.createPrintDocumentAdapter("aoiko")
                manager.print("aoiko", adapter, PrintAttributes.Builder().build())
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject("印刷を開始できません: ${e.javaClass.simpleName}")
            }
        }
    }
    // 外部ブラウザへ飛ばすと戻り先が保証されない。アプリ内ブラウザ なら同じ画面の上に開く。
    @Command
    fun openInApp(invoke: Invoke) {
        val args = invoke.parseArgs(OpenInAppArgs::class.java)
        activity.runOnUiThread {
            try {
                CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(args.url))
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject("開けません: ${e.javaClass.simpleName}")
            }
        }
    }
    // 同梱モデルなので端末に依らず使える。
    @Command
    fun isTextRecognitionAvailable(invoke: Invoke) {
        invoke.resolveObject(true)
    }

    // 撮影の入口を出してよいか。wry の onShowFileChooser は capture 付きでも相機を
    // 起こせなければ檔案選択へ退避するため、こちらも同じ resolveActivity で揃える。
    @Command
    fun isCameraAvailable(invoke: Invoke) {
        val pm = activity.packageManager
        val hasFeature = pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        val canTake = Intent(MediaStore.ACTION_IMAGE_CAPTURE).resolveActivity(pm) != null
        invoke.resolveObject(hasFeature && canTake)
    }

    @Command
    fun recognizeText(invoke: Invoke) {
        val args = invoke.parseArgs(RecognizeTextArgs::class.java)
        val bytes =
            try {
                Base64.decode(args.imageBase64, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                invoke.reject("base64 を解けません")
                return
            }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (bitmap == null) {
            invoke.reject("画像を読めません")
            return
        }
        TextRecognizer.recognize(
            bitmap,
            rotationDegrees = exifRotation(bytes),
            onSuccess = { json -> invoke.resolve(JSObject.fromJSONObject(json)) },
            onFailure = { message -> invoke.reject(message) },
        )
    }
    // BitmapFactory は EXIF を見ないので、相機で撮った画像は寝たまま解ける。角度を
    // 別に取り出して OS の文字認識 へ渡す（回さないと版面の行と列が入れ替わる。実機で踏んだ）。
    private fun exifRotation(bytes: ByteArray): Int =
        try {
            when (
                ExifInterface(ByteArrayInputStream(bytes))
                    .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            ) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        } catch (e: Exception) {
            // EXIF が無い・壊れている画像は珍しくない。読めないだけで認識ごと落とさない。
            0
        }

    // SAF で選ばせる。返る content:// はパスにならないので、配下の入出力も全てここで行う。
    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
        )
        startActivityForResult(invoke, intent, "pickFolderResult")
    }

    @ActivityCallback
    fun pickFolderResult(invoke: Invoke, result: androidx.activity.result.ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve()
            return
        }
        // 次回の起動でも読めるようにする。取らないと再起動で権限が消える。
        activity.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        val name = Saf.displayName(activity, uri) ?: uri.lastPathSegment ?: "backup"
        invoke.resolve(JSObject().put("token", uri.toString()).put("name", name))
    }
    // 台帳エクスポートの書き出し先。デスクトップの保存ダイアログと同じ位置付けで、
    // バックアップフォルダの外へ書ける唯一の口。取り消しは null。
    @Command
    fun exportOpen(invoke: Invoke) {
        val args = invoke.parseArgs(ExportOpenArgs::class.java)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .setType("application/octet-stream")
            .putExtra(Intent.EXTRA_TITLE, args.fileName)
            .addCategory(Intent.CATEGORY_OPENABLE)
        startActivityForResult(invoke, intent, "exportOpenResult")
    }

    @ActivityCallback
    fun exportOpenResult(invoke: Invoke, result: androidx.activity.result.ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve()
            return
        }
        io(invoke) { invoke.resolveObject(Saf.openPicked(activity, uri)) }
    }

    // 破棄が選ばれたあとの終了。シェル の window.destroy() は ある環境 の Activity を
    // 終わらせないので、こちらで畳む。webview から直に呼べる口は生やさない。
    @Command
    fun closeApp(invoke: Invoke) {
        activity.runOnUiThread {
            activity.finish()
            invoke.resolve()
        }
    }
    // 破棄の確認。webview には dialog の権限を 1 つも渡していないので、ここで出す。
    @Command
    fun confirmDiscard(invoke: Invoke) {
        val args = invoke.parseArgs(ConfirmDiscardArgs::class.java)
        activity.runOnUiThread {
            AlertDialog.Builder(activity)
                .setTitle("aoiko")
                .setMessage(args.message)
                .setPositiveButton(args.okLabel) { _, _ -> invoke.resolveObject(true) }
                .setNegativeButton(args.cancelLabel) { _, _ -> invoke.resolveObject(false) }
                // 外側を触る・BACK で閉じるのは「編集を続ける」と同じ扱い。
                .setOnCancelListener { invoke.resolveObject(false) }
                .show()
        }
    }

    @Command
    fun resolveBookmark(invoke: Invoke) {
        val args = invoke.parseArgs(ResolveBookmarkArgs::class.java)
        val uri = Uri.parse(args.token)
        // path は返せない（content:// はパスではない）。Rust 側は ある環境 のとき path を見ない。
        invoke.resolve(JSObject().put("ready", Saf.isUsable(activity, uri)))
    }

    @Command
    fun backupRead(invoke: Invoke) {
        val args = invoke.parseArgs(BackupPathArgs::class.java)
        val tree = Uri.parse(args.token)
        io(invoke) {
            val bytes = Saf.read(activity, tree, args.relPath)
            // 台帳は MB 単位になる。数値配列だと 3.5 倍に膨らむので base64 で返す。
            invoke.resolve(
                JSObject()
                    .put("found", bytes != null)
                    .put("b64", if (bytes == null) "" else Base64.encodeToString(bytes, Base64.NO_WRAP))
            )
        }
    }

    @Command
    fun backupList(invoke: Invoke) {
        val args = invoke.parseArgs(BackupListArgs::class.java)
        val tree = Uri.parse(args.token)
        io(invoke) {
            val names = JSONArray()
            for (e in Saf.list(activity, tree, args.subdir)) {
                if (!e.isDirectory) {
                    names.put(e.name)
                }
            }
            invoke.resolve(JSObject().put("names", names))
        }
    }

    @Command
    fun backupOpen(invoke: Invoke) {
        val args = invoke.parseArgs(BackupOpenArgs::class.java)
        val tree = Uri.parse(args.token)
        io(invoke) {
            invoke.resolveObject(Saf.openForWrite(activity, tree, args.relPath))
        }
    }
    // チャンクは base64 で受ける。ある環境 の IPC は生バイトを運べない。
    @Command
    fun backupWriteChunk(invoke: Invoke) {
        val args = invoke.parseArgs(BackupChunkArgs::class.java)
        io(invoke) {
            Saf.writeChunk(args.rid, Base64.decode(args.b64, Base64.DEFAULT))
            invoke.resolve()
        }
    }

    @Command
    fun backupClose(invoke: Invoke) {
        val args = invoke.parseArgs(BackupRidArgs::class.java)
        io(invoke) {
            Saf.close(args.rid)
            invoke.resolve()
        }
    }

    @Command
    fun backupRemove(invoke: Invoke) {
        val args = invoke.parseArgs(BackupPathArgs::class.java)
        val tree = Uri.parse(args.token)
        io(invoke) {
            Saf.remove(activity, tree, args.relPath)
            invoke.resolve()
        }
    }
    // 入出力はメインスレッドで動かさない。SAF は ContentProvider 越しで遅い。
    private fun io(invoke: Invoke, block: () -> Unit) {
        network.execute {
            try {
                block()
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.javaClass.simpleName)
            }
        }
    }

}
