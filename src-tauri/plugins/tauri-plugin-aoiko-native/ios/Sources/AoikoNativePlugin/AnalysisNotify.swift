import Foundation
import UserNotifications
// 解析の完了通知と、解析中の「作業中」宣言。どちらも Rust から @_cdecl で直接呼ぶ。
// 通知に載せる文字列は Rust の固定表から来るポインタだけで、種別は下の switch で
// 文字列へ引き直す。自由な文字列をここへ渡す経路は無い。
// 種別の添字は notify.rs の AnalysisKind::index と揃える。
func analysisKindName(_ index: Int32) -> String? {
    switch index {
    case 0: return "receipt"
    case 1: return "order"
    case 2: return "classify"
    default: return nil
    }
}

func analysisKindIndex(_ name: String) -> Int32? {
    switch name {
    case "receipt": return 0
    case "order": return 1
    case "classify": return 2
    default: return nil
    }
}
// 開発中の素の実行ファイルのように .app に収まっていないプロセスは、
// UNUserNotificationCenter.current() に触れた時点で例外を投げて落ちる。
// 開発用の実行ファイルは Info.plist を埋め込むので、識別子の有無だけでは見分けられない。
func isAppBundle(_ url: URL, identifier: String?) -> Bool {
    guard url.pathExtension == "app" else {
        return false
    }
    guard let identifier = identifier, !identifier.isEmpty else {
        return false
    }
    return true
}
// どの入口も、通知センターへ触れる前にこれを見る。
private let runningAsAppBundle = isAppBundle(
    Bundle.main.bundleURL,
    identifier: Bundle.main.bundleIdentifier
)
// 0 非対応 / 1 未決定 / 2 拒否 / 3 許可。
private let statusUnsupported: Int32 = 0
private let statusDenied: Int32 = 2
// 一時的な許可や未知の値は、許可されていない扱いにする。
private func statusCode(_ status: UNAuthorizationStatus) -> Int32 {
    if status == .notDetermined {
        return 1
    }
    if status == .authorized || status == .provisional {
        return 3
    }
    return statusDenied
}
// 遅れて届く完了通知が、待つのをやめた呼び出し元の領域へ書き込まないよう、
// 結果はロック付きのヒープの箱に置く。
private final class ResultBox<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value?

    func write(_ next: Value) {
        lock.lock()
        defer { lock.unlock() }
        value = next
    }

    func read() -> Value? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}
// 待つのは呼び出し元のワーカースレッドだけ。メインスレッドで待つと、通知センターの
// 応答を返す処理と互いに待ち合って止まる。
private let statusWaitSeconds: TimeInterval = 5
private let requestWaitSeconds: TimeInterval = 300
private let postWaitSeconds: TimeInterval = 5

private func currentStatus() -> Int32 {
    guard runningAsAppBundle else {
        return statusUnsupported
    }
    guard !Thread.isMainThread else {
        return statusDenied
    }
    let box = ResultBox<Int32>()
    let done = DispatchSemaphore(value: 0)
    UNUserNotificationCenter.current().getNotificationSettings { settings in
        box.write(statusCode(settings.authorizationStatus))
        done.signal()
    }
    _ = done.wait(timeout: .now() + statusWaitSeconds)
    // 答えが来なければ許可されていない扱いにする。
    return box.read() ?? statusDenied
}

@_cdecl("aoiko_notify_status")
func aoiko_notify_status() -> Int32 {
    return currentStatus()
}

@_cdecl("aoiko_notify_request")
func aoiko_notify_request() -> Int32 {
    guard runningAsAppBundle else {
        return statusUnsupported
    }
    guard !Thread.isMainThread else {
        return statusDenied
    }
    let done = DispatchSemaphore(value: 0)
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in
        done.signal()
    }
    _ = done.wait(timeout: .now() + requestWaitSeconds)
    // 応答の中身ではなく、通知センターが今持っている状態を答えにする。
    return currentStatus()
}
// 0 成功 / 1 非対応 / 2 引数が不正 / 3 登録に失敗。
// 文字列は呼び出しの間だけ有効なので、戻る前にすべてコピーする。
@_cdecl("aoiko_notify_post")
func aoiko_notify_post(
    _ kind: Int32,
    _ title: UnsafePointer<CChar>?,
    _ body: UnsafePointer<CChar>?
) -> Int32 {
    guard runningAsAppBundle else {
        return 1
    }
    guard let name = analysisKindName(kind), let title = title, let body = body else {
        return 2
    }
    guard !Thread.isMainThread else {
        return 3
    }
    let content = UNMutableNotificationContent()
    content.title = String(cString: title)
    content.body = String(cString: body)
    content.userInfo = ["kind": name]
    let request = UNNotificationRequest(
        identifier: "aoiko-analysis-\(name)",
        content: content,
        trigger: nil
    )
    let box = ResultBox<Int32>()
    let done = DispatchSemaphore(value: 0)
    UNUserNotificationCenter.current().add(request) { error in
        box.write(error == nil ? 0 : 3)
        done.signal()
    }
    _ = done.wait(timeout: .now() + postWaitSeconds)
    return box.read() ?? 3
}

private final class OpenHandlerBox: @unchecked Sendable {
    private let lock = NSLock()
    private var handler: (@convention(c) (Int32) -> Void)?

    func set(_ next: @escaping @convention(c) (Int32) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        handler = next
    }

    func get() -> (@convention(c) (Int32) -> Void)? {
        lock.lock()
        defer { lock.unlock() }
        return handler
    }
}

private let openHandler = OpenHandlerBox()
// 通知センターは delegate を弱参照で持つので、グローバル変数で強参照を持っておく。
private final class AnalysisNotifyDelegate: NSObject, UNUserNotificationCenterDelegate, Sendable {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else {
            return
        }
        // 通知の中身は信用しない。既知の種別に当たったものだけを Rust へ渡す。
        guard let name = response.notification.request.content.userInfo["kind"] as? String,
            let index = analysisKindIndex(name),
            let handler = openHandler.get()
        else {
            return
        }
        handler(index)
    }
}

private let analysisNotifyDelegate = AnalysisNotifyDelegate()

@_cdecl("aoiko_notify_set_open_handler")
func aoiko_notify_set_open_handler(_ handler: @escaping @convention(c) (Int32) -> Void) {
    guard runningAsAppBundle else {
        return
    }
    openHandler.set(handler)
    UNUserNotificationCenter.current().delegate = analysisNotifyDelegate
}
// 理由は固定。ジョブの識別子や種別のような、システムの画面に出る可能性のある値は入れない。
private let activityReason = "aoiko analysis"

private final class ActivityTable: @unchecked Sendable {
    private let lock = NSLock()
    private var next: UInt64 = 1
    private var tokens: [UInt64: NSObjectProtocol] = [:]

    func begin() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        let handle = next
        next += 1
        tokens[handle] = ProcessInfo.processInfo.beginActivity(
            options: .userInitiated,
            reason: activityReason
        )
        return handle
    }

    func end(_ handle: UInt64) {
        lock.lock()
        let token = tokens.removeValue(forKey: handle)
        lock.unlock()
        if let token = token {
            ProcessInfo.processInfo.endActivity(token)
        }
    }
}

private let activities = ActivityTable()
// 0 は「始めていない」。Rust 側はそれを保持しない。
@_cdecl("aoiko_activity_begin")
func aoiko_activity_begin() -> UInt64 {
    guard runningAsAppBundle else {
        return 0
    }
    return activities.begin()
}

@_cdecl("aoiko_activity_end")
func aoiko_activity_end(_ handle: UInt64) {
    activities.end(handle)
}