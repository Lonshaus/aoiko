// OS 内蔵の文字認識。実装のある環境でだけ入口を生やす。ただし入口が在ることと
// その端末が日本語を読めることは別なので、可否は下の問い合わせで別途決める。
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
    // 対応言語は OS の版や導入内容で変わる。設定画面が選択肢を出す前に毎回問う。
    async isTextRecognitionAvailable() {
      return invoke('plugin:aoiko-native|is_text_recognition_available');
    },
  };
}
