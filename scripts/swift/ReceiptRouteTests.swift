import Foundation
// ReceiptRoute.swift の判定を 4 通りの入力で確かめる。
func check(_ route: ReceiptRoute, _ expected: ReceiptRoute, _ name: String) -> Bool {
    if route == expected {
        print("PASS: \(name)")
        return true
    }
    print("FAIL: \(name)")
    return false
}

@main
struct ReceiptRouteTests {
    static func main() {
        let results = [
            check(
                receiptRoute(osSupportsImageInput: true, modelSupportsVision: true),
                .image,
                "OS 27 以降で画像入力に対応したモデルなら画像のまま渡す"
            ),
            check(
                receiptRoute(osSupportsImageInput: true, modelSupportsVision: false),
                .recognizedText,
                "OS 27 以降でもモデルが画像入力に対応していなければ文字認識を挟む"
            ),
            check(
                receiptRoute(osSupportsImageInput: false, modelSupportsVision: true),
                .recognizedText,
                "OS 26 では文字認識を挟む"
            ),
            check(
                receiptRoute(osSupportsImageInput: false, modelSupportsVision: false),
                .recognizedText,
                "どちらも満たさなければ文字認識を挟む"
            ),
        ]
        let failureCount = results.filter { !$0 }.count
        if failureCount > 0 {
            print("FAILED: \(failureCount) check(s) failed")
            exit(1)
        }
        print("All ReceiptRoute tests passed")
    }
}