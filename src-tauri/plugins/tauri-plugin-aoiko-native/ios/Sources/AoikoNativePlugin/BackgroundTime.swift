import Foundation

#if os(iOS)
    import BackgroundTasks
    import UIKit
#endif
// 解析中にアプリが裏へ回っても動き続けるための時間。iOS 26 以降で利用者の操作の中なら
// 続行タスク（進捗の表示付き）を求め、それ以外や断られたときは beginBackgroundTask を使う。
// 識別子はジョブごとに作り直し、同じ識別子を二度登録しない（二度目の登録はアプリを終了させる）。
// 識別子・タイトル・サブタイトルにジョブの中身は入れない。
let continuedTaskPrefix = "net.lonshaus.aoiko.ios.analysis."
// 期限切れのあと、通知を出し終えるのを待つ長さと、それとは別に必ず時間を返す締め切り。
let expiryNotifyWaitSeconds: TimeInterval = 2
let expiryHardDeadlineSeconds: TimeInterval = 2.5
/// 続行タスク 1 件。テストでは偽物に差し替える。
protocol ContinuedTaskHandle: AnyObject {
    func setExpiration(_ handler: @escaping @Sendable () -> Void)
    func report(completed: Int64, total: Int64)
    func complete(success: Bool)
}
/// OS の背景処理の呼び出し。どれもメインスレッドで呼ぶ（テストでは指定のキューで呼ぶ）。
protocol BackgroundScheduling: AnyObject {
    func isAppActive() -> Bool
    func supportsContinuedProcessing() -> Bool
    func register(_ identifier: String, launch: @escaping @Sendable (ContinuedTaskHandle) -> Void)
        -> Bool
    func submit(_ identifier: String, title: String, subtitle: String) -> Bool
    // 0 は「始められなかった」。
    func beginBackgroundTask(expiration: @escaping @Sendable () -> Void) -> Int
    func endBackgroundTask(_ id: Int)
}

private struct Entry {
    var identifier: String?
    var task: ContinuedTaskHandle?
    var backgroundId: Int
    var completed: Int64
    var total: Int64
    var expired: Bool
}
// 終えたジョブの後始末を queue へ渡すための入れ物。中身は queue の上でしか触らない。
private final class EndedEntry: @unchecked Sendable {
    let task: ContinuedTaskHandle?
    let backgroundId: Int

    init(task: ContinuedTaskHandle?, backgroundId: Int) {
        self.task = task
        self.backgroundId = backgroundId
    }
}
/// ジョブごとの背景時間の台帳。状態はロックで守り、OS の呼び出しは queue（本番はメイン）で行う。
final class BackgroundTime: @unchecked Sendable {
    private let scheduler: BackgroundScheduling
    private let queue: DispatchQueue
    private let onExpired: @Sendable (UInt64) -> Void
    private let lock = NSLock()
    private var entries: [UInt64: Entry] = [:]

    init(
        scheduler: BackgroundScheduling,
        queue: DispatchQueue,
        onExpired: @escaping @Sendable (UInt64) -> Void
    ) {
        self.scheduler = scheduler
        self.queue = queue
        self.onExpired = onExpired
    }
    // 識別子は乱数だけで作る。ジョブの識別子や種別は入れない。
    static func makeIdentifier() -> String {
        return continuedTaskPrefix + UUID().uuidString.replacingOccurrences(of: "-", with: "")
    }

    func begin(_ token: UInt64, title: String, subtitle: String) {
        lock.lock()
        entries[token] = Entry(
            identifier: nil, task: nil, backgroundId: 0, completed: 0, total: 1, expired: false)
        lock.unlock()
        queue.async { self.acquire(token, title: title, subtitle: subtitle) }
    }

    private func acquire(_ token: UInt64, title: String, subtitle: String) {
        guard isLive(token) else {
            return
        }
        if scheduler.supportsContinuedProcessing() && scheduler.isAppActive() {
            let identifier = BackgroundTime.makeIdentifier()
            setIdentifier(token, identifier)
            // 登録に失敗したあとに投げるとアプリが終了させられるので、登録できたときだけ投げる。
            let registered = scheduler.register(identifier) { [weak self] task in
                self?.launched(identifier, task)
            }
            if registered && scheduler.submit(identifier, title: title, subtitle: subtitle) {
                return
            }
            setIdentifier(token, nil)
        }
        let id = scheduler.beginBackgroundTask { [weak self] in
            self?.expired(token)
        }
        lock.lock()
        let stillLive = entries[token] != nil
        if stillLive {
            entries[token]?.backgroundId = id
        }
        lock.unlock()
        // 取得する前にジョブが終わっていたら、すぐに返す。
        if !stillLive && id != 0 {
            scheduler.endBackgroundTask(id)
        }
    }

