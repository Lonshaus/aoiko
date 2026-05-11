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