import Foundation
// AnalysisNotify の純粋な部分のテスト。通知センターへ触れる入口は、.app に収まった
// プロセスでしか動かないのでここでは呼ばない（呼ぶと落ちる。それを避けるのが isAppBundle）。
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

func testIsAppBundle() {
    check(
        isAppBundle(URL(fileURLWithPath: "/Applications/aoiko.app"), identifier: "example.aoiko"),
        "isAppBundle: a .app URL with a bundle id is a bundle"
    )
    check(
        isAppBundle(URL(fileURLWithPath: "/Applications/aoiko.app/"), identifier: "example.aoiko"),
        "isAppBundle: a trailing slash does not change the answer"
    )
    check(
        !isAppBundle(URL(fileURLWithPath: "/work/target/debug/aoiko"), identifier: nil),
        "isAppBundle: a bare binary path without a bundle id is not a bundle"
    )
    check(
        !isAppBundle(URL(fileURLWithPath: "/work/target/debug/aoiko"), identifier: "example.aoiko"),
        "isAppBundle: a bare binary path is not a bundle even with an embedded bundle id"
    )
    check(
        !isAppBundle(URL(fileURLWithPath: "/Applications/aoiko.app"), identifier: nil),
        "isAppBundle: a .app URL without a bundle id is not a bundle"
    )
    check(
        !isAppBundle(URL(fileURLWithPath: "/Applications/aoiko.app"), identifier: ""),
        "isAppBundle: an empty bundle id is not a bundle id"
    )
    check(
        !isAppBundle(URL(fileURLWithPath: "/Applications/aoiko.app/Contents/PlugIns/x.appex"), identifier: "example.x"),
        "isAppBundle: an .appex is not an app bundle"
    )
    check(
        !isAppBundle(URL(fileURLWithPath: "/Applications/aoiko.framework"), identifier: "example.aoiko"),
        "isAppBundle: another extension is not an app bundle"
    )
    check(
        !isAppBundle(URL(fileURLWithPath: "/Applications/aoiko.APP"), identifier: "example.aoiko"),
        "isAppBundle: the extension is compared exactly"
    )
}

func testKindMapping() {
    check(analysisKindName(0) == "receipt", "kind: 0 is receipt")
    check(analysisKindName(1) == "order", "kind: 1 is order")
    check(analysisKindName(2) == "classify", "kind: 2 is classify")
    check(analysisKindName(3) == nil, "kind: an unknown index has no name")
    check(analysisKindName(-1) == nil, "kind: a negative index has no name")
    for index in Int32(0)..<3 {
        let name = analysisKindName(index) ?? ""
        check(analysisKindIndex(name) == index, "kind: index \(index) round-trips through its name")
    }
    check(analysisKindIndex("RECEIPT") == nil, "kind: names are matched exactly")
    check(analysisKindIndex("/receipt") == nil, "kind: a route is not a kind")
    check(analysisKindIndex("") == nil, "kind: an empty name is not a kind")
}

@main
struct AnalysisNotifyTests {
    static func main() {
        testIsAppBundle()
        testKindMapping()

        let failureCount = failures.read()
        if failureCount > 0 {
            report("FAILED: \(failureCount) check(s) failed")
            exit(1)
        }
        report("All AnalysisNotify tests passed")
    }
}