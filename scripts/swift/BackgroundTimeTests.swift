import Foundation
// BackgroundTime のテスト。OS の背景処理の呼び出しは偽物に差し替え、呼ばれ方だけを見る。
// runner.js は test-swift.mjs が束ねて、そのパスを第 1 引数で渡す（期限切れの検査で使う）。
final class FailureCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func increment() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    func read() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

let failures = FailureCounter()

func report(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func check(_ condition: @autoclosure () -> Bool, _ name: String) {
    if condition() {
        report("PASS: \(name)")
    } else {
        report("FAIL: \(name)")
        failures.increment()
    }
}

final class FakeTask: ContinuedTaskHandle, @unchecked Sendable {
    private let lock = NSLock()
    private var expiration: (@Sendable () -> Void)?
    private var reports: [(Int64, Int64)] = []
    private var result: Bool?

    func setExpiration(_ handler: @escaping @Sendable () -> Void) {
        lock.lock()
        expiration = handler
        lock.unlock()
    }

    func report(completed: Int64, total: Int64) {
        lock.lock()
        reports.append((completed, total))
        lock.unlock()
    }

    func complete(success: Bool) {
        lock.lock()
        result = success
        lock.unlock()
    }

    func completedWith() -> Bool? {
        lock.lock()
        defer { lock.unlock() }
        return result
    }

    func lastReport() -> (Int64, Int64)? {
        lock.lock()
        defer { lock.unlock() }
        return reports.last
    }

    func expire() {
        lock.lock()
        let handler = expiration
        lock.unlock()
        handler?()
    }
}

final class FakeScheduler: BackgroundScheduling, @unchecked Sendable {
    private let lock = NSLock()
    var active = true
    var continued = true
    var registerResult = true
    var submitResult = true
    private(set) var registered: [String] = []
    private(set) var submitted: [(String, String, String)] = []
    private var launchers: [String: @Sendable (ContinuedTaskHandle) -> Void] = [:]
    private var nextId = 1
    private var expirations: [Int: @Sendable () -> Void] = [:]
    private(set) var begun: [Int] = []
    private(set) var ended: [(Int, Date)] = []

    func isAppActive() -> Bool { active }

    func supportsContinuedProcessing() -> Bool { continued }

    func register(_ identifier: String, launch: @escaping @Sendable (ContinuedTaskHandle) -> Void)
        -> Bool
    {
        lock.lock()
        defer { lock.unlock() }
        registered.append(identifier)
        if registerResult {
            launchers[identifier] = launch
        }
        return registerResult
    }

    func submit(_ identifier: String, title: String, subtitle: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        submitted.append((identifier, title, subtitle))
        return submitResult
    }

    func beginBackgroundTask(expiration: @escaping @Sendable () -> Void) -> Int {
        lock.lock()
        defer { lock.unlock() }
        let id = nextId
        nextId += 1
        expirations[id] = expiration
        begun.append(id)
        return id
    }

    func endBackgroundTask(_ id: Int) {
        lock.lock()
        defer { lock.unlock() }
        ended.append((id, Date()))
    }

    func launch(_ identifier: String, _ task: FakeTask) {
        lock.lock()
        let launcher = launchers[identifier]
        lock.unlock()
        launcher?(task)
    }

    func expire(_ id: Int) {
        lock.lock()
        let handler = expirations[id]
        lock.unlock()
        handler?()
    }

    func endedIds() -> [Int] {
        lock.lock()
        defer { lock.unlock() }
        return ended.map { $0.0 }
    }

    func endedAt(_ id: Int) -> Date? {
        lock.lock()
        defer { lock.unlock() }
        return ended.first { $0.0 == id }?.1
    }
}

final class ExpiredLog: @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [UInt64] = []
    var delay: TimeInterval = 0
    var action: (@Sendable (UInt64) -> Void)?

    func record(_ token: UInt64) {
        lock.lock()
        tokens.append(token)
        let action = self.action
        lock.unlock()
        action?(token)
        if delay > 0 {
            Thread.sleep(forTimeInterval: delay)
        }
    }

    func seen() -> [UInt64] {
        lock.lock()
        defer { lock.unlock() }
        return tokens
    }
}

let queue = DispatchQueue(label: "background-time-tests")

func make(_ scheduler: FakeScheduler, _ log: ExpiredLog = ExpiredLog()) -> BackgroundTime {
    return BackgroundTime(scheduler: scheduler, queue: queue, onExpired: { log.record($0) })
}

func flush() {
    queue.sync {}
}

func waitUntil(_ seconds: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        if condition() {
            return true
        }
        Thread.sleep(forTimeInterval: 0.02)
    }
    return condition()
}

func testRegistrationFailureFallsBackWithoutSubmitting() {
    let scheduler = FakeScheduler()
    scheduler.registerResult = false
    let time = make(scheduler)
    time.begin(1, title: "aoiko", subtitle: "領収書の解析中")
    flush()
    check(scheduler.registered.count == 1, "register false: registration was tried once")
    check(scheduler.submitted.isEmpty, "register false: nothing is submitted")
    check(scheduler.begun.count == 1, "register false: beginBackgroundTask is used")
    time.end(1, success: true)
    flush()
    check(scheduler.endedIds() == scheduler.begun, "register false: the background task is ended")
}

