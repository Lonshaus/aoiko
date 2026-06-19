// LLM API クライアント。
// BYOK モデル：API キーはユーザーが Settings 画面で自分のものを入れる。
// aoiko はキーを使用者のブラウザ内のみで保持し、Google の API エンドポイントに直接送る。
// サーバーサイドの中継なし。

export interface LlmImageInput {
  /** Base64 エンコードされた画像データ（data URL の prefix なし） */
  base64: string;
  /** image/jpeg / image/png / image/webp 等 */
  mimeType: string;
}

export interface LlmAdapter {
  /** 端末外へデータを送るか（クラウド = true、ローカル = false） */
  readonly external: boolean;
  /** 送信先ホスト（確認ダイアログ表示用。例：generativelanguage.googleapis.com） */
  readonly destinationHost: string;
  /** プロンプトを送り、JSON 文字列としてパース可能なレスポンスを返す */
  generateJson(prompt: string, image?: LlmImageInput): Promise<unknown>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
// Google Gemini API アダプター（無料枠あり、レイテンシ・コストともに低い）。
// 2026 時点で gemini-2.5-flash 推奨。設定で他モデルも可能。
export class GeminiAdapter implements LlmAdapter {
  readonly external = true;
  readonly destinationHost = 'generativelanguage.googleapis.com';
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'gemini-2.5-flash'
  ) {}

  async generateJson(prompt: string, image?: LlmImageInput): Promise<unknown> {
    if (!this.apiKey) {
      throw new LlmError('Gemini API キーが設定されていません');
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [{ text: prompt }];
    if (image) {
      parts.push({
        inlineData: { mimeType: image.mimeType, data: image.base64 },
      });
    }
    const body = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new LlmError('Gemini API への接続に失敗しました', e);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new LlmError(
        `Gemini API エラー ${response.status}: ${errText.slice(0, 200)}`
      );
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new LlmError('Gemini レスポンスに想定外の構造');
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new LlmError(`Gemini レスポンスを JSON として解析できません: ${text.slice(0, 200)}`, e);
    }
  }
}

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, '').toLowerCase();
  return LOCAL_HOSTS.has(name) || name.endsWith('.local');
}
// ローカル LLM が ```json フェンス等で囲って返すケースに耐性を持たせて JSON 抽出
function parseLooseJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced
      ? fenced[1]!.trim()
      : t.slice(t.search(/[[{]/), t.lastIndexOf('}') + 1 || undefined);
    return JSON.parse(candidate);
  }
}
// OpenAI 互換 Chat Completions アダプター。
// Ollama / LM Studio / llama.cpp server / vLLM / OpenAI 等を 1 つで包括。
// baseUrl 例：http://localhost:11434/v1（末尾 /chat/completions・/models を付与）。
// localhost 宛は external=false（送信前確認スキップ）。OCR には vision モデル必須。
export class OpenAICompatibleAdapter implements LlmAdapter {
  readonly external: boolean;
  readonly destinationHost: string;
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly model: string,
    private readonly apiKey: string = ''
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.destinationHost = hostOf(this.base);
    this.external = !isLocalHost(this.destinationHost);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) {
      h.authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async generateJson(prompt: string, image?: LlmImageInput): Promise<unknown> {
    if (!this.model) {
      throw new LlmError('モデルが選択されていません');
    }
    const content: unknown = image
      ? [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${image.mimeType};base64,${image.base64}`,
            },
          },
        ]
      : prompt;
    const body = {
      model: this.model,
      messages: [{ role: 'user', content }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    };

    let response: Response;
    try {
      response = await fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new LlmError(
        `${this.destinationHost} への接続に失敗しました（ローカル LLM サーバ起動・CORS 設定を確認）`,
        e
      );
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new LlmError(
        `LLM API エラー ${response.status}: ${errText.slice(0, 200)}`
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content;
    if (!text) {
      throw new LlmError('LLM レスポンスに想定外の構造');
    }
    try {
      return parseLooseJson(text);
    } catch (e) {
      throw new LlmError(
        `LLM レスポンスを JSON として解析できません: ${text.slice(0, 200)}`,
        e
      );
    }
  }
}
// OpenAI 互換 /models からインストール済モデル ID 一覧を取得（Page Assist 方式）
export async function listOpenAiModels(
  baseUrl: string,
  apiKey: string = ''
): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  let response: Response;
  try {
    response = await fetch(`${base}/models`, { headers });
  } catch (e) {
    throw new LlmError(
      `${hostOf(base)} への接続に失敗しました（サーバ起動・CORS を確認）`,
      e
    );
  }
  if (!response.ok) {
    throw new LlmError(`モデル一覧取得エラー ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };
  return (payload.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();
}