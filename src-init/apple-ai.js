// OS 内蔵の AI によるレシート抽出。実装が無い環境では
// 入口ごと生やさない（設定画面に選べない選択肢を出さないのと同じ理由）。
const PLATFORMS = ['macos', 'ios'];

export function createAppleAi(invoke, platform) {
  if (!PLATFORMS.includes(platform)) {
    return null;
  }
  return {
    // 0..5 の意味はネイティブ側のコメントに揃える。
    async appleAiAvailability() {
      return invoke('plugin:aoiko-native|apple_ai_availability');
    },
    // 失敗時は Rust 側が Err(u8) を返し、invoke はその数値で reject する。
    async appleAiExtract(base64) {
      return invoke('plugin:aoiko-native|apple_ai_extract', { imageBase64: base64 });
    },
    // 失敗時は Rust 側が Err(u8) を返し、invoke はその数値で reject する。
    // 権限不足・未知コマンドは tauri 自身が文字列で reject する。
    async appleAiRun(task, data) {
      return invoke('plugin:aoiko-native|apple_ai_run', { task, data });
    },
  };
}
