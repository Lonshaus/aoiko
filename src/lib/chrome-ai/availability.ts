// ブラウザ内蔵 AI（LanguageModel）が使えるかを問う。web の産物にだけ入る。
//
// LanguageModel が在ることは端末内で推論することの保証にならない。仕様は雲を使う実装を
// 認めており、同じ名前で文字だけのモデルを載せている環境もある。この app が要る画像入力まで
// 含めて問い、通らなければ「使えない」に倒す。
export type ChromeAiAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

type SessionOptions = {
  expectedInputs: { type: string }[];
};

export type ChromeAiSession = {
  contextWindow: number;
  measureContextUsage(input: unknown): Promise<number>;
  prompt(input: unknown, options?: { responseConstraint?: unknown }): Promise<string>;
  destroy(): void;
};

type LanguageModelLike = {
  availability(options?: SessionOptions): Promise<string>;
  create(options?: SessionOptions): Promise<ChromeAiSession>;
};

// この app が要る入力の形。画像を受けない実装は領収書の経路が成り立たないので外す。
const EXPECTED_INPUTS: SessionOptions = { expectedInputs: [{ type: 'text' }, { type: 'image' }] };

export function languageModel(): LanguageModelLike | undefined {
  const candidate = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  // 実際の Chrome では class（typeof は 'function'）。object だけを見ると常に見付からない。
  if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
    return undefined;
  }
  const lm = candidate as Partial<LanguageModelLike>;
  return typeof lm.availability === 'function' && typeof lm.create === 'function'
    ? (lm as LanguageModelLike)
    : undefined;
}

export async function chromeAiAvailability(): Promise<ChromeAiAvailability> {
  const lm = languageModel();
  if (!lm) {
    return 'unavailable';
  }
  try {
    const state = await lm.availability(EXPECTED_INPUTS);
    return state === 'available' || state === 'downloadable' || state === 'downloading'
      ? state
      : 'unavailable';
  } catch {
    // 問うこと自体が投げる環境がある（古い実装・権限方針で塞がれている等）。
    // 例外を上へ出すと設定画面の初期化ごと落ちるので、使えない扱いにする。
    return 'unavailable';
  }
}

export async function createChromeAiSession(): Promise<ChromeAiSession> {
  const lm = languageModel();
  if (!lm) {
    throw new Error('chrome-ai is unavailable in this browser');
  }
  return lm.create(EXPECTED_INPUTS);
}
