import Foundation
// Concurrency.swift の runSingleFlight を直接駆動するテスト。AppleIntelligence.swift
// （FoundationModels 依存）は使わず、body はテスト側で作った偽物だけを渡す。
// runSingleFlight のゲートはプロセス全体で単一なので、各テストは自分の後始末として
// ゲートが空くのを待ってから次のテストへ進む（さもないと次のテストの最初の呼び出しが
// 前のテストの残骸で busy 判定を受けてしまう）。
// テスト自体は常にメインスレッドから呼ぶが、strict concurrency は呼び出し元まで
// 追ってくれないので、素の global var ではなくロック付きの箱にする。
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

func check(_ condition: @autoclosure () -> Bool, _ name: String) {
    if condition() {
        print("PASS: \(name)")
    } else {
        print("FAIL: \(name)")
        failures.increment()
    }
}
// body を外から遅らせるための待ち合わせ。release() が呼ばれるまで wait() は戻らない。
actor Latch {
    private var released = false
    private var continuation: CheckedContinuation<Void, Never>?

    func wait() async {
        if released {
            return
        }
        await withCheckedContinuation { continuation = $0 }
    }

    func release() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}
// ゲートが空くまで、無関係な軽いリクエストを送って観測する（内部のロックへは触れない）。
// 空いていれば即座に受理されて即返る一手なので、ポーリングの負荷は無視できる。
func waitForGateFree(timeoutSeconds: Double = 3) {
    let giveUpAt = Date().addingTimeInterval(timeoutSeconds)
    while Date() < giveUpAt {
        let probe = runSingleFlight(deadline: 1) { AppleAIOutcome(json: "probe", err: 0) }
        if probe.err != appleAIBusyError {
            return
        }
        Thread.sleep(forTimeInterval: 0.001)
    }
    check(false, "waitForGateFree: timed out waiting for the gate to free")
}
// スレッド跨ぎで結果を受け取るための単純な箱（テスト自身のもので、Concurrency.swift とは無関係）。
final class ThreadResult: @unchecked Sendable {
    var value: AppleAIOutcome?
}
// 1) body が終わらなくても、締め切り内で戻り、コードは 5。
func testBoundedWaitTimesOut() {
    let latch = Latch()
    let start = Date()
    let outcome = runSingleFlight(deadline: 0.2) {
        await latch.wait()
        return AppleAIOutcome(json: "late", err: 0)
    }
    let elapsed = Date().timeIntervalSince(start)
    check(outcome.err == appleAITimedOutError, "bounded wait: err == 5")
    check(outcome.json == nil, "bounded wait: json is nil")
    check(elapsed < 1.0, "bounded wait: returned quickly (\(elapsed)s < 1.0s)")
    Task { await latch.release() }
    waitForGateFree()
}
// 2) 見捨てた後の遅い書き込みは、次の呼び出しへ漏れない。
func testLateWriteAfterAbandonmentIsIgnored() {
    let latch = Latch()
    let abandoned = runSingleFlight(deadline: 0.2) {
        await latch.wait()
        return AppleAIOutcome(json: "leaked", err: 0)
    }
    check(abandoned.err == appleAITimedOutError, "late write ignored: abandoned call keeps its timeout result")
    Task { await latch.release() }
    waitForGateFree()
    let next = runSingleFlight(deadline: 1) { AppleAIOutcome(json: "fresh", err: 0) }
    check(next.err == 0 && next.json == "fresh", "late write ignored: the next call gets a fresh result, not the leaked one")
}
// 4) 片方が生成中のあいだ、もう片方（同じ入口でも別の入口でも）はコード 6 で弾かれる。
func testSecondEntryWhileBusyIsRejected() {
    let latch = Latch()
    let started = DispatchSemaphore(value: 0)
    let firstDone = DispatchSemaphore(value: 0)
    let firstResult = ThreadResult()
    let thread = Thread {
        firstResult.value = runSingleFlight(deadline: 5) {
            started.signal()
            await latch.wait()
            return AppleAIOutcome(json: "first", err: 0)
        }
        firstDone.signal()
    }
    thread.start()
    started.wait()
    let second = runSingleFlight(deadline: 1) { AppleAIOutcome(json: "second", err: 0) }
    check(second.err == appleAIBusyError, "second entry while busy: rejected with code 6")
    check(second.json == nil, "second entry while busy: no json")
    Task { await latch.release() }
    firstDone.wait()
    check(
        firstResult.value?.err == 0 && firstResult.value?.json == "first",
        "second entry while busy: the in-flight call still completes normally"
    )
    waitForGateFree()
}
// 5) 締め切りで見捨てた後も、その body が実際に終わるまではゲートが閉じたまま。
// gate.release() を締め切りの分岐へ移すと、この直後の呼び出しが誤って通ってしまう
// （見捨てたはずの body の横で次の生成が始まる、ゲートが本来防ぐ積み上がり）。
func testGateStaysClosedUntilAbandonedBodyReturns() {
    let latch = Latch()
    let abandoned = runSingleFlight(deadline: 0.1) {
        await latch.wait()
        return AppleAIOutcome(json: "late", err: 0)
    }
    check(abandoned.err == appleAITimedOutError, "gate after abandon: the abandoned wait itself times out")
    let stillBusy = runSingleFlight(deadline: 1) { AppleAIOutcome(json: "should not run", err: 0) }
    check(
        stillBusy.err == appleAIBusyError,
        "gate after abandon: still rejected with 6 while the abandoned body is outstanding"
    )
    Task { await latch.release() }
    waitForGateFree()
    let admitted = runSingleFlight(deadline: 1) { AppleAIOutcome(json: "now admitted", err: 0) }
    check(
        admitted.err == 0 && admitted.json == "now admitted",
        "gate after abandon: a further entry is admitted only once the abandoned body returns"
    )
}
// 取り消しを無視して待つ。async の中から Thread.sleep は呼べないので同期関数に包む。
func blockFor(_ seconds: Double) {
    Thread.sleep(forTimeInterval: seconds)
}
// 取り消しを無視する呼び出しを 10 回続ける body。runPartsInOrder を通すと、見捨てられた後は
// 次の呼び出しへ進まないのでゲートが早く空く。通さなければ最後まで握り続ける。
func slowCallsBody(checkingCancellation: Bool) -> @Sendable () async -> AppleAIOutcome {
    {
        let parts = Array(repeating: "x", count: 10)
        let call: (Int, String) async throws -> Int = { index, _ in
            blockFor(0.3)
            return index
        }
        if checkingCancellation {
            _ = try? await runPartsInOrder(parts, call: call)
        } else {
            for (index, part) in parts.enumerated() {
                _ = try? await call(index, part)
            }
        }
        return AppleAIOutcome(json: "done", err: 0)
    }
}
// 6) 取り消しを無視する連続呼び出しでも、runPartsInOrder を通せば見捨てた後にゲートが早く空く。
func testGateFreesEarlyWhenPartsCheckCancellation() {
    let outcome = runSingleFlight(deadline: 0.2, body: slowCallsBody(checkingCancellation: true))
    check(outcome.err == appleAITimedOutError, "early release: the wait itself times out with 5")
    let abandonedAt = Date()
    waitForGateFree(timeoutSeconds: 1)
    let freed = Date().timeIntervalSince(abandonedAt)
    print("INFO: early release: gate freed \(freed)s after the timeout")
    let next = runSingleFlight(deadline: 1) { AppleAIOutcome(json: "next", err: 0) }
    check(next.err == 0 && next.json == "next", "early release: the next entry is admitted within 1s of the timeout")
}
// 対照。runPartsInOrder を通さない同じ body は最後まで握り続ける（記録のみ）。
func recordGateHoldWithoutCancellationCheck() {
    _ = runSingleFlight(deadline: 0.2, body: slowCallsBody(checkingCancellation: false))
    let abandonedAt = Date()
    waitForGateFree(timeoutSeconds: 5)
    print("INFO: control: gate freed \(Date().timeIntervalSince(abandonedAt))s after the timeout")
}
// waitForAsync は締め切り内に終わった値を返す。
func testWaitForAsyncReturnsValueInTime() {
    let value = waitForAsync(timeout: 2) { 42 }
    check(value == 42, "waitForAsync: a body that finishes in time returns its value")
}
// waitForAsync は締め切りを過ぎたら nil を返し、ゲートには触れない。
func testWaitForAsyncTimesOut() {
    let started = Date()
    let value: Int? = waitForAsync(timeout: 0.2) {
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        return 1
    }
    check(value == nil, "waitForAsync: a body past the timeout yields nil")
    check(Date().timeIntervalSince(started) < 1.5, "waitForAsync: returns at the timeout without waiting for the body")
    let probe = runSingleFlight(deadline: 1) { AppleAIOutcome(json: "probe", err: 0) }
    check(probe.err == 0, "waitForAsync: does not hold the single-flight gate")
}

@main
struct ConcurrencyTests {
    static func main() {
        testBoundedWaitTimesOut()
        testLateWriteAfterAbandonmentIsIgnored()
        testSecondEntryWhileBusyIsRejected()
        testGateStaysClosedUntilAbandonedBodyReturns()
        testGateFreesEarlyWhenPartsCheckCancellation()
        recordGateHoldWithoutCancellationCheck()
        testWaitForAsyncReturnsValueInTime()
        testWaitForAsyncTimesOut()

        let failureCount = failures.read()
        if failureCount > 0 {
            print("FAILED: \(failureCount) check(s) failed")
            exit(1)
        }
        print("All Concurrency tests passed")
    }
}