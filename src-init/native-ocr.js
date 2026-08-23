// OS 内蔵の文字認識。Apple の環境にしか無いので、それ以外では入口ごと生やさない
// （web 側の能力判定は関数の有無で行われる）。
const PLATFORMS = ['macos', 'ios'];

export function createNativeOcr(invoke, platform) {
  if (!PLATFORMS.includes(platform)) {
    return null;
  }
  return {
    // 形式は認識側が中身から判定するため渡さない。版面は組み替えずそのまま渡す。
    async recognizeText(base64) {
      return invoke('plugin:aoiko-native|recognize_text', { imageBase64: base64 });
    },
  };
}
