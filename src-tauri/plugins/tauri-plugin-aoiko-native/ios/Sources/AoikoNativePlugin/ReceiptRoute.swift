// 画像をそのままモデルへ渡せるのは OS 27 以降で、端末のモデルが画像入力に対応しているときだけ。
// それ以外は文字認識の結果をモデルへ渡す。
enum ReceiptRoute: Equatable, Sendable {
    case image
    case recognizedText
}

func receiptRoute(osSupportsImageInput: Bool, modelSupportsVision: Bool) -> ReceiptRoute {
    if osSupportsImageInput && modelSupportsVision {
        return .image
    }
    return .recognizedText
}