package net.lonshaus.aoiko.nativeplugin

import android.graphics.Bitmap
import android.graphics.Rect
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject

// 他の実装と同じ形へ揃える。web 側は出どころを
// 区別しない。座標は 0..1 の正規化・左上原点・y 下向き。
object TextRecognizer {
    private class Word(
        val text: String,
        val x: Double,
        val y: Double,
        val width: Double,
        val height: Double,
        val confidence: Double?,
    ) {
        val centerY: Double
            get() = y + height / 2
    }

    fun recognize(
        bitmap: Bitmap,
        rotationDegrees: Int,
        onSuccess: (JSONObject) -> Unit,
        onFailure: (String) -> Unit,
    ) {
        val recognizer =
            TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
        val image = InputImage.fromBitmap(bitmap, rotationDegrees)
        // 座標は回した後の枠で返るので、正規化に使う縦横も入れ替える。
        val turned = rotationDegrees == 90 || rotationDegrees == 270
        val width = (if (turned) bitmap.height else bitmap.width).toDouble()
        val height = (if (turned) bitmap.width else bitmap.height).toDouble()
        recognizer
            .process(image)
            .addOnSuccessListener { text ->
                recognizer.close()
                val result = toRecognizedText(text, width, height)
                if (result.getJSONArray("lines").length() == 0) {
                    onFailure("テキストが見つかりません")
                } else {
                    onSuccess(result)
                }
            }
            .addOnFailureListener { e ->
                recognizer.close()
                onFailure("文字を認識できません: ${e.message ?: e.javaClass.simpleName}")
            }
    }
    // 認識結果の Line は見た目の塊で切れる。領収書のように品名と金額が左右へ離れていると
    // 別々の行として返り、金額が品名から切り離される（実測）。使うのは Element だけにして、
    // 行はもう一方と同じく y の中心で組み直す。
    private fun toRecognizedText(text: Text, width: Double, height: Double): JSONObject {
        val words = ArrayList<Word>()
        for (block in text.textBlocks) {
            for (line in block.lines) {
                for (element in line.elements) {
                    val box = element.boundingBox ?: continue
                    if (element.text.isEmpty()) {
                        continue
                    }
                    words.add(
                        Word(
                            element.text,
                            box.left / width,
                            box.top / height,
                            box.width() / width,
                            box.height() / height,
                            element.confidence?.toDouble(),
                        ),
                    )
                }
            }
        }
        return wordsToLines(words)
    }
    // 閾値は行の高さの半分。もう一方の wordsToLines と同じ。
    private fun wordsToLines(words: List<Word>): JSONObject {
        val sorted = words.sortedBy { it.centerY }
        val rows = ArrayList<ArrayList<Word>>()
        for (w in sorted) {
            val head = rows.lastOrNull()?.firstOrNull()
            if (head != null && Math.abs(head.centerY - w.centerY) <= maxOf(head.height, w.height) / 2) {
                rows.last().add(w)
                continue
            }
            rows.add(arrayListOf(w))
        }
        val lines = JSONArray()
        val whole = StringBuilder()
        for (row in rows) {
            val ordered = row.sortedBy { it.x }
            val text = ordered.joinToString(" ") { it.text }
            if (text.isEmpty()) {
                continue
            }
            var left = ordered[0].x
            var top = ordered[0].y
            var right = ordered[0].x + ordered[0].width
            var bottom = ordered[0].y + ordered[0].height
            val wordArray = JSONArray()
            for (w in ordered) {
                left = minOf(left, w.x)
                top = minOf(top, w.y)
                right = maxOf(right, w.x + w.width)
                bottom = maxOf(bottom, w.y + w.height)
                wordArray.put(word(w))
            }
            lines.put(
                JSONObject()
                    .put("text", text)
                    .put("words", wordArray)
                    .put("x", left)
                    .put("y", top)
                    .put("width", right - left)
                    .put("height", bottom - top),
            )
            if (whole.isNotEmpty()) {
                whole.append('\n')
            }
            whole.append(text)
        }
        return JSONObject().put("lines", lines).put("text", whole.toString())
    }
    // ここの認識に候補の第 2 案は無い。alternates は空で返す（持つ実装もある）。
    private fun word(w: Word): JSONObject {
        val out =
            JSONObject()
                .put("text", w.text)
                .put("x", w.x)
                .put("y", w.y)
                .put("width", w.width)
                .put("height", w.height)
                .put("alternates", JSONArray())
        if (w.confidence != null) {
            out.put("confidence", w.confidence)
        }
        return out
    }
}
