import Foundation

#if os(iOS)
    import UIKit
#endif
// 利用者がアプリを見ているか。通知を出すかどうかの判断に使う（見ているときは出さない）。
// 状態はメインスレッドでしか読めないので、呼び出し元のワーカースレッドが待つ。
private final class AppStateBox: @unchecked Sendable {
    private let lock = NSLock()
    private var active = false

    func write(_ next: Bool) {
        lock.lock()
        defer { lock.unlock() }
        active = next
    }

    func read() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return active
    }
}
// メインスレッドが答えないときは「見ていない」ものとして扱い、通知を出す。
private let appStateWaitSeconds: TimeInterval = 2

@_cdecl("aoiko_app_is_active")
func aoiko_app_is_active() -> Int32 {
    #if os(iOS)
        guard !Thread.isMainThread else {
            return 0
        }
        let box = AppStateBox()
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            box.write(UIApplication.shared.applicationState == .active)
            done.signal()
        }
        _ = done.wait(timeout: .now() + appStateWaitSeconds)
        return box.read() ? 1 : 0
    #else
        return 0
    #endif
}