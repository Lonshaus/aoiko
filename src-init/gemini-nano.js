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
  };
}
