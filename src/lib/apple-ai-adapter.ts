// OS 内蔵の AI（FoundationModels）を LlmAdapter として橋渡しする。
// generateJson（プロンプト経由）は使わせない：指示を上書きできる口を作らないための拒否で、
// これは制約であって不備ではない。runDataTask だけがデータを渡し、指示は環境側に固定で
// 埋め込まれている（AppleIntelligence.swift の classifyInstructions / orderInstructions）。
import { LlmError, type LlmAdapter, type LlmDataTask, type LlmImageInput } from '../domain/llm';
import { nativeBridge } from './native-bridge';
import { m } from '../paraglide/messages';

const TASK_CODES: Record<LlmDataTask, number> = {
  classify: 1,
  order: 2,
};

const RUN_ERROR_MESSAGES: Record<number, () => string> = {
  1: m.error_apple_ai_run_1,
  2: m.error_apple_ai_run_2,
  3: m.error_apple_ai_run_3,
  4: m.error_apple_ai_run_4,
  5: m.error_apple_ai_run_5,
  6: m.error_apple_ai_run_6,
  7: m.error_apple_ai_run_7,
};
// invoke の拒否は 2 通りの形で来る：ネイティブ側の数値コードなら承知の失敗（モデルの限界・
// OS が古い等）。文字列（権限不足・未知コマンド）はこちら側の配線ミスで、
// 「その他の失敗」に丸めるとモデルの不調に見えてしまうため区別する。
function describeRunFailure(code: unknown): string {
  if (typeof code === 'number') {
    return RUN_ERROR_MESSAGES[code]?.() ?? m.error_apple_ai_run_3();
  }
  return m.error_apple_ai_run_misconfigured({ detail: String(code) });
}

export class AppleAiAdapter implements LlmAdapter {
  readonly external = false;
  readonly destinationHost = '';

  async generateJson(_prompt: string, _image?: LlmImageInput): Promise<unknown> {
    throw new LlmError(m.error_apple_ai_prompt_unsupported());
  }

  async runDataTask(task: LlmDataTask, data: unknown): Promise<unknown> {
    const run = nativeBridge()?.appleAiRun;
    if (typeof run !== 'function') {
      throw new LlmError(m.error_apple_ai_run_4());
    }
    let raw: string;
    try {
      raw = await run(TASK_CODES[task], JSON.stringify(data));
    } catch (code) {
      throw new LlmError(describeRunFailure(code));
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new LlmError(m.error_llm_response_not_json({ text: raw.slice(0, 200) }), e);
    }
  }
}
