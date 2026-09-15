package net.lonshaus.aoiko.nativeplugin

import android.util.Log
import com.google.common.util.concurrent.ListenableFuture
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerationConfig
import com.google.mlkit.genai.prompt.ModelConfig
import com.google.mlkit.genai.prompt.ModelReleaseStage
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executor

// 端末内の Gemini Nano。プロンプトを端末の外へ送れる SDK はこのモジュールへ足さない。
object GeminiNano {
    private const val TAG = "AoikoGeminiNano"
    // 結果を受け渡すだけなので、完了したスレッドでそのまま続ける。
    private val direct = Executor { it.run() }
    // 試験提供版のモデルは本番に出さない。
    private val model: GenerativeModelFutures by lazy {
        val modelConfig = ModelConfig.Builder().apply { releaseStage = ModelReleaseStage.STABLE }.build()
        GenerativeModelFutures.from(
            Generation.getClient(GenerationConfig.Builder().apply { this.modelConfig = modelConfig }.build()),
        )
    }

    fun availability(onResult: (status: Int, tokenLimit: Int?) -> Unit, onFailure: (Exception) -> Unit) {
        try {
            then(model.checkStatus(), onFailure) { status ->
                if (status != FeatureStatus.AVAILABLE) {
                    onResult(status, null)
                } else {
                    logBaseModelName()
                    then(model.getTokenLimit(), onFailure) { limit -> onResult(status, limit) }
                }
            }
        } catch (e: Exception) {
            onFailure(e)
        }
    }
    // 名前が取れなくても状態の答えは変わらないので、失敗は記録だけにする。
    private fun logBaseModelName() {
        then(model.getBaseModelName(), { e -> Log.w(TAG, "base model: ${e.javaClass.simpleName}") }) { name ->
            Log.i(TAG, "base model: $name")
        }
    }

    private fun <T> then(future: ListenableFuture<T>, onFailure: (Exception) -> Unit, onValue: (T) -> Unit) {
        future.addListener(
            {
                val value =
                    try {
                        future.get()
                    } catch (e: ExecutionException) {
                        onFailure(e.cause as? Exception ?: e)
                        return@addListener
                    } catch (e: Exception) {
                        onFailure(e)
                        return@addListener
                    }
                onValue(value)
            },
            direct,
        )
    }
}