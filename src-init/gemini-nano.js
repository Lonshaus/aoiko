// 端末内の Gemini Nano。載せている環境だけで、他は関数ごと生やさない。
const PLATFORMS = ['android'];

export function createGeminiNano(invoke, platform) {
  if (!PLATFORMS.includes(platform)) {
    return null;
  }
  return {
    // status は端末側の値そのまま。tokenLimit は使えるときだけ数値になる。
    async nanoAvailability() {
      return invoke('plugin:aoiko-native|nano_availability');
    },
    // 失敗は拒否コードの文字列で reject する。
    async nanoExtractReceipt(base64) {
      return invoke('plugin:aoiko-native|nano_extract_receipt', { imageBase64: base64 });
    },
    async nanoRun(task, data) {
      return invoke('plugin:aoiko-native|nano_run', { task, data });
    },
  };
}
