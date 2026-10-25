import Foundation
import JavaScriptCore
// AnalysisRunner のテスト。runner.js は test-swift.mjs が束ねて、そのパスを第 1 引数で渡す。
// Rust の代わりに、通信と終了の報告を受ける偽物に差し替える。
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

let marker = "/* aoiko-native-runner */\n"

final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private var completes: [(UInt64, Data)] = []
    private var fetches: [(UInt64, UInt64, Data)] = []
    private var progress: [(Int64, Int64)] = []
    let completed = DispatchSemaphore(value: 0)
    let fetched = DispatchSemaphore(value: 0)
    weak var runner: AnalysisRunner?
    var answer: (@Sendable (Data) -> Data?)?

    func complete(_ token: UInt64, _ data: Data) {
        lock.lock()
        completes.append((token, data))
        lock.unlock()
        completed.signal()
    }

    func fetch(_ token: UInt64, _ request: UInt64, _ frame: Data) {
        lock.lock()
        fetches.append((token, request, frame))
        let answer = self.answer
        lock.unlock()
        fetched.signal()
        if let answer = answer {
            runner?.reply(token, request: request, body: answer(frame))
        }
    }

    func addProgress(_ done: Int64, _ total: Int64) {
        lock.lock()
        progress.append((done, total))
        lock.unlock()
    }

    func lastComplete() -> (UInt64, Data)? {
        lock.lock()
        defer { lock.unlock() }
        return completes.last
    }

    func completeCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return completes.count
    }

    func fetchFrames() -> [Data] {
        lock.lock()
        defer { lock.unlock() }
        return fetches.map { $0.2 }
    }

    func progressSeen() -> [(Int64, Int64)] {
        lock.lock()
        defer { lock.unlock() }
        return progress
    }
}

func makeRunner(_ recorder: Recorder, grace: TimeInterval = runnerCancelGraceSeconds)
    -> AnalysisRunner
{
    let runner = AnalysisRunner(
        hooks: RunnerHooks(
            fetch: { token, request, frame in recorder.fetch(token, request, frame) },
            complete: { token, data in recorder.complete(token, data) },
            progress: { _, done, total in recorder.addProgress(done, total) }
        ), cancelGrace: grace)
    recorder.runner = runner
    return runner
}

func llmReply(content: String) -> Data {
    let meta = try! JSONSerialization.data(withJSONObject: [
        "status": 200, "statusText": "OK", "headers": [["content-type", "application/json"]],
    ])
    let body = try! JSONSerialization.data(withJSONObject: [
        "choices": [["message": ["content": content]]]
    ])
    var frame = Data()
    withUnsafeBytes(of: UInt32(meta.count).littleEndian) { frame.append(contentsOf: $0) }
    frame.append(meta)
    frame.append(body)
    return frame
}

let orderContent =
    #"{"date":"2026-10-01","vendor":"Shop","items":[{"description":"A","amount":"1,200"}],"totalAmount":"1200"}"#

func orderSpec(_ text: String) -> String {
    let spec: [String: Any] = [
        "job": "job-1", "kind": "order", "engine": "openai-compatible", "locale": "ja",
        "notify": false,
        "adapter": ["model": "m", "apiKey": "", "baseUrl": "http://127.0.0.1:41741/v1"],
        "input": ["text": text],
    ]
    return String(decoding: try! JSONSerialization.data(withJSONObject: spec), as: UTF8.self)
}

func json(_ data: Data) -> [String: Any]? {
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
}

func waitComplete(_ recorder: Recorder, _ seconds: TimeInterval = 10) -> Bool {
    return recorder.completed.wait(timeout: .now() + seconds) == .success
}
// 専用スレッドの上で、最後の JSContext がもう手放されているかを見る。
func contextReleased(_ runner: AnalysisRunner) -> Bool {
    final class Flag: @unchecked Sendable { var released = false }
    let flag = Flag()
    let done = DispatchSemaphore(value: 0)
    runner.onRunnerThread {
        flag.released = runner.lastContext == nil
        done.signal()
    }
    _ = done.wait(timeout: .now() + 5)
    return flag.released
}

