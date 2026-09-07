import FoundationModels

// デプロイ対象は macOS 13.3 / iOS 16.4 だが、SystemLanguageModel は macOS 26 / iOS 26 から。
// FoundationModels の型は #available の外でも名前解決できる（SDK にモジュールがあれば
// コンパイルは通る）ので、参照はすべてこのガードの内側に置くだけでよい。
@_cdecl("aoiko_ai_availability")
func aoiko_ai_availability() -> Int32 {
    guard #available(macOS 26, iOS 26, *) else {
        return 4
    }
    switch SystemLanguageModel.default.availability {
    case .available:
        return 0
    case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible:
            return 1
        case .appleIntelligenceNotEnabled:
            return 2
        case .modelNotReady:
            return 3
        @unknown default:
            return 5
        }
    }
}