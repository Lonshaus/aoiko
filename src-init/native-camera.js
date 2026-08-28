// その場で撮る入口。回せるのは ある環境 だけで、他は関数ごと生やさない。
// 生えていることと相機が在ることは別なので、可否は下の問い合わせで別途決める。
const PLATFORMS = ['android'];

export function createNativeCamera(invoke, platform) {
  if (!PLATFORMS.includes(platform)) {
    return null;
  }
  return {
    // 相機の無い端末では押せないボタンになる。出す前に毎回問う。
    async isCameraAvailable() {
      return invoke('plugin:aoiko-native|is_camera_available');
    },
  };
}