    private func isLive(_ token: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return entries[token] != nil
    }

    private func setIdentifier(_ token: UInt64, _ identifier: String?) {
        lock.lock()
        defer { lock.unlock() }
        entries[token]?.identifier = identifier
    }
    // 知らない識別子・終わったジョブの起動は、すぐに失敗で閉じる。
    private func launched(_ identifier: String, _ task: ContinuedTaskHandle) {
        lock.lock()
        let found = entries.first { $0.value.identifier == identifier && !$0.value.expired }
        if let found = found {
            let token = found.key
            let entry = found.value
            entries[token]?.task = task
            lock.unlock()
            task.setExpiration { [weak self] in
                self?.expired(token)
            }
            task.report(completed: entry.completed, total: entry.total)
            return
        }
        lock.unlock()
        task.complete(success: false)
    }

    func progress(_ token: UInt64, completed: Int64, total: Int64) {
        lock.lock()
        guard entries[token] != nil else {
            lock.unlock()
            return
        }
        entries[token]?.completed = completed
        entries[token]?.total = total
        let task = entries[token]?.task
        lock.unlock()
        task?.report(completed: completed, total: total)
    }
    // 期限切れの合図は印を付けるだけ。通知はワーカーが出し、待つのは最長 2 秒。
    // それとは別の締め切りで、時間は必ず返す。メインスレッドでも runner のスレッドでも待たない。
    func expired(_ token: UInt64) {
        lock.lock()
        guard entries[token] != nil, entries[token]?.expired == false else {
            lock.unlock()
            return
        }
        entries[token]?.expired = true
        lock.unlock()
        let notified = DispatchSemaphore(value: 0)
        let onExpired = self.onExpired
        Thread.detachNewThread {
            onExpired(token)
            notified.signal()
        }
        DispatchQueue.global().async { [weak self] in
            _ = notified.wait(timeout: .now() + expiryNotifyWaitSeconds)
            self?.end(token, success: false)
        }
        queue.asyncAfter(deadline: .now() + expiryHardDeadlineSeconds) { [weak self] in
            self?.end(token, success: false)
        }
    }
    // 何度呼ばれても、時間を返すのは 1 回だけ。
    func end(_ token: UInt64, success: Bool) {
        lock.lock()
        let entry = entries.removeValue(forKey: token)
        lock.unlock()
        guard let entry = entry else {
            return
        }
        let ended = EndedEntry(task: entry.task, backgroundId: entry.backgroundId)
        queue.async {
            ended.task?.complete(success: success)
            if ended.backgroundId != 0 {
                self.scheduler.endBackgroundTask(ended.backgroundId)
            }
        }
    }
}

#if os(iOS)
    private final class SystemContinuedTask: ContinuedTaskHandle {
        private let task: BGTask

        init(_ task: BGTask) {
            self.task = task
        }

        func setExpiration(_ handler: @escaping @Sendable () -> Void) {
            task.expirationHandler = handler
        }

        func report(completed: Int64, total: Int64) {
            if #available(iOS 26.0, *), let task = task as? BGContinuedProcessingTask {
                task.progress.totalUnitCount = total
                task.progress.completedUnitCount = completed
            }
        }

        func complete(success: Bool) {
            task.setTaskCompleted(success: success)
        }
    }

    final class SystemBackgroundScheduler: BackgroundScheduling {
        func isAppActive() -> Bool {
            return UIApplication.shared.applicationState == .active
        }

        func supportsContinuedProcessing() -> Bool {
            if #available(iOS 26.0, *) {
                return true
            }
            return false
        }

        func register(
            _ identifier: String, launch: @escaping @Sendable (ContinuedTaskHandle) -> Void
        ) -> Bool {
            guard #available(iOS 26.0, *) else {
                return false
            }
            return BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) {
                task in
                launch(SystemContinuedTask(task))
            }
        }

        func submit(_ identifier: String, title: String, subtitle: String) -> Bool {
            guard #available(iOS 26.0, *) else {
                return false
            }
            let request = BGContinuedProcessingTaskRequest(
                identifier: identifier, title: title, subtitle: subtitle)
            request.strategy = .fail
            do {
                try BGTaskScheduler.shared.submit(request)
                return true
            } catch {
                return false
            }
        }

        func beginBackgroundTask(expiration: @escaping @Sendable () -> Void) -> Int {
            let id = UIApplication.shared.beginBackgroundTask(expirationHandler: expiration)
            return id == .invalid ? 0 : id.rawValue
        }

        func endBackgroundTask(_ id: Int) {
            UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: id))
        }
    }
#endif