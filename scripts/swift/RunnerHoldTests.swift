import Foundation
// RunnerHold.swift（受け入れ試験だけが使う待ちの宛先の検査と通信の設定）のテスト。
// 第 1 引数は AnalysisRunner.swift のパス。待ちを使う書き方がすべて DEBUG かつシミュレータの区画の中に
// あることをソースで確かめる。
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

func testOnlyTheCanonicalUrlIsAccepted() {
    check(
        runnerHoldURL("http://127.0.0.1:41741/ctl/hold")?.absoluteString
            == "http://127.0.0.1:41741/ctl/hold", "hold: the canonical URL is accepted")
    check(runnerHoldURL("http://127.0.0.1:1024/ctl/hold") != nil, "hold: port 1024 is accepted")
    check(runnerHoldURL("http://127.0.0.1:65535/ctl/hold") != nil, "hold: port 65535 is accepted")
    for raw in [
        nil,
        "",
        "http://127.0.0.1:10708/ctl/hold",
        "http://127.0.0.1:31527/ctl/hold",
        "http://127.0.0.1:1023/ctl/hold",
        "http://127.0.0.1:65536/ctl/hold",
        "http://127.0.0.1/ctl/hold",
        "http://localhost:41741/ctl/hold",
        "http://127.1:41741/ctl/hold",
        "http://[::1]:41741/ctl/hold",
        "http://127.0.0.1@x.example/",
        "http://u:p@127.0.0.1:41741/ctl/hold",
        "http://127.0.0.1@127.0.0.1:41741/ctl/hold",
        "https://127.0.0.1:41741/ctl/hold",
        "HTTP://127.0.0.1:41741/ctl/hold",
        "http://127.0.0.1:41741/ctl/ref",
        "http://127.0.0.1:41741/ctl/hold/",
        "http://127.0.0.1:41741/ctl/%68old",
        "http://127.0.0.1:41741/ctl/hold?x=1",
        "http://127.0.0.1:41741/ctl/hold#x",
        "http://127.0.0.1:041741/ctl/hold",
        " http://127.0.0.1:41741/ctl/hold",
    ] as [String?] {
        check(runnerHoldURL(raw) == nil, "hold: \(raw ?? "nil") is refused")
    }
}

func testTheSessionUsesNoProxyAndRefusesRedirects() {
    let configuration = runnerHoldSessionConfiguration()
    check(
        (configuration.connectionProxyDictionary as NSDictionary?) == NSDictionary(),
        "hold: no proxy is used")
    check(configuration.timeoutIntervalForRequest == runnerHoldTimeoutSeconds, "hold: the request has a timeout")
    let session = URLSession(configuration: .ephemeral)
    let task = session.dataTask(with: URL(string: "http://127.0.0.1:41741/ctl/hold")!)
    let response = HTTPURLResponse(
        url: URL(string: "http://127.0.0.1:41741/ctl/hold")!, statusCode: 302, httpVersion: nil,
        headerFields: ["Location": "http://192.0.2.1/"])!
    let followed = DispatchSemaphore(value: 0)
    final class Seen: @unchecked Sendable {
        var request: URLRequest??
    }
    let seen = Seen()
    RunnerHoldRedirectRefusal().urlSession(
        session, task: task, willPerformHTTPRedirection: response,
        newRequest: URLRequest(url: URL(string: "http://192.0.2.1/")!)
    ) { request in
        seen.request = .some(request)
        followed.signal()
    }
    _ = followed.wait(timeout: .now() + 2)
    check(seen.request != nil && seen.request! == nil, "hold: a redirect is refused")
    task.cancel()
    session.invalidateAndCancel()
}
// 区画の外に、待ちの宛先を読む・送る・セッションを作る書き方が無いこと。
func testTheHoldLivesOnlyInsideTheDebugSimulatorBlock(_ source: String) {
    let opener = "#if DEBUG && targetEnvironment(simulator)"
    var inside = false
    var outside = ""
    var within = ""
    for line in source.split(separator: "\n", omittingEmptySubsequences: false) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed == opener {
            inside = true
            continue
        }
        if inside && trimmed == "#endif" {
            inside = false
            continue
        }
        if inside {
            within += line + "\n"
        } else {
            outside += line + "\n"
        }
    }
    for needle in ["AOIKO_RUNNER_TEST_HOLD", "runnerTestHold(", "URLSession(", "URLSession", "runnerHoldURL("] {
        check(!outside.contains(needle), "hold pin: \(needle) appears only inside the block")
    }
    check(within.contains("ProcessInfo.processInfo.environment[\"AOIKO_RUNNER_TEST_HOLD\"]"), "hold pin: the env read is inside")
    check(within.contains("runnerTestHold(job, outcome: outcome)"), "hold pin: the call site is inside")
    check(within.components(separatedBy: "URLSession(").count == 2, "hold pin: exactly one session is created, inside")
    check(within.contains("delegate: RunnerHoldRedirectRefusal()"), "hold pin: the session refuses redirects")
    check(within.contains("runnerHoldSessionConfiguration()"), "hold pin: the session uses the proxy-free configuration")
    let keys = ["\"engine\":", "\"wasmBuild\":", "\"inputSha256\":", "\"result\":", "\"recognized\":"]
    let payload = within.components(separatedBy: "let payload: [String: Any] = [").dropFirst().first?
        .components(separatedBy: "]\n").first ?? ""
    check(keys.allSatisfy { payload.contains($0) }, "hold pin: the payload has the five keys")
    check(payload.components(separatedBy: "\":").count - 1 == 5, "hold pin: the payload has no other key")
    check(!payload.contains("spec") && !payload.contains("adapter"), "hold pin: no spec or adapter field")
}

@main
struct RunnerHoldTests {
    static func main() {
        guard CommandLine.arguments.count >= 2,
            let source = try? String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        else {
            report("FAILED: AnalysisRunner.swift のパスが渡されていない")
            exit(1)
        }
        testOnlyTheCanonicalUrlIsAccepted()
        testTheSessionUsesNoProxyAndRefusesRedirects()
        testTheHoldLivesOnlyInsideTheDebugSimulatorBlock(source)
        let failureCount = failures.read()
        if failureCount > 0 {
            report("FAILED: \(failureCount) check(s) failed")
            exit(1)
        }
        report("All RunnerHold tests passed")
    }
}