func testInactiveOrOldSystemsUseBeginBackgroundTask() {
    for (active, continued) in [(false, true), (true, false)] {
        let scheduler = FakeScheduler()
        scheduler.active = active
        scheduler.continued = continued
        let time = make(scheduler)
        time.begin(1, title: "t", subtitle: "s")
        flush()
        check(
            scheduler.registered.isEmpty && scheduler.submitted.isEmpty && scheduler.begun.count == 1,
            "active \(active) continued \(continued): only beginBackgroundTask")
    }
}

func testContinuedProcessingSubmitsTheFixedTexts() {
    let scheduler = FakeScheduler()
    let time = make(scheduler)
    time.begin(1, title: "aoiko", subtitle: "インポートの解析中")
    flush()
    let submitted = scheduler.submitted.first
    check(submitted?.1 == "aoiko" && submitted?.2 == "インポートの解析中", "continued: fixed texts")
    check(scheduler.begun.isEmpty, "continued: no beginBackgroundTask")
    let identifier = submitted?.0 ?? ""
    check(identifier.hasPrefix(continuedTaskPrefix), "continued: identifier uses the plist prefix")
    let suffix = identifier.dropFirst(continuedTaskPrefix.count)
    check(
        suffix.count == 32 && suffix.allSatisfy({ $0.isHexDigit }),
        "continued: identifier carries only random hex")
    let task = FakeTask()
    scheduler.launch(identifier, task)
    check(task.lastReport()! == (0, 1), "continued: launch reports progress")
    time.progress(1, completed: 1, total: 2)
    check(task.lastReport()! == (1, 2), "continued: progress is forwarded")
    time.end(1, success: true)
    flush()
    check(task.completedWith() == true, "continued: the task is completed at the end")
}

func testSubmitFailureFallsBack() {
    let scheduler = FakeScheduler()
    scheduler.submitResult = false
    let time = make(scheduler)
    time.begin(1, title: "t", subtitle: "s")
    flush()
    check(scheduler.submitted.count == 1 && scheduler.begun.count == 1, "submit false: falls back")
}

func testIdentifiersAreNeverRegisteredTwice() {
    let scheduler = FakeScheduler()
    let time = make(scheduler)
    for token in UInt64(1)...50 {
        time.begin(token, title: "t", subtitle: "s")
        flush()
        time.end(token, success: true)
    }
    flush()
    check(scheduler.registered.count == 50, "unique: every job registered once")
    check(Set(scheduler.registered).count == 50, "unique: no identifier is registered twice")
}

func testALateLaunchForAnEndedJobFailsAtOnce() {
    let scheduler = FakeScheduler()
    let time = make(scheduler)
    time.begin(1, title: "t", subtitle: "s")
    flush()
    let identifier = scheduler.submitted.first?.0 ?? ""
    time.end(1, success: true)
    flush()
    let late = FakeTask()
    scheduler.launch(identifier, late)
    check(late.completedWith() == false, "late launch: completes with failure at once")
    let unknown = FakeTask()
    scheduler.launch("net.lonshaus.aoiko.ios.analysis.unknown", unknown)
    check(unknown.completedWith() == nil, "late launch: unregistered identifiers never launch")
}

func testExpiryReportsOnceAndEndsTheTask() {
    let scheduler = FakeScheduler()
    scheduler.continued = false
    let log = ExpiredLog()
    let time = make(scheduler, log)
    time.begin(3, title: "t", subtitle: "s")
    flush()
    let id = scheduler.begun.first ?? 0
    scheduler.expire(id)
    scheduler.expire(id)
    check(waitUntil(3) { scheduler.endedIds() == [id] }, "expiry: the background task is ended")
    check(waitUntil(1) { log.seen() == [3] }, "expiry: the runner is told once with the token")
    time.end(3, success: true)
    flush()
    check(scheduler.endedIds() == [id], "expiry: a later end does not end it again")
    let continuedScheduler = FakeScheduler()
    let continuedLog = ExpiredLog()
    let continuedTime = make(continuedScheduler, continuedLog)
    continuedTime.begin(4, title: "t", subtitle: "s")
    flush()
    let task = FakeTask()
    continuedScheduler.launch(continuedScheduler.submitted.first?.0 ?? "", task)
    task.expire()
    check(waitUntil(3) { task.completedWith() == false }, "expiry: a continued task fails")
    check(waitUntil(1) { continuedLog.seen() == [4] }, "expiry: the continued task tells the runner")
}
// runner のスレッドが同期の呼び出しで止まっていても、締め切りまでに時間を返す。
func testExpiryEndsTheTaskWhileTheRunnerIsBlocked(_ script: String) {
    let scheduler = FakeScheduler()
    scheduler.continued = false
    let log = ExpiredLog()
    log.delay = 5
    let time = make(scheduler, log)
    let started = DispatchSemaphore(value: 0)
    let runner = AnalysisRunner(
        hooks: RunnerHooks(
            fetch: { _, _, _ in
                started.signal()
                Thread.sleep(forTimeInterval: 6)
            },
            complete: { _, _ in },
            progress: { _, _, _ in }
        ))
    log.action = { token in runner.cancel(token) }
    time.begin(21, title: "t", subtitle: "s")
    flush()
    let spec =
        #"{"job":"j","kind":"order","engine":"openai-compatible","locale":"ja","notify":true,"adapter":{"model":"m","apiKey":"","baseUrl":"http://127.0.0.1:41741/v1"},"input":{"text":"x"}}"#
    runner.start(21, script: script, spec: spec)
    check(started.wait(timeout: .now() + 10) == .success, "blocked: the runner is inside the host call")
    let id = scheduler.begun.first ?? 0
    let expiredAt = Date()
    scheduler.expire(id)
    check(waitUntil(4) { scheduler.endedAt(id) != nil }, "blocked: the task is ended")
    let elapsed = scheduler.endedAt(id).map { $0.timeIntervalSince(expiredAt) } ?? 99
    check(elapsed <= expiryHardDeadlineSeconds + 0.5, "blocked: within the deadline (\(elapsed) s)")
    check(log.seen() == [21], "blocked: the runner was told about the expiry")
}
// A6：続行タスクは、done のときだけ成功で閉じる。Rust の判定（complete の戻り値、runner.rs で
// 確かめている）の代わりに、ここでは結果の outcome が done かどうかを返す。
final class RunnerBox: @unchecked Sendable {
    var runner: AnalysisRunner?
}