func requestBody(_ frame: Data) -> String {
    guard let parts = splitReply(frame) else {
        return ""
    }
    return parts.body
}

func requestMeta(_ frame: Data) -> [String: Any] {
    guard let parts = splitReply(frame) else {
        return [:]
    }
    return json(Data(parts.meta.utf8)) ?? [:]
}

func testRunsTheBundle(_ script: String) {
    let recorder = Recorder()
    recorder.answer = { _ in llmReply(content: orderContent) }
    let runner = makeRunner(recorder)
    runner.start(1, script: script, spec: orderSpec("注文 1,200 円"))
    check(waitComplete(recorder), "bundle: the job completes")
    let result = recorder.lastComplete().flatMap { json($0.1) }
    check(result?["outcome"] as? String == "done", "bundle: the outcome is done")
    let value = result?["result"] as? [String: Any]
    check(value?["vendor"] as? String == "Shop", "bundle: the vendor is parsed")
    check(value?["totalAmount"] as? String == "1200", "bundle: the total is parsed")
    let items = value?["items"] as? [[String: Any]]
    check(items?.first?["amount"] as? String == "1200", "bundle: item amounts are sanitised")
    let frame = recorder.fetchFrames().first ?? Data()
    let meta = requestMeta(frame)
    check(
        meta["url"] as? String == "http://127.0.0.1:41741/v1/chat/completions",
        "bundle: the request goes to the base URL")
    check(meta["method"] as? String == "POST", "bundle: the request is a POST")
    check(requestBody(frame).contains("注文 1,200 円"), "bundle: the pasted text is sent")
    let progress = recorder.progressSeen()
    check(
        progress.count == 2 && progress[0] == (0, 1) && progress[1] == (1, 1),
        "bundle: progress goes from 0 to 1")
    check(contextReleased(runner), "bundle: the context is released when the job ends")
}

func testInjectionStringsStayData(_ script: String) {
    let clean = Recorder()
    clean.answer = { _ in llmReply(content: orderContent) }
    let cleanRunner = makeRunner(clean)
    cleanRunner.start(1, script: script, spec: orderSpec("clean"))
    _ = waitComplete(clean)
    let hostile = "\"); throw 1; (\"\u{2028}`${globalThis.x}`\\"
    let dirty = Recorder()
    dirty.answer = { _ in llmReply(content: orderContent) }
    let dirtyRunner = makeRunner(dirty)
    dirtyRunner.start(2, script: script, spec: orderSpec(hostile))
    check(waitComplete(dirty), "injection: the job completes")
    let a = clean.lastComplete().flatMap { json($0.1) }?["result"] as? [String: Any]
    let b = dirty.lastComplete().flatMap { json($0.1) }?["result"] as? [String: Any]
    check(
        a != nil && NSDictionary(dictionary: a ?? [:]).isEqual(to: b ?? [:]),
        "injection: the result equals the clean spec's result")
    let body = json(Data(requestBody(dirty.fetchFrames().first ?? Data()).utf8))
    let messages = body?["messages"] as? [[String: Any]]
    let content = messages?.first?["content"] as? String ?? ""
    check(content.hasSuffix(hostile), "injection: the text reaches the request verbatim")
}

