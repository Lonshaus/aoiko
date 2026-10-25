import CoreGraphics
import Foundation
import ImageIO
import JavaScriptCore
// 端末内のエンジン（tesseract・OS の文字認識・OS の AI）を AnalysisRunner で動かすテスト。
// 引数は test-swift.mjs が渡す：runner.js、fixtures のディレクトリ、tesseract-core.wasm、
// tesseract-core-fallback.wasm、jpn.traineddata。期待値は web view の経路で取った参照の JSON。
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

final class Box<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: T

    init(_ value: T) {
        self.value = value
    }

    func get() -> T {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func update(_ change: (inout T) -> Void) {
        lock.lock()
        change(&value)
        lock.unlock()
    }
}

final class Completion: @unchecked Sendable {
    let done = DispatchSemaphore(value: 0)
    let outcome = Box<Data?>(nil)
    let count = Box(0)

    func record(_ data: Data) {
        outcome.update { $0 = data }
        count.update { $0 += 1 }
        done.signal()
    }

    func wait(_ seconds: TimeInterval) -> [String: Any]? {
        guard done.wait(timeout: .now() + seconds) == .success, let data = outcome.get() else {
            return nil
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}

struct Paths {
    let runner: String
    let fixtures: URL
    let core: URL
    let fallback: URL
    let traineddata: URL
}

func bytes(_ url: URL) -> OwnedBytes? {
    guard let data = try? Data(contentsOf: url) else {
        return nil
    }
    return data.withUnsafeBytes { raw in
        raw.baseAddress.flatMap { OwnedBytes(copying: $0, count: raw.count) }
    }
}

func makeRunner(
    _ completion: Completion, local: LocalEngineHooks, wasmCheck: @escaping @Sendable () -> Bool = {
        true
    }
) -> AnalysisRunner {
    return AnalysisRunner(
        hooks: RunnerHooks(
            fetch: { _, _, _ in },
            complete: { _, data in completion.record(data) },
            progress: { _, _, _ in },
            local: local),
        wasmCheck: wasmCheck)
}

func spec(engine: String, kind: String = "receipt", mimeType: String = "image/png") -> String {
    var spec: [String: Any] = [
        "job": "job-1", "kind": kind, "engine": engine, "locale": "ja", "notify": false,
    ]
    switch kind {
    case "receipt":
        spec["input"] = ["image": ["base64": "AAAA", "mimeType": mimeType]]
    case "order":
        spec["input"] = ["text": "注文"]
    default:
        spec["input"] = [
            "groups": [
                [
                    "knownSide": "debit",
                    "inputs": [["ref": "0", "description": "コンビニ", "amount": "1200"]],
                    "options": [
                        "knownAccountCode": "1130", "knownSide": "debit",
                        "candidateAccounts": [
                            ["code": "5200", "name": "消耗品費", "category": "expense"]
                        ],
                    ],
                ]
            ]
        ]
    }
    return String(decoding: try! JSONSerialization.data(withJSONObject: spec), as: UTF8.self)
}

func reference(_ paths: Paths, _ file: String, _ engine: String) -> NSDictionary? {
    let url = paths.fixtures.appendingPathComponent("\(file).\(engine).json")
    guard let data = try? Data(contentsOf: url) else {
        return nil
    }
    return (try? JSONSerialization.jsonObject(with: data)) as? NSDictionary
}

let fixtureFiles = ["receipt-a.png", "receipt-a.jpg", "receipt-a-exif6.jpg"]
// JSContext で WebAssembly の SIMD を検証できるか（tesseract-wasm の supportsFastBuild と同じ判定）。
func jscSupportsSimd() -> Bool {
    let context = JSContext()!
    let result = context.evaluateScript(
        "WebAssembly.validate(Uint8Array.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]))"
    )
    return result?.toBool() ?? false
}
// 両方のビルドを順に使わせる（どちらの番号を求められても、選んだほうの Wasm を返す）。
func testTesseractMatchesTheReference(_ paths: Paths, script: String) {
    let expectFast = jscSupportsSimd()
    for build in ["tesseract-core", "tesseract-core-fallback"] {
        let wasm = build == "tesseract-core" ? paths.core : paths.fallback
        for file in fixtureFiles {
            guard let image = try? Data(contentsOf: paths.fixtures.appendingPathComponent(file)),
                let expected = reference(paths, file, "tesseract")
            else {
                check(false, "tesseract \(build) \(file): fixture and reference exist")
                continue
            }
            let requested = Box<[UInt32]>([])
            let local = LocalEngineHooks(
                asset: { code in
                    requested.update { $0.append(code) }
                    return code == 3 ? bytes(paths.traineddata) : bytes(wasm)
                },
                ai: { _, _ in .failed(4) }, aiAvailability: { 4 },
                recognize: { _ in .failure(.failed("")) })
            let completion = Completion()
            let runner = makeRunner(completion, local: local)
            let started = Date()
            runner.start(1, script: script, spec: spec(engine: "tesseract"), engine: 1, image: image)
            let outcome = completion.wait(120)
            let seconds = Date().timeIntervalSince(started)
            let result = outcome?["result"] as? NSDictionary
            check(
                outcome?["outcome"] as? String == "done" && result == expected,
                "tesseract \(build) \(file): runner result equals the web view reference (\(String(format: "%.1f", seconds)) s)"
            )
            check(
                requested.get().first == (expectFast ? 1 : 2) && requested.get().contains(3),
                "tesseract \(build) \(file): the bundle chose the build by supportsFastBuild (fast=\(expectFast))"
            )
        }
    }
}
// プラグインのコマンドと同じ runTextRecognition を使う。
func testNativeMatchesTheReference(_ paths: Paths, script: String) {
    for file in fixtureFiles {
        guard let image = try? Data(contentsOf: paths.fixtures.appendingPathComponent(file)),
            let expected = reference(paths, file, "native")
        else {
            check(false, "native \(file): fixture and reference exist")
            continue
        }
        let local = LocalEngineHooks(
            asset: { _ in nil }, ai: { _, _ in .failed(4) }, aiAvailability: { 4 },
            recognize: { data in runTextRecognition(on: data) })
        let completion = Completion()
        let runner = makeRunner(completion, local: local)
        runner.start(1, script: script, spec: spec(engine: "native"), engine: 2, image: image)
        let outcome = completion.wait(60)
        check(
            outcome?["outcome"] as? String == "done" && outcome?["result"] as? NSDictionary == expected,
            "native \(file): runner result equals extractFromOcrLayout over the Mac recognition")
    }
}

func testRecognitionFailuresUseFixedCodes(script: String) {
    for (failure, expected) in [
        (TextRecognitionFailure.noText, "テキストが見つかりません"),
        (TextRecognitionFailure.failed("Vision の内部の説明"), "文字を認識できませんでした。もう一度お試しください。"),
    ] {
        let local = LocalEngineHooks(
            asset: { _ in nil }, ai: { _, _ in .failed(4) }, aiAvailability: { 4 },
            recognize: { _ in .failure(failure) })
        let completion = Completion()
        let runner = makeRunner(completion, local: local)
        runner.start(1, script: script, spec: spec(engine: "native"), engine: 2, image: Data([1]))
        let error = completion.wait(10)?["error"] as? [String: Any]
        check(
            error?["code"] as? String == "error" && error?["message"] as? String == expected,
            "native: \(failure) ends as error with the fixed message and no Vision text")
    }
}

final class AiFake: @unchecked Sendable {
    let gate = DispatchSemaphore(value: 0)
    let entered = DispatchSemaphore(value: 0)
    let threads = Box<[String]>([])
    let payloads = Box<[Data]>([])
    let answer: RunnerAiAnswer
    let blocks: Bool

    init(answer: RunnerAiAnswer, blocks: Bool = false) {
        self.answer = answer
        self.blocks = blocks
    }

    func call(_ payload: Data) -> RunnerAiAnswer {
        let name = Thread.isMainThread ? "main" : (Thread.current.name ?? "")
        threads.update { $0.append(name) }
        payloads.update { $0.append(payload) }
        entered.signal()
        if blocks {
            gate.wait()
        }
        return answer
    }
}

func testAppleAiReceiptMapsLikeTheWebView(script: String) {
    let receipt =
        #"{"vendor":"あおい薬局","date":"2026-05-14","total":"248","invoiceNumber":"1234567890123","amount8":"248","amount10":"","items":[{"name":"水","amount":"248"},{"name":"","amount":"1"}]}"#
    let fake = AiFake(answer: .json(receipt))
    let image = Data([7, 8, 9])
    let local = LocalEngineHooks(
        asset: { _ in nil }, ai: { _, payload in fake.call(payload) }, aiAvailability: { 0 },
        recognize: { _ in .failure(.failed("")) })
    let completion = Completion()
    let runner = makeRunner(completion, local: local)
    runner.start(1, script: script, spec: spec(engine: "apple-ai"), engine: 3, image: image)
    let outcome = completion.wait(10)
    let expected: NSDictionary = [
        "date": "2026-05-14", "vendorName": "あおい薬局", "totalAmount": "248",
        "items": [["description": "水", "amount": "248"]], "invoiceNumber": "T1234567890123",
    ]
    check(
        outcome?["outcome"] as? String == "done" && outcome?["result"] as? NSDictionary == expected,
        "apple-ai receipt: mapped like apple-ai-engine.ts")
    check(fake.payloads.get() == [image], "apple-ai receipt: the image comes from the start, not the bundle")
    check(
        fake.threads.get().allSatisfy { $0 != "main" && $0 != "aoiko-runner" },
        "apple-ai receipt: the native call runs off the runner thread and off the main thread")
}

func testAppleAiAvailabilityStopsBeforeExtract(script: String) {
    let fake = AiFake(answer: .json("{}"))
    let local = LocalEngineHooks(
        asset: { _ in nil }, ai: { _, payload in fake.call(payload) }, aiAvailability: { 2 },
        recognize: { _ in .failure(.failed("")) })
    let completion = Completion()
    let runner = makeRunner(completion, local: local)
    runner.start(1, script: script, spec: spec(engine: "apple-ai"), engine: 3, image: Data([1]))
    let error = completion.wait(10)?["error"] as? [String: Any]
    check(
        error?["code"] as? String == "error" && fake.payloads.get().isEmpty,
        "apple-ai receipt: an unavailable model fails before the extract call")
}

func testAppleAiBusyHoldsUntilTheCallReturns(script: String) {
    let order = #"{"date":"2026-10-01","vendor":"Shop","items":[{"description":"A","amount":"1200"}],"totalAmount":"1200"}"#
    let fake = AiFake(answer: .json(order), blocks: true)
    let local = LocalEngineHooks(
        asset: { _ in nil }, ai: { _, payload in fake.call(payload) }, aiAvailability: { 0 },
        recognize: { _ in .failure(.failed("")) })
    let completion = Completion()
    let runner = makeRunner(completion, local: local)
    runner.start(1, script: script, spec: spec(engine: "apple-ai", kind: "order"))
    check(fake.entered.wait(timeout: .now() + 10) == .success, "apple-ai order: the native call started")
    check(
        completion.done.wait(timeout: .now() + 1) == .timedOut,
        "apple-ai order: the job does not end while the native call has not returned")
    fake.gate.signal()
    let outcome = completion.wait(10)
    check(outcome?["outcome"] as? String == "done", "apple-ai order: the job ends once the call returns")
    let payload = fake.payloads.get().first.flatMap {
        (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any]
    }
    check(payload?["text"] as? String == "注文", "apple-ai order: the data string reaches the native call")
}

func testAppleAiRunFailureCodes(script: String) {
    let fake = AiFake(answer: .failed(7))
    let local = LocalEngineHooks(
        asset: { _ in nil }, ai: { _, payload in fake.call(payload) }, aiAvailability: { 0 },
        recognize: { _ in .failure(.failed("")) })
    let completion = Completion()
    let runner = makeRunner(completion, local: local)
    runner.start(1, script: script, spec: spec(engine: "apple-ai", kind: "classify"))
    let error = completion.wait(10)?["error"] as? [String: Any]
    check(
        error?["code"] as? String == "llm"
            && error?["message"] as? String
                == "入力データが大きすぎて処理できません。件数を減らして、もう一度お試しください。",
        "apple-ai classify: code 7 gives the same message as the web view path")
}

final class FakeScheduler: BackgroundScheduling, @unchecked Sendable {
    let calls = Box<[String]>([])

    func isAppActive() -> Bool { true }

    func supportsContinuedProcessing() -> Bool { true }

    func register(_ identifier: String, launch: @escaping @Sendable (ContinuedTaskHandle) -> Void)
        -> Bool
    {
        calls.update { $0.append("register") }
        return true
    }

    func submit(_ identifier: String, title: String, subtitle: String) -> Bool {
        calls.update { $0.append("submit") }
        return true
    }

    func beginBackgroundTask(expiration: @escaping @Sendable () -> Void) -> Int {
        calls.update { $0.append("begin") }
        return 1
    }

    func endBackgroundTask(_ id: Int) {
        calls.update { $0.append("end") }
    }
}
// 1 bit の灰色の PNG。画素数が大きくても数十 KB に収まり、寸法は画像の情報から読める。
func pngHeader(width: Int, height: Int) -> Data {
    let row = (width + 7) / 8
    let out = NSMutableData()
    guard let provider = CGDataProvider(data: Data(count: row * height) as CFData),
        let image = CGImage(
            width: width, height: height, bitsPerComponent: 1, bitsPerPixel: 1, bytesPerRow: row,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
        let destination = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil)
    else {
        return Data()
    }
    CGImageDestinationAddImage(destination, image, nil)
    return CGImageDestinationFinalize(destination) ? out as Data : Data()
}

func testStartRefusalsLeaveNothing(_ paths: Paths, script: String) {
    check(runnerMaxImagePixels == 50_000_000, "limit: 50,000,000 pixels")
    check(runnerWasmWaitSeconds == 5, "wasm: a pending check is waited for at most 5 s")
    check(runnerPixelsWithinLimit(width: 10_000, height: 5_000), "limit: exactly 50,000,000 accepted")
    check(!runnerPixelsWithinLimit(width: 50_000_001, height: 1), "limit: one more pixel refused")
    check(!runnerPixelsWithinLimit(width: Int.max, height: 2), "limit: overflow refused")
    check(!runnerPixelsWithinLimit(width: 0, height: 10), "limit: zero refused")
    let fixture = (try? Data(contentsOf: paths.fixtures.appendingPathComponent("receipt-a.png"))) ?? Data()
    let cases: [(String, UInt32, Data, Bool, Int32)] = [
        ("over-limit tesseract", 1, pngHeader(width: 10_000, height: 5_001), true, 2),
        ("over-limit native", 2, pngHeader(width: 10_000, height: 5_001), true, 2),
        ("over-limit apple-ai", 3, pngHeader(width: 10_000, height: 5_001), true, 2),
        ("missing dimensions", 1, Data("not an image".utf8), true, 2),
        ("failed wasm tesseract", 1, fixture, false, 2),
        ("failed wasm native ignores it", 2, fixture, false, 0),
        ("failed wasm apple-ai ignores it", 3, fixture, false, 0),
        ("tesseract at the limit header", 1, pngHeader(width: 10_000, height: 5_000), true, 0),
        ("image for an llm job", 0, fixture, true, 1),
        ("no image for a local job", 1, Data(), true, 1),
        ("unknown engine", 9, fixture, true, 1),
    ]
    for (name, engine, image, wasm, expected) in cases {
        let scheduler = FakeScheduler()
        let queue = DispatchQueue(label: "background-test")
        let background = BackgroundTime(scheduler: scheduler, queue: queue, onExpired: { _ in })
        let completion = Completion()
        let runner = makeRunner(completion, local: .unavailable, wasmCheck: { wasm })
        let answer = startRunnerJob(
            runner: runner, background: background, token: 1, script: Data(script.utf8),
            spec: Data(spec(engine: "tesseract").utf8), title: "t", subtitle: "s", engine: engine,
            image: engine == 0 ? image : (image.isEmpty ? nil : image))
        check(answer == expected, "start: \(name) answers \(expected) (got \(answer))")
        Thread.sleep(forTimeInterval: 0.2)
        queue.sync {}
        if expected != 0 {
            check(
                scheduler.calls.get().isEmpty && runner.lastContext == nil
                    && completion.count.get() == 0,
                "start: \(name) leaves no background time, no queued run and no context")
        } else {
            check(
                !scheduler.calls.get().isEmpty,
                "start: \(name) takes background time (control for the refusal checks)")
        }
    }
}

func testAPendingWasmCheckIsWaitedForFiveSeconds(script: String) {
    let fixture = pngHeader(width: 10, height: 10)
    for (name, delay, expected) in [("finishes within the wait", 1.0, Int32(0)), ("still pending", 7.0, Int32(2))]
    {
        let scheduler = FakeScheduler()
        let background = BackgroundTime(scheduler: scheduler, queue: .main, onExpired: { _ in })
        let runner = makeRunner(
            Completion(), local: .unavailable,
            wasmCheck: {
                Thread.sleep(forTimeInterval: delay)
                return true
            })
        let started = Date()
        let answer = startRunnerJob(
            runner: runner, background: background, token: 1, script: Data(script.utf8),
            spec: Data(spec(engine: "tesseract").utf8), title: "t", subtitle: "s", engine: 1,
            image: fixture)
        let waited = Date().timeIntervalSince(started)
        check(answer == expected, "wasm: a check that \(name) answers \(expected) (got \(answer))")
        if expected == 2 {
            check(waited >= 4.9 && waited < 6.5, "wasm: the start waited about 5 s (\(waited))")
        }
    }
}

func testTheTinyWasmCheckRunsHere() {
    check(runTinyWasmCheck(), "wasm: the inline module compiles and runs in JSContext")
}

func testAssetNamesAreExactlyThree() {
    check(runnerAssetCode("tesseract-core") == 1, "asset: tesseract-core is 1")
    check(runnerAssetCode("tesseract-core-fallback") == 2, "asset: tesseract-core-fallback is 2")
    check(runnerAssetCode("jpn-traineddata") == 3, "asset: jpn-traineddata is 3")
    for name in ["runner", "native-runner/runner.js", "../index.html", "", "Tesseract-Core"] {
        check(runnerAssetCode(name) == nil, "asset: \(name) has no code")
    }
}

func testAnUnknownAssetNameNeverReachesTheHook(script: String) {
    let asked = Box(0)
    let local = LocalEngineHooks(
        asset: { _ in
            asked.update { $0 += 1 }
            return nil
        }, ai: { _, _ in .failed(4) }, aiAvailability: { 4 }, recognize: { _ in .failure(.noText) })
    let completion = Completion()
    let runner = makeRunner(completion, local: local)
    runner.start(1, script: script, spec: spec(engine: "tesseract"), engine: 1, image: pngHeader(width: 2, height: 2))
    let error = completion.wait(30)?["error"] as? [String: Any]
    check(
        error?["code"] as? String == "error"
            && error?["message"] as? String
                == "端末内の文字認識を実行できなかったため、解析できませんでした。もう一度お試しください。",
        "tesseract: a failure after start ends as error with the fixed message")
    check(asked.get() <= 1, "tesseract: the hook is asked at most once before failing")
}

@main
struct LocalEngineTests {
    static func main() {
        let args = CommandLine.arguments
        guard args.count >= 6, let script = try? String(contentsOfFile: args[1], encoding: .utf8) else {
            report("FAILED: 引数が足りない")
            exit(1)
        }
        let paths = Paths(
            runner: args[1], fixtures: URL(fileURLWithPath: args[2], isDirectory: true),
            core: URL(fileURLWithPath: args[3]), fallback: URL(fileURLWithPath: args[4]),
            traineddata: URL(fileURLWithPath: args[5]))
        testTheTinyWasmCheckRunsHere()
        testAssetNamesAreExactlyThree()
        testTesseractMatchesTheReference(paths, script: script)
        testNativeMatchesTheReference(paths, script: script)
        testRecognitionFailuresUseFixedCodes(script: script)
        testAppleAiReceiptMapsLikeTheWebView(script: script)
        testAppleAiAvailabilityStopsBeforeExtract(script: script)
        testAppleAiBusyHoldsUntilTheCallReturns(script: script)
        testAppleAiRunFailureCodes(script: script)
        testStartRefusalsLeaveNothing(paths, script: script)
        testAPendingWasmCheckIsWaitedForFiveSeconds(script: script)
        testAnUnknownAssetNameNeverReachesTheHook(script: script)
        let failureCount = failures.read()
        if failureCount > 0 {
            report("FAILED: \(failureCount) check(s) failed")
            exit(1)
        }
        report("All LocalEngine tests passed")
    }
}