func replyFrame(status: Int, body: String) -> Data {
    let meta = try! JSONSerialization.data(withJSONObject: [
        "status": status, "statusText": "", "headers": [["content-type", "application/json"]],
    ])
    var frame = Data()
    withUnsafeBytes(of: UInt32(meta.count).littleEndian) { frame.append(contentsOf: $0) }
    frame.append(meta)
    frame.append(Data(body.utf8))
    return frame
}

func outcomeIsDone(_ data: Data) -> Bool {
    let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    return object?["outcome"] as? String == "done"
}

func testTheContinuedTaskEndsWithTheDecidedOutcome(_ script: String) {
    let content =
        #"{"date":"2026-10-01","vendor":"Shop","items":[{"description":"A","amount":"1"}],"totalAmount":"1"}"#
    let done = try! JSONSerialization.data(withJSONObject: [
        "choices": [["message": ["content": content]]]
    ])
    let cases: [(String, Data?, Bool)] = [
        ("done", replyFrame(status: 200, body: String(decoding: done, as: UTF8.self)), true),
        ("failed", replyFrame(status: 500, body: "down"), false),
        ("cancelled", nil, false),
    ]
    for (index, (name, reply, expected)) in cases.enumerated() {
        let token = UInt64(30 + index)
        let scheduler = FakeScheduler()
        let time = make(scheduler)
        time.begin(token, title: "t", subtitle: "s")
        flush()
        let task = FakeTask()
        scheduler.launch(scheduler.submitted.first?.0 ?? "", task)
        let box = RunnerBox()
        let runner = AnalysisRunner(
            hooks: RunnerHooks(
                fetch: { token, request, _ in
                    if let reply = reply {
                        box.runner?.reply(token, request: request, body: reply)
                    } else {
                        box.runner?.cancel(token)
                    }
                },
                complete: reportThenEnd(time) { _, outcome in outcomeIsDone(outcome) },
                progress: { _, _, _ in }
            ), cancelGrace: 1)
        box.runner = runner
        let spec =
            #"{"job":"j","kind":"order","engine":"openai-compatible","locale":"ja","notify":false,"adapter":{"model":"m","apiKey":"","baseUrl":"http://127.0.0.1:41741/v1"},"input":{"text":"x"}}"#
        runner.start(token, script: script, spec: spec)
        check(waitUntil(5) { task.completedWith() != nil }, "outcome \(name): the continued task is completed")
        check(task.completedWith() == expected, "outcome \(name): completed with success \(expected)")
    }
}

func testAppStateIsNeverActiveOffIOS() {
    check(aoiko_app_is_active() == 0, "app state: macOS builds report not active")
}

@main
struct BackgroundTimeTests {
    static func main() {
        guard CommandLine.arguments.count >= 2,
            let script = try? String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        else {
            report("FAILED: runner.js のパスが渡されていない")
            exit(1)
        }
        testRegistrationFailureFallsBackWithoutSubmitting()
        testInactiveOrOldSystemsUseBeginBackgroundTask()
        testContinuedProcessingSubmitsTheFixedTexts()
        testSubmitFailureFallsBack()
        testIdentifiersAreNeverRegisteredTwice()
        testALateLaunchForAnEndedJobFailsAtOnce()
        testExpiryReportsOnceAndEndsTheTask()
        testExpiryEndsTheTaskWhileTheRunnerIsBlocked(script)
        testTheContinuedTaskEndsWithTheDecidedOutcome(script)
        testAppStateIsNeverActiveOffIOS()

        let failureCount = failures.read()
        if failureCount > 0 {
            report("FAILED: \(failureCount) check(s) failed")
            exit(1)
        }
        report("All BackgroundTime tests passed")
    }
}