func testCancelDuringAPendingFetch(_ script: String) {
    let recorder = Recorder()
    let runner = makeRunner(recorder)
    runner.start(5, script: script, spec: orderSpec("x"))
    check(recorder.fetched.wait(timeout: .now() + 10) == .success, "cancel: the fetch is pending")
    runner.cancel(5)
    check(waitComplete(recorder, 3), "cancel: the job ends without waiting for the grace period")
    let result = recorder.lastComplete().flatMap { json($0.1) }
    check(recorder.lastComplete()?.0 == 5, "cancel: the token is reported")
    check(result?["outcome"] as? String == "cancelled", "cancel: the outcome is cancelled")
    check(contextReleased(runner), "cancel: the context is released")
}
// A1：開始が専用スレッドへ届く前に取消しが届いても、ジョブは終わり、次のジョブを始められる。
// Rust は取消し済みのジョブの通信に応答を返さないので、ここでも応答しない。
func testACancelQueuedBeforeRunStillEnds(_ script: String) {
    let recorder = Recorder()
    let runner = makeRunner(recorder)
    runner.cancel(31)
    runner.start(31, script: script, spec: orderSpec("x"))
    check(waitComplete(recorder, 3), "pre-run cancel: the job still ends")
    let first = recorder.lastComplete()
    let result = first.flatMap { json($0.1) }
    check(first?.0 == 31, "pre-run cancel: the token is reported")
    check(result?["outcome"] as? String == "cancelled", "pre-run cancel: the outcome is cancelled")
    check(recorder.fetchFrames().isEmpty, "pre-run cancel: nothing is sent")
    check(contextReleased(runner), "pre-run cancel: no context is left")
    recorder.answer = { _ in llmReply(content: orderContent) }
    runner.start(32, script: script, spec: orderSpec("y"))
    check(waitComplete(recorder), "pre-run cancel: the next job ends")
    let next = recorder.lastComplete()
    check(next?.0 == 32, "pre-run cancel: the next job reports its own token")
    check(
        next.flatMap { json($0.1) }?["outcome"] as? String == "done",
        "pre-run cancel: the next job is done")
}

func testFailedFetchIsAConnectionFailure(_ script: String) {
    let recorder = Recorder()
    recorder.answer = { _ in nil }
    let runner = makeRunner(recorder)
    runner.start(6, script: script, spec: orderSpec("x"))
    check(waitComplete(recorder), "connection: the job completes")
    let result = recorder.lastComplete().flatMap { json($0.1) }
    let error = result?["error"] as? [String: Any]
    check(result?["outcome"] as? String == "failed", "connection: the outcome is failed")
    check(error?["code"] as? String == "connection", "connection: the code is connection")
    check(error?["message"] == nil, "connection: no reason text is carried")
}
// A3：JSON でない 200 の応答は、web view（WebKit の Response.json()）と同じ文言で失敗する。
func testNonJsonReplyUsesTheWebViewText(_ script: String) {
    let recorder = Recorder()
    recorder.answer = { _ in
        let meta = try! JSONSerialization.data(withJSONObject: [
            "status": 200, "statusText": "OK", "headers": [["content-type", "text/html"]],
        ])
        var frame = Data()
        withUnsafeBytes(of: UInt32(meta.count).littleEndian) { frame.append(contentsOf: $0) }
        frame.append(meta)
        frame.append(Data("<html></html>".utf8))
        return frame
    }
    let runner = makeRunner(recorder)
    runner.start(7, script: script, spec: orderSpec("x"))
    check(waitComplete(recorder), "non-json: the job completes")
    let result = recorder.lastComplete().flatMap { json($0.1) }
    let error = result?["error"] as? [String: Any]
    check(result?["outcome"] as? String == "failed", "non-json: the outcome is failed")
    check(
        error?["message"] as? String == "The string did not match the expected pattern.",
        "non-json: the text matches the web view")
}

func testAThrownExceptionFails() {
    let recorder = Recorder()
    let runner = makeRunner(recorder)
    runner.start(
        7, script: marker + "globalThis.aoikoRunner = { run() { throw new Error('boom'); } };",
        spec: "{}")
    check(waitComplete(recorder), "exception: the job ends")
    check(recorder.lastComplete()?.1.isEmpty == true, "exception: no result is handed over")
    let broken = Recorder()
    let brokenRunner = makeRunner(broken)
    brokenRunner.start(8, script: marker + "throw new Error('at load');", spec: "{}")
    check(waitComplete(broken), "exception: a script that throws on load ends the job")
    check(broken.lastComplete()?.1.isEmpty == true, "exception: and hands over nothing")
    check(contextReleased(brokenRunner), "exception: the context is released")
}

func testANeverSettlingPromiseEndsOnCancel() {
    let recorder = Recorder()
    let runner = makeRunner(recorder, grace: 0.3)
    runner.start(
        9,
        script: marker
            + "globalThis.aoikoRunner = { run() { return new Promise(() => {}); }, abort() {} };",
        spec: "{}")
    check(!waitComplete(recorder, 0.5), "never settling: nothing ends before the cancel")
    runner.cancel(9)
    check(waitComplete(recorder, 3), "never settling: the cancel ends the job")
    let result = recorder.lastComplete().flatMap { json($0.1) }
    check(result?["outcome"] as? String == "cancelled", "never settling: the outcome is cancelled")
    check(contextReleased(runner), "never settling: the context is released")
}

func testTimersRejectNonFunctions() {
    let recorder = Recorder()
    let runner = makeRunner(recorder)
    let script =
        marker + """
        globalThis.aoikoRunner = { run() {
          try { aoikoHost.setTimeout('globalThis.hit = 1', 0); return Promise.resolve('no-throw'); }
          catch (e) { return new Promise((r) => aoikoHost.setTimeout(() => r('timer-ok'), 10)); }
        } };
        """
    runner.start(10, script: script, spec: "{}")
    check(waitComplete(recorder), "timers: the job completes")
    let text = String(decoding: recorder.lastComplete()?.1 ?? Data(), as: UTF8.self)
    check(text == "timer-ok", "timers: a string first argument throws and a function fires")
}

func testEachJobGetsAFreshContext() {
    let recorder = Recorder()
    let runner = makeRunner(recorder)
    let script =
        marker
        + "globalThis.aoikoRunner = { run() { const seen = String(globalThis.leak); globalThis.leak = 1; return Promise.resolve(seen); } };"
    runner.start(11, script: script, spec: "{}")
    _ = waitComplete(recorder)
    runner.start(12, script: script, spec: "{}")
    _ = waitComplete(recorder)
    let text = String(decoding: recorder.lastComplete()?.1 ?? Data(), as: UTF8.self)
    check(text == "undefined", "fresh context: nothing carries over between jobs")
    check(recorder.completeCount() == 2, "fresh context: both jobs completed")
}

func testRequestFrameIsBuiltFromParsedJson() {
    let context = JSContext()!
    let request = JSValue(
        object: #"{"url":"http://x/\"a","method":"POST","headers":[["a","b\"c"]]}"#, in: context)
    let body = JSValue(object: "{}", in: context)
    let frame = requestFrame(request, body: body) ?? Data()
    let meta = requestMeta(frame)
    check(meta["url"] as? String == "http://x/\"a", "frame: the url survives escaping")
    check((meta["headers"] as? [[String]])?.first == ["a", "b\"c"], "frame: headers survive")
    check(requestBody(frame) == "{}", "frame: the body follows the meta")
    let bad = JSValue(object: #"{"url":1}"#, in: context)
    check(requestFrame(bad, body: body) == nil, "frame: a malformed request is refused")
    check(splitReply(Data([9, 0, 0, 0, 1])) == nil, "frame: a reply shorter than its meta is refused")
    check(splitReply(Data([255, 255, 255, 255])) == nil, "frame: a huge meta length is refused")
}

@main
struct AnalysisRunnerTests {
    static func main() {
        guard CommandLine.arguments.count >= 2,
            let script = try? String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        else {
            report("FAILED: runner.js のパスが渡されていない")
            exit(1)
        }
        check(script.hasPrefix(marker), "bundle: runner.js starts with the marker")
        testRunsTheBundle(script)
        testInjectionStringsStayData(script)
        testCancelDuringAPendingFetch(script)
        testACancelQueuedBeforeRunStillEnds(script)
        testFailedFetchIsAConnectionFailure(script)
        testNonJsonReplyUsesTheWebViewText(script)
        testAThrownExceptionFails()
        testANeverSettlingPromiseEndsOnCancel()
        testTimersRejectNonFunctions()
        testEachJobGetsAFreshContext()
        testRequestFrameIsBuiltFromParsedJson()

        let failureCount = failures.read()
        if failureCount > 0 {
            report("FAILED: \(failureCount) check(s) failed")
            exit(1)
        }
        report("All AnalysisRunner tests passed")
    }
}