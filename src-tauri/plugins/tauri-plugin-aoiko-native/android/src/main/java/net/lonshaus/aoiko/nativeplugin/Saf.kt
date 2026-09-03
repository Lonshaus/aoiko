package net.lonshaus.aoiko.nativeplugin

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import java.io.ByteArrayOutputStream

// SAF は content:// しか返さず、ファイルパスにならない。Rust 側の入出力はパス前提なので、
// この環境のバックアップ入出力はここで完結させる。
object Saf {
    class Entry(val name: String, val isDirectory: Boolean)

    fun displayName(context: Context, tree: Uri): String? {
        val docId = DocumentsContract.getTreeDocumentId(tree)
        val doc = DocumentsContract.buildDocumentUriUsingTree(tree, docId)
        context.contentResolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)
            ?.use { c -> if (c.moveToFirst()) return c.getString(0) }
        return null
    }
    // 記録した権限が生きているか。フォルダごと消えている・取り消されていることがある。
    fun isUsable(context: Context, tree: Uri): Boolean {
        val held = context.contentResolver.persistedUriPermissions.any {
            it.uri == tree && it.isReadPermission && it.isWritePermission
        }
        if (!held) {
            return false
        }
        return try {
            val docId = DocumentsContract.getTreeDocumentId(tree)
            val doc = DocumentsContract.buildDocumentUriUsingTree(tree, docId)
            context.contentResolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)
                ?.use { it.moveToFirst() } ?: false
        } catch (e: Exception) {
            false
        }
    }
    // 相対パスを 1 段ずつ辿る。無ければ作る（write のときだけ）。
    private fun resolve(
        resolver: ContentResolver,
        tree: Uri,
        segments: List<String>,
        createDirs: Boolean,
    ): Uri? {
        var current = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        for (segment in segments) {
            val found = findChild(resolver, tree, current, segment)
            current = when {
                found != null -> found
                createDirs ->
                    DocumentsContract.createDocument(
                        resolver, current, DocumentsContract.Document.MIME_TYPE_DIR, segment,
                    ) ?: return null
                else -> return null
            }
        }
        return current
    }

    private fun findChild(resolver: ContentResolver, tree: Uri, parent: Uri, name: String): Uri? {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(
            tree, DocumentsContract.getDocumentId(parent),
        )
        resolver.query(
            children,
            arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME),
            null, null, null,
        )?.use { c ->
            while (c.moveToNext()) {
                if (c.getString(1) == name) {
                    return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0))
                }
            }
        }
        return null
    }
    // 書き込み途中のファイル。Rust 側の OpenFiles と同じ役目で、上限も同じ 8 本。
    private val open = HashMap<Int, java.io.OutputStream>()
    private var nextRid = 1

    fun openForWrite(context: Context, tree: Uri, relPath: String): Int {
        synchronized(open) {
            if (open.size >= 8) {
                throw IllegalStateException("同時に開けるファイルの上限を超えました")
            }
            val stream = createStream(context, tree, relPath)
            val rid = nextRid++
            open[rid] = stream
            return rid
        }
    }

    // 保存ダイアログが返した書き出し先。backup と同じ登記簿に入れるので、rid の扱いは
    // 呼び出し側から見て 1 種類で済む。
    fun openPicked(context: Context, target: Uri): Int {
        synchronized(open) {
            if (open.size >= 8) {
                throw IllegalStateException("同時に開けるファイルの上限を超えました")
            }
            val stream = context.contentResolver.openOutputStream(target, "wt")
                ?: throw IllegalStateException("書き込めません")
            val rid = nextRid++
            open[rid] = stream
            return rid
        }
    }

    fun writeChunk(rid: Int, bytes: ByteArray) {
        val stream = synchronized(open) { open[rid] } ?: throw IllegalStateException("対象のファイルは開かれていません")
        stream.write(bytes)
    }

    // 閉じたあとの close を黙って通すと、途中で切れた台帳が完成扱いになる。
    fun close(rid: Int) {
        val stream = synchronized(open) { open.remove(rid) }
            ?: throw IllegalStateException("対象のファイルは開かれていません")
        // flush が投げても close はする。登記簿からは既に外してあるので、ここで漏らすと
        // ストリームを閉じる手段が無くなる。
        stream.use { it.flush() }
    }
    // 中身を丸ごと置き換える。既存があれば消してから作る（truncate 相当）。
    private fun createStream(context: Context, tree: Uri, relPath: String): java.io.OutputStream {
        val segments = relPath.split('/').filter { it.isNotEmpty() }
        if (segments.isEmpty()) {
            throw IllegalArgumentException("パスが空です")
        }
        val resolver = context.contentResolver
        val dir = resolve(resolver, tree, segments.dropLast(1), true)
            ?: throw IllegalStateException("フォルダを作れません")
        val name = segments.last()
        findChild(resolver, tree, dir, name)?.let { DocumentsContract.deleteDocument(resolver, it) }
        val file = DocumentsContract.createDocument(resolver, dir, "application/octet-stream", name)
            ?: throw IllegalStateException("ファイルを作れません")
        return resolver.openOutputStream(file, "wt") ?: throw IllegalStateException("書き込めません")
    }

    // 見つからないのは正常な分岐（まだ同期していない）。null で返し、エラーにしない。
    fun read(context: Context, tree: Uri, relPath: String): ByteArray? {
        val segments = relPath.split('/').filter { it.isNotEmpty() }
        val resolver = context.contentResolver
        val file = resolve(resolver, tree, segments, false) ?: return null
        val out = ByteArrayOutputStream()
        resolver.openInputStream(file)?.use { it.copyTo(out) }
            ?: throw IllegalStateException("読み込めません")
        return out.toByteArray()
    }

    fun list(context: Context, tree: Uri, subdir: String?): List<Entry> {
        val segments = (subdir ?: "").split('/').filter { it.isNotEmpty() }
        val resolver = context.contentResolver
        val dir = resolve(resolver, tree, segments, false) ?: return emptyList()
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(
            tree, DocumentsContract.getDocumentId(dir),
        )
        val out = ArrayList<Entry>()
        resolver.query(
            children,
            arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE),
            null, null, null,
        )?.use { c ->
            while (c.moveToNext()) {
                out.add(Entry(c.getString(0), c.getString(1) == DocumentsContract.Document.MIME_TYPE_DIR))
            }
        }
        return out
    }
    // フォルダは消さない。存在しないファイルも黙って通さない。どちらもデスクトップと同じ約束。
    fun remove(context: Context, tree: Uri, relPath: String) {
        val segments = relPath.split('/').filter { it.isNotEmpty() }
        val resolver = context.contentResolver
        val file = resolve(resolver, tree, segments, false)
            ?: throw IllegalStateException("ファイルが見つかりません")
        val mime = resolver.query(file, arrayOf(DocumentsContract.Document.COLUMN_MIME_TYPE), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null }
        if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
            throw IllegalArgumentException("フォルダは消せません")
        }
        // deleteDocument は失敗を false で返す。戻り値を捨てると消えていないのに成功になる。
        if (!DocumentsContract.deleteDocument(resolver, file)) {
            throw IllegalStateException("削除できません")
        }
    }
}
