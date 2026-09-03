package net.lonshaus.aoiko.nativeplugin

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

// この環境には Rust から借りられる system TLS が無い。ここは OS の TLS を使うためだけに在り、
// 宛先の検査もリダイレクトの判断も Rust 側に残してある。
object HttpSend {
    private const val CONNECT_TIMEOUT_MS = 30_000
    private const val READ_TIMEOUT_MS = 120_000

    class Result(
        val status: Int,
        val headers: List<Pair<String, String>>,
        val body: ByteArray,
    )

    fun send(
        method: String,
        url: String,
        headers: List<Pair<String, String>>,
        body: ByteArray,
    ): Result {
        val connection = URL(url).openConnection()
        // http は localhost だけが Rust 側の allowlist を通る。どちらの型も来る。
        if (connection !is HttpURLConnection) {
            throw IllegalStateException("この URL は扱えません")
        }
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        // リダイレクトを追わせない。1 跳ごとに Rust 側の allowlist へ掛ける必要がある。
        connection.instanceFollowRedirects = false
        connection.requestMethod = method
        for ((name, value) in headers) {
            connection.setRequestProperty(name, value)
        }
        if (body.isNotEmpty()) {
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
        }
        try {
            val status = connection.responseCode
            // 4xx / 5xx は errorStream に本文が入る。取り違えると API のエラー内容が消える。
            val stream: InputStream? =
                if (status >= HttpURLConnection.HTTP_BAD_REQUEST) {
                    connection.errorStream
                } else {
                    connection.inputStream
                }
            val out = ByteArrayOutputStream()
            stream?.use { it.copyTo(out) }
            return Result(status, collectHeaders(connection), out.toByteArray())
        } finally {
            connection.disconnect()
        }
    }
    // 値が ASCII に収まらないヘッダーは落とす。他の平台では Rust の HeaderValue::to_str が
    // 同じことをしており、JS の Headers に載せられるものを揃える。
    private fun collectHeaders(connection: HttpURLConnection): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()
        for ((name, values) in connection.headerFields) {
            // ステータス行は名前が null で入ってくる。ヘッダーではない。
            if (name == null) {
                continue
            }
            for (value in values) {
                if (value != null && isAscii(value)) {
                    out.add(name.lowercase() to value)
                }
            }
        }
        return out
    }

    private fun isAscii(value: String): Boolean {
        for (c in value) {
            if (c.code > 0x7f) {
                return false
            }
        }
        return true
    }
}
