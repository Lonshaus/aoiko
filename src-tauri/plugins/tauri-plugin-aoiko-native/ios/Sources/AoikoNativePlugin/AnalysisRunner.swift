import CoreGraphics
import Foundation
import ImageIO
import JavaScriptCore

#if DEBUG && targetEnvironment(simulator)
    import CryptoKit
#endif
// 解析の本体（runner.js）を web view の外で走らせる。web view は裏に回ると止められるが、
// アプリのプロセスのスレッドは背景の時間が続く限り動ける。
//
// 評価するスクリプトは Rust が固定のアセット名で読んだ runner.js だけ。仕様と通信の応答は
// JSValue の引数として渡し、スクリプトの文字列へ埋め込まない。JSContext はジョブごとに作り直し、
// 専用スレッドでしか触らない。Rust へ渡すのは整数の識別子とバイト列だけで、JSValue は渡さない。
//
// 端末内のエンジン（tesseract・OS の文字認識・OS の AI）も同じ JSContext で動かす。画像は Rust が
// 復号して開始のときに渡したものだけを使い、runner.js から画像やファイルの名前は受け取らない。
struct RunnerHooks: Sendable {
    let fetch: @Sendable (UInt64, UInt64, Data) -> Void
    let complete: @Sendable (UInt64, Data) -> Void
    let progress: @Sendable (UInt64, Int64, Int64) -> Void
    let local: LocalEngineHooks

    init(
        fetch: @escaping @Sendable (UInt64, UInt64, Data) -> Void,
        complete: @escaping @Sendable (UInt64, Data) -> Void,
        progress: @escaping @Sendable (UInt64, Int64, Int64) -> Void,
        local: LocalEngineHooks = .unavailable
    ) {
        self.fetch = fetch
        self.complete = complete
        self.progress = progress
        self.local = local
    }
}
/// OS の AI の答え。失敗は AppleIntelligence.swift と同じ数値のコード。
enum RunnerAiAnswer: Sendable {
    case json(String)
    case failed(Int32)
}
/// 端末内のエンジンへの出口。本番は Rust（アセット・OS の AI）と TextRecognition.swift、試験は偽物。
struct LocalEngineHooks: Sendable {
    let asset: @Sendable (UInt32) -> OwnedBytes?
    let ai: @Sendable (UInt64, Data) -> RunnerAiAnswer
    let aiAvailability: @Sendable () -> Int32
    let recognize: @Sendable (Data) -> Result<RecognizedText, TextRecognitionFailure>

    static let unavailable = LocalEngineHooks(
        asset: { _ in nil },
        ai: { _, _ in .failed(4) },
        aiAvailability: { 4 },
        recognize: { _ in .failure(.failed("")) })
}
/// Swift が malloc で確保した領域。ArrayBuffer に渡したらそちらが free で解放し、渡さなければ自分で解放する。
final class OwnedBytes: @unchecked Sendable {
    private var pointer: UnsafeMutableRawPointer?
    let count: Int

    init?(copying source: UnsafeRawPointer, count: Int) {
        guard count > 0, let pointer = malloc(count) else {
            return nil
        }
        pointer.copyMemory(from: source, byteCount: count)
        self.pointer = pointer
        self.count = count
    }

    init?(zeroedCount count: Int) {
        guard count > 0, let pointer = calloc(count, 1) else {
            return nil
        }
        self.pointer = pointer
        self.count = count
    }

    var bytes: UnsafeMutableRawPointer? { pointer }

    func handOff() -> UnsafeMutableRawPointer? {
        defer { pointer = nil }
        return pointer
    }

    deinit {
        free(pointer)
    }
}
// アプリのプロセスで復号する画像の上限（画素数）。超える画像は開始の時点で web view の経路へ戻す。
let runnerMaxImagePixels = 50_000_000
// 起動時の Wasm の確認がまだ終わっていないときに、開始が待つ長さ。
let runnerWasmWaitSeconds: TimeInterval = 5
// runner.js が assetBuffer で求めてよい名前は 3 つだけ。番号は Rust の RunnerAsset と揃える。
func runnerAssetCode(_ name: String) -> UInt32? {
    switch name {
    case "tesseract-core":
        return 1
    case "tesseract-core-fallback":
        return 2
    case "jpn-traineddata":
        return 3
    default:
        return nil
    }
}

func runnerPixelsWithinLimit(width: Int, height: Int) -> Bool {
    guard width > 0, height > 0 else {
        return false
    }
    let (pixels, overflow) = width.multipliedReportingOverflow(by: height)
    guard !overflow, pixels <= runnerMaxImagePixels else {
        return false
    }
    return !pixels.multipliedReportingOverflow(by: 4).overflow
}

private func runnerImageDimensions(_ source: CGImageSource) -> (width: Int, height: Int)? {
    guard CGImageSourceGetCount(source) > 0,
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
        let width = properties[kCGImagePropertyPixelWidth as String] as? Int,
        let height = properties[kCGImagePropertyPixelHeight as String] as? Int
    else {
        return nil
    }
    return (width, height)
}
/// 開始の前の画素数の検査。寸法は画像の情報から読み、復号はしない。読めない画像も web view へ戻す。
func runnerImageFits(_ image: Data) -> Bool {
    guard let source = CGImageSourceCreateWithData(image as CFData, nil),
        let size = runnerImageDimensions(source)
    else {
        return false
    }
    return runnerPixelsWithinLimit(width: size.width, height: size.height)
}

struct RunnerDecodedImage {
    let width: Int
    let height: Int
    let rgba: OwnedBytes
}
// web view の createImageBitmap と canvas の getImageData に合わせる：EXIF の向きを当て、sRGB の
// 8 bit RGBA、乗算済みでない値（不透明なら alpha 255）。検査と復号は同じ番号の画像で行う。
// WebKit は画像をハードウェアの復号器を使わずに復号する。JPEG はこれで画素値が 1 ずれるため揃える
// （ImageIO の公開ヘッダに無いキーで、知らない環境では無視される）。
let runnerSoftwareDecodeKey = "kCGImageSourceUseHardwareAcceleration"

func runnerDecodeImage(_ image: Data) -> RunnerDecodedImage? {
    guard let source = CGImageSourceCreateWithData(image as CFData, nil),
        let size = runnerImageDimensions(source),
        runnerPixelsWithinLimit(width: size.width, height: size.height)
    else {
        return nil
    }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: max(size.width, size.height),
        kCGImageSourceShouldCacheImmediately: true,
        runnerSoftwareDecodeKey as CFString: false,
    ]
    guard let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
        runnerPixelsWithinLimit(width: decoded.width, height: decoded.height),
        let space = CGColorSpace(name: CGColorSpace.sRGB)
    else {
        return nil
    }
    let width = decoded.width
    let height = decoded.height
    let count = width * height * 4
    guard let rgba = OwnedBytes(zeroedCount: count), let base = rgba.bytes,
        let context = CGContext(
            data: base, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else {
        return nil
    }
    context.draw(decoded, in: CGRect(x: 0, y: 0, width: width, height: height))
    let pixels = base.bindMemory(to: UInt8.self, capacity: count)
    var offset = 0
    while offset < count {
        let alpha = Int(pixels[offset + 3])
        if alpha > 0 && alpha < 255 {
            for channel in 0..<3 {
                let value = Int(pixels[offset + channel])
                pixels[offset + channel] = UInt8(min(255, (value * 255 + alpha / 2) / alpha))
            }
        }
        offset += 4
    }
    return RunnerDecodedImage(width: width, height: height, rgba: rgba)
}
// 最小の Wasm（42 を返す関数 f を 1 つ持つ）。アセットは読まない。
private let tinyWasmModule: [UInt8] = [
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 6,
    1, 4, 0, 65, 42, 11,
]
// 領域を ArrayBuffer に渡す。以後の解放は JSC が free で行う（写しは作らない）。
private func makeArrayBuffer(_ bytes: OwnedBytes, in context: JSContext) -> JSValue? {
    let count = bytes.count
    guard let pointer = bytes.handOff() else {
        return nil
    }
    var exception: JSValueRef?
    let buffer = JSObjectMakeArrayBufferWithBytesNoCopy(
        context.jsGlobalContextRef, pointer, count, { raw, _ in free(raw) }, nil, &exception)
    // 作れなかったときは JSC が領域を引き取っていないので、ここで解放する。
    guard let buffer else {
        free(pointer)
        return nil
    }
    guard exception == nil else {
        return nil
    }
    return JSValue(jsValueRef: buffer, in: context)
}
/// この JSContext で Wasm を組み立てて動かせるか。tesseract のジョブだけがこの結果を見る。
func runTinyWasmCheck() -> Bool {
    guard let context = JSContext() else {
        return false
    }
    context.exceptionHandler = { _, _ in }
    guard let bytes = OwnedBytes(copying: tinyWasmModule, count: tinyWasmModule.count),
        let buffer = makeArrayBuffer(bytes, in: context),
        let wasm = context.objectForKeyedSubscript("WebAssembly"), wasm.isObject,
        let module = wasm.objectForKeyedSubscript("Module")?.construct(withArguments: [buffer]),
        context.exception == nil, module.isObject,
        let instance = wasm.objectForKeyedSubscript("Instance")?.construct(withArguments: [module]),
        context.exception == nil, instance.isObject,
        let answer = instance.objectForKeyedSubscript("exports")?.objectForKeyedSubscript("f")?
            .call(withArguments: []),
        context.exception == nil
    else {
        return false
    }
    return answer.isNumber && answer.toInt32() == 42
}
// 確認の結果は 1 度だけ書かれ、以後は読むだけ。
private final class WasmCheckResult: @unchecked Sendable {
    private let condition = NSCondition()
    private var value: Bool?

    func set(_ usable: Bool) {
        condition.lock()
        value = usable
        condition.broadcast()
        condition.unlock()
    }

    func wait(_ seconds: TimeInterval) -> Bool? {
        condition.lock()
        defer { condition.unlock() }
        let deadline = Date(timeIntervalSinceNow: seconds)
        while value == nil {
            if !condition.wait(until: deadline) {
                break
            }
        }
        return value
    }
}
// 取消しのあと、runner.js が自分で終わるのを待つ長さ。過ぎたら取消しとして閉じる。
let runnerCancelGraceSeconds: TimeInterval = 5
// 取消しの締め切りまで終わらなかったときの結果。
private let cancelledOutcome = Data(#"{"outcome":"cancelled"}"#.utf8)
// 通信の失敗は理由を問わずこの文言で伝える（URL や鍵を含む文字列を JS へ渡さない）。
private let fetchFailedMessage = "network request failed"

private final class RunLoopHolder: @unchecked Sendable {
    var loop: CFRunLoop?
    let ready = DispatchSemaphore(value: 0)
}
// 自分の run loop を持つ専用スレッド。タイマーもここで回る。
private final class RunnerLoop: @unchecked Sendable {
    private let holder = RunLoopHolder()

    init() {
        let holder = self.holder
        let thread = Thread {
            holder.loop = CFRunLoopGetCurrent()
            RunLoop.current.add(NSMachPort(), forMode: .default)
            holder.ready.signal()
            while true {
                _ = RunLoop.current.run(mode: .default, before: .distantFuture)
            }
        }
        thread.name = "aoiko-runner"
        thread.start()
        holder.ready.wait()
    }

    func perform(_ block: @escaping () -> Void) {
        guard let loop = holder.loop else {
            return
        }
        CFRunLoopPerformBlock(loop, CFRunLoopMode.defaultMode.rawValue) {
            autoreleasepool { block() }
        }
        CFRunLoopWakeUp(loop)
    }
}

private final class PendingReply {
    let resolve: JSValue
    let reject: JSValue

    init(resolve: JSValue, reject: JSValue) {
        self.resolve = resolve
        self.reject = reject
    }
}

private final class PendingTimer {
    let timer: Timer
    let callback: JSValue

    init(timer: Timer, callback: JSValue) {
        self.timer = timer
        self.callback = callback
    }
}

private final class RunnerJob {
    let token: UInt64
    // 0 は LLM と注文・分類。1 tesseract / 2 OS の文字認識 / 3 OS の AI は領収書のときだけ。
    let engine: UInt32
    // 開始のときに Rust から受け取って写した画像。runner.js からは受け取らない。
    var image: Data?
    var context: JSContext?
    var pending: [UInt64: PendingReply] = [:]
    var timers: [UInt64: PendingTimer] = [:]
    var nextId: UInt64 = 1
    var cancelling = false
    var finished = false
    #if DEBUG && targetEnvironment(simulator)
        var wasmBuild: String?
        var recognized: Data?
    #endif

    init(token: UInt64, engine: UInt32, image: Data?, context: JSContext) {
        self.token = token
        self.engine = engine
        self.image = image
        self.context = context
    }

    func takeId() -> UInt64 {
        let id = nextId
        nextId &+= 1
        return id
    }
}

private final class PromiseParts {
    var resolve: JSValue?
    var reject: JSValue?
}
/// 1 度に 1 件だけ動かす。状態は専用スレッドの上でしか触らない。
final class AnalysisRunner: @unchecked Sendable {
    private let hooks: RunnerHooks
    private let cancelGrace: TimeInterval
    private let loop = RunnerLoop()
    // OS の AI は待ちが長いので、専用スレッドでもメインスレッドでもない直列のキューで呼ぶ。
    private let aiQueue = DispatchQueue(label: "aoiko-runner-ai")
    private let wasmResult = WasmCheckResult()
    private var job: RunnerJob?
    // 開始より先に届いた取消し（ページの読み込みと開始が重なったとき）。番号は増える一方なので数件で足りる。
    private var cancelledBeforeRun: [UInt64] = []
    // テストが「手放したか」を確かめるためだけの弱参照。
    private(set) weak var lastContext: JSContext?

    // Wasm の確認は起動時に 1 度だけ専用スレッドで行い、結果を覚えておく。
    init(
        hooks: RunnerHooks, cancelGrace: TimeInterval = runnerCancelGraceSeconds,
        wasmCheck: @escaping @Sendable () -> Bool = runTinyWasmCheck
    ) {
        self.hooks = hooks
        self.cancelGrace = cancelGrace
        let result = wasmResult
        loop.perform { result.set(wasmCheck()) }
    }
    // 確認が終わっていなければ seconds まで待つ。終わらなければ使えない扱い。
    func wasmUsable(waiting seconds: TimeInterval) -> Bool {
        return wasmResult.wait(seconds) == true
    }

    func start(
        _ token: UInt64, script: String, spec: String, engine: UInt32 = 0, image: Data? = nil
    ) {
        loop.perform { self.run(token, script: script, spec: spec, engine: engine, image: image) }
    }

    func cancel(_ token: UInt64) {
        loop.perform { self.cancelOnThread(token) }
    }
    // body が nil なら通信の失敗。
    func reply(_ token: UInt64, request: UInt64, body: Data?) {
        loop.perform { self.replyOnThread(token, request: request, body: body) }
    }
    // テストが専用スレッドの上で状態を読むための入口。
    func onRunnerThread(_ block: @escaping () -> Void) {
        loop.perform(block)
    }

    private func run(_ token: UInt64, script: String, spec: String, engine: UInt32, image: Data?) {
        // 取消し済みのジョブは JSContext を作らずに終える。Rust はこの報告まで次を始めさせない。
        if let index = cancelledBeforeRun.firstIndex(of: token) {
            cancelledBeforeRun.remove(at: index)
            hooks.complete(token, cancelledOutcome)
            return
        }
        guard job == nil, let context = JSContext() else {
            hooks.complete(token, Data())
            return
        }
        let job = RunnerJob(token: token, engine: engine, image: image, context: context)
        self.job = job
        lastContext = context
        // 例外は既定ではコンソールへも出ない。ここでも何も書き出さない。
        context.exceptionHandler = { _, _ in }
        installHost(context, token: token)
        context.evaluateScript(script)
        guard let runner = context.objectForKeyedSubscript("aoikoRunner"),
            isFunction(runner.objectForKeyedSubscript("run"), in: context),
            let promise = runner.invokeMethod("run", withArguments: [spec]),
            isFunction(promise.objectForKeyedSubscript("then"), in: context)
        else {
            finish(job, Data())
            return
        }
        let onDone: @convention(block) (JSValue?) -> Void = { [weak self] value in
            self?.settled(token, value)
        }
        let onFail: @convention(block) (JSValue?) -> Void = { [weak self] _ in
            self?.settled(token, nil)
        }
        promise.invokeMethod(
            "then",
            withArguments: [
                unsafeBitCast(onDone, to: AnyObject.self),
                unsafeBitCast(onFail, to: AnyObject.self),
            ])
    }

    private func isFunction(_ value: JSValue?, in context: JSContext) -> Bool {
        guard let value = value, value.isObject else {
            return false
        }
        return JSObjectIsFunction(context.jsGlobalContextRef, value.jsValueRef)
    }
    // runner.js が使えるのは、この 10 個の名前付きの関数だけ。汎用の呼び出し口は作らない。
    // window は作らない（束ねた tesseract は window の有無で環境を見分ける）。
    private func installHost(_ context: JSContext, token: UInt64) {
        let fetch: @convention(block) (JSValue?, JSValue?) -> JSValue? = { [weak self] request, body in
            return self?.hostFetch(token, request: request, body: body)
        }
        let setTimeout: @convention(block) (JSValue?, JSValue?) -> JSValue? = {
            [weak self] callback, delay in
            return self?.hostSetTimeout(token, callback: callback, delay: delay)
        }
        let clearTimeout: @convention(block) (JSValue?) -> Void = { [weak self] id in
            self?.hostClearTimeout(token, id: id)
        }
        let progress: @convention(block) (JSValue?, JSValue?) -> Void = { [weak self] done, total in
            self?.hostProgress(token, done: done, total: total)
        }
        let appleAiAvailability: @convention(block) () -> JSValue? = { [weak self] in
            return self?.hostAiAvailability(token)
        }
        let appleAiExtract: @convention(block) () -> JSValue? = { [weak self] in
            return self?.hostAiExtract(token)
        }
        let appleAiRun: @convention(block) (JSValue?, JSValue?) -> JSValue? = {
            [weak self] task, data in
            return self?.hostAiRun(token, task: task, data: data)
        }
        let recognizeText: @convention(block) () -> JSValue? = { [weak self] in
            return self?.hostRecognizeText(token)
        }
        let decodeImage: @convention(block) () -> JSValue? = { [weak self] in
            return self?.hostDecodeImage(token)
        }
        let assetBuffer: @convention(block) (JSValue?) -> JSValue? = { [weak self] name in
            return self?.hostAssetBuffer(token, name: name)
        }
        guard let host = JSValue(newObjectIn: context) else {
            return
        }
        host.setObject(unsafeBitCast(fetch, to: AnyObject.self), forKeyedSubscript: "fetch" as NSString)
        host.setObject(
            unsafeBitCast(setTimeout, to: AnyObject.self), forKeyedSubscript: "setTimeout" as NSString)
        host.setObject(
            unsafeBitCast(clearTimeout, to: AnyObject.self),
            forKeyedSubscript: "clearTimeout" as NSString)
        host.setObject(
            unsafeBitCast(progress, to: AnyObject.self), forKeyedSubscript: "progress" as NSString)
        host.setObject(
            unsafeBitCast(appleAiAvailability, to: AnyObject.self),
            forKeyedSubscript: "appleAiAvailability" as NSString)
        host.setObject(
            unsafeBitCast(appleAiExtract, to: AnyObject.self),
            forKeyedSubscript: "appleAiExtract" as NSString)
        host.setObject(
            unsafeBitCast(appleAiRun, to: AnyObject.self), forKeyedSubscript: "appleAiRun" as NSString)
        host.setObject(
            unsafeBitCast(recognizeText, to: AnyObject.self),
            forKeyedSubscript: "recognizeText" as NSString)
        host.setObject(
            unsafeBitCast(decodeImage, to: AnyObject.self),
            forKeyedSubscript: "decodeImage" as NSString)
        host.setObject(
            unsafeBitCast(assetBuffer, to: AnyObject.self),
            forKeyedSubscript: "assetBuffer" as NSString)
        context.setObject(host, forKeyedSubscript: "aoikoHost" as NSString)
    }

    private func current(_ token: UInt64) -> RunnerJob? {
        guard let job = job, job.token == token, !job.finished else {
            return nil
        }
        return job
    }

    private func rejected(_ context: JSContext, _ message: String) -> JSValue? {
        let parts = PromiseParts()
        let promise = JSValue(newPromiseIn: context) { resolve, reject in
            parts.resolve = resolve
            parts.reject = reject
        }
        _ = parts.reject?.call(withArguments: [JSValue(newErrorFromMessage: message, in: context) as Any])
        return promise
    }

    private func hostFetch(_ token: UInt64, request: JSValue?, body: JSValue?) -> JSValue? {
        guard let job = current(token), let context = job.context else {
            return nil
        }
        guard let frame = requestFrame(request, body: body) else {
            return rejected(context, fetchFailedMessage)
        }
        let parts = PromiseParts()
        let promise = JSValue(newPromiseIn: context) { resolve, reject in
            parts.resolve = resolve
            parts.reject = reject
        }
        guard let resolve = parts.resolve, let reject = parts.reject else {
            return rejected(context, fetchFailedMessage)
        }
        let id = job.takeId()
        job.pending[id] = PendingReply(resolve: resolve, reject: reject)
        hooks.fetch(token, id, frame)
        return promise
    }

    // 後で解決する Promise。解決する側（answer）は整数の番号だけを持ち、JSValue は持ち出さない。
    private func pendingPromise(_ job: RunnerJob, _ context: JSContext) -> (JSValue, UInt64)? {
        let parts = PromiseParts()
        let promise = JSValue(newPromiseIn: context) { resolve, reject in
            parts.resolve = resolve
            parts.reject = reject
        }
        guard let promise, let resolve = parts.resolve, let reject = parts.reject else {
            return nil
        }
        let id = job.takeId()
        job.pending[id] = PendingReply(resolve: resolve, reject: reject)
        return (promise, id)
    }
    // ジョブが終わっていれば何もしない。
    private func answer(
        _ token: UInt64, _ id: UInt64, reject: Bool, _ make: (JSContext) -> JSValue?
    ) {
        guard let job = current(token), let context = job.context,
            let pending = job.pending.removeValue(forKey: id)
        else {
            return
        }
        let value: Any = make(context) ?? JSValue(undefinedIn: context) as Any
        _ = (reject ? pending.reject : pending.resolve).call(withArguments: [value])
    }
    // OS の AI の呼び出しは専用のキューで行い、答えは専用スレッドへ戻して決める。
    private func onAiQueue(
        _ token: UInt64, _ id: UInt64, _ work: @escaping @Sendable () -> RunnerAiAnswer
    ) {
        aiQueue.async { [weak self] in
            let result = work()
            self?.loop.perform {
                switch result {
                case .json(let json):
                    self?.answer(token, id, reject: false) { JSValue(object: json, in: $0) }
                case .failed(let code):
                    self?.answer(token, id, reject: true) { JSValue(int32: code, in: $0) }
                }
            }
        }
    }

    private func hostAiAvailability(_ token: UInt64) -> JSValue? {
        guard let job = current(token), let context = job.context,
            let (promise, id) = pendingPromise(job, context)
        else {
            return nil
        }
        let local = hooks.local
        aiQueue.async { [weak self] in
            let code = local.aiAvailability()
            self?.loop.perform {
                self?.answer(token, id, reject: false) { JSValue(int32: code, in: $0) }
            }
        }
        return promise
    }
    // 画像は開始のときに受け取ったものだけを渡す。
    private func hostAiExtract(_ token: UInt64) -> JSValue? {
        guard let job = current(token), let context = job.context,
            let (promise, id) = pendingPromise(job, context)
        else {
            return nil
        }
        guard job.engine == 3, let image = job.image else {
            answer(token, id, reject: true) { JSValue(int32: 2, in: $0) }
            return promise
        }
        let local = hooks.local
        onAiQueue(token, id) { local.ai(token, image) }
        return promise
    }
    // 何を頼むかは Rust がジョブの種類から決め直す。ここで受け取るのはデータの文字列だけ。
    private func hostAiRun(_ token: UInt64, task: JSValue?, data: JSValue?) -> JSValue? {
        guard let job = current(token), let context = job.context,
            let (promise, id) = pendingPromise(job, context)
        else {
            return nil
        }
        guard let task, task.isNumber, [1, 2].contains(task.toInt32()), job.engine == 0,
            let data, data.isString, let text = data.toString()
        else {
            answer(token, id, reject: true) { JSValue(int32: 2, in: $0) }
            return promise
        }
        let payload = Data(text.utf8)
        let local = hooks.local
        onAiQueue(token, id) { local.ai(token, payload) }
        return promise
    }
    // 失敗の理由は 'no-text' と 'failed' の 2 つだけを渡す（Vision の説明文は渡さない）。
    private func hostRecognizeText(_ token: UInt64) -> JSValue? {
        guard let job = current(token), let context = job.context,
            let (promise, id) = pendingPromise(job, context)
        else {
            return nil
        }
        guard job.engine == 2, let image = job.image else {
            answer(token, id, reject: true) { JSValue(object: "failed", in: $0) }
            return promise
        }
        switch hooks.local.recognize(image) {
        case .success(let recognized):
            guard let encoded = try? JSONEncoder().encode(recognized),
                let object = try? JSONSerialization.jsonObject(with: encoded)
            else {
                answer(token, id, reject: true) { JSValue(object: "failed", in: $0) }
                return promise
            }
            #if DEBUG && targetEnvironment(simulator)
                job.recognized = encoded
            #endif
            answer(token, id, reject: false) { JSValue(object: object, in: $0) }
        case .failure(.noText):
            answer(token, id, reject: true) { JSValue(object: "no-text", in: $0) }
        case .failure(.failed):
            answer(token, id, reject: true) { JSValue(object: "failed", in: $0) }
        }
        return promise
    }

    private func hostDecodeImage(_ token: UInt64) -> JSValue? {
        guard let job = current(token), let context = job.context,
            let (promise, id) = pendingPromise(job, context)
        else {
            return nil
        }
        guard job.engine == 1, let image = job.image, let decoded = runnerDecodeImage(image),
            let buffer = makeArrayBuffer(decoded.rgba, in: context),
            let object = JSValue(
                object: ["width": decoded.width, "height": decoded.height], in: context)
        else {
            answer(token, id, reject: true) {
                JSValue(newErrorFromMessage: "image decode failed", in: $0)
            }
            return promise
        }
        object.setValue(buffer, forProperty: "rgba")
        answer(token, id, reject: false) { _ in object }
        return promise
    }
    // 名前は 3 つに限り、それ以外は Rust を呼ばずに例外にする。
    private func hostAssetBuffer(_ token: UInt64, name: JSValue?) -> JSValue? {
        guard let job = current(token), let context = job.context else {
            return nil
        }
        guard job.engine == 1, let name, name.isString, let text = name.toString(),
            let code = runnerAssetCode(text), let bytes = hooks.local.asset(code),
            let buffer = makeArrayBuffer(bytes, in: context)
        else {
            context.exception = JSValue(newErrorFromMessage: "asset unavailable", in: context)
            return nil
        }
        #if DEBUG && targetEnvironment(simulator)
            if code != 3 {
                job.wasmBuild = text
            }
        #endif
        return buffer
    }

    private func replyOnThread(_ token: UInt64, request: UInt64, body: Data?) {
        guard let job = current(token), let context = job.context,
            let pending = job.pending.removeValue(forKey: request)
        else {
            return
        }
        guard let body = body, let parts = splitReply(body),
            let value = JSValue(object: ["meta": parts.meta, "body": parts.body], in: context)
        else {
            _ = pending.reject.call(withArguments: [
                JSValue(newErrorFromMessage: fetchFailedMessage, in: context) as Any
            ])
            return
        }
        _ = pending.resolve.call(withArguments: [value])
    }

    private func hostSetTimeout(_ token: UInt64, callback: JSValue?, delay: JSValue?) -> JSValue? {
        guard let job = current(token), let context = job.context else {
            return nil
        }
        guard let callback = callback, isFunction(callback, in: context) else {
            context.exception = JSValue(
                newErrorFromMessage: "setTimeout requires a function", in: context)
            return nil
        }
        var milliseconds = 0.0
        if let delay = delay, delay.isNumber {
            let raw = delay.toDouble()
            milliseconds = raw.isFinite ? min(max(raw, 0), 2_147_483_647) : 0
        }
        let id = job.takeId()
        let timer = Timer(timeInterval: milliseconds / 1000, repeats: false) { [weak self] _ in
            self?.fireTimer(token, id: id)
        }
        RunLoop.current.add(timer, forMode: .default)
        job.timers[id] = PendingTimer(timer: timer, callback: callback)
        return JSValue(double: Double(id), in: context)
    }

    private func fireTimer(_ token: UInt64, id: UInt64) {
        guard let job = current(token), let pending = job.timers.removeValue(forKey: id) else {
            return
        }
        _ = pending.callback.call(withArguments: [])
    }

    private func hostClearTimeout(_ token: UInt64, id: JSValue?) {
        guard let job = current(token), let id = id, id.isNumber else {
            return
        }
        let raw = id.toDouble()
        guard raw.isFinite, raw >= 1, raw < 9_007_199_254_740_992 else {
            return
        }
        job.timers.removeValue(forKey: UInt64(raw))?.timer.invalidate()
    }

    private func hostProgress(_ token: UInt64, done: JSValue?, total: JSValue?) {
        guard current(token) != nil, let done = done, let total = total, done.isNumber,
            total.isNumber
        else {
            return
        }
        let completed = done.toDouble()
        let all = total.toDouble()
        guard completed.isFinite, all.isFinite, completed >= 0, all >= 1, completed <= all,
            all <= 1000
        else {
            return
        }
        hooks.progress(token, Int64(completed), Int64(all))
    }

    private func settled(_ token: UInt64, _ value: JSValue?) {
        guard let job = current(token) else {
            return
        }
        guard let value = value, value.isString, let text = value.toString() else {
            finish(job, Data())
            return
        }
        let outcome = Data(text.utf8)
        #if DEBUG && targetEnvironment(simulator)
            runnerTestHold(job, outcome: outcome)
        #endif
        finish(job, outcome)
    }

    private func cancelOnThread(_ token: UInt64) {
        if job == nil {
            cancelledBeforeRun.append(token)
            if cancelledBeforeRun.count > 8 {
                cancelledBeforeRun.removeFirst()
            }
            return
        }
        guard let job = current(token), !job.cancelling, let context = job.context else {
            return
        }
        job.cancelling = true
        if let runner = context.objectForKeyedSubscript("aoikoRunner"),
            isFunction(runner.objectForKeyedSubscript("abort"), in: context)
        {
            _ = runner.invokeMethod("abort", withArguments: [])
        }
        guard current(token) != nil else {
            return
        }
        let timer = Timer(timeInterval: cancelGrace, repeats: false) { [weak self] _ in
            self?.cancelDeadline(token)
        }
        RunLoop.current.add(timer, forMode: .default)
    }

    private func cancelDeadline(_ token: UInt64) {
        guard let job = current(token) else {
            return
        }
        finish(job, cancelledOutcome)
    }
    // JSContext への参照をすべて手放してから Rust へ報告する。Rust はこの報告まで次を始めさせない。
    private func finish(_ job: RunnerJob, _ outcome: Data) {
        job.finished = true
        for pending in job.timers.values {
            pending.timer.invalidate()
        }
        job.timers.removeAll()
        job.pending.removeAll()
        job.context = nil
        job.image = nil
        if self.job === job {
            self.job = nil
        }
        hooks.complete(job.token, outcome)
    }
}
#if DEBUG && targetEnvironment(simulator)
    // シミュレータでの受け入れ試験だけ：起動時の環境に宛先があれば、結果を Rust へ渡す前に
    // その宛先へ送り、答えが返るまで待つ。宛先の形が違えば待たない。失敗しても解析は続ける。
    private func runnerTestHold(_ job: RunnerJob, outcome: Data) {
        guard
            let url = runnerHoldURL(ProcessInfo.processInfo.environment["AOIKO_RUNNER_TEST_HOLD"])
        else {
            return
        }
        let parsed = (try? JSONSerialization.jsonObject(with: outcome)) as? [String: Any]
        let recognized = job.recognized.flatMap { try? JSONSerialization.jsonObject(with: $0) }
        let labels: [UInt32: String] = [1: "tesseract", 2: "native", 3: "apple-ai"]
        let digest = job.image.map { image in
            SHA256.hash(data: image).map { String(format: "%02x", $0) }.joined()
        }
        let payload: [String: Any] = [
            "engine": labels[job.engine] ?? "llm",
            "wasmBuild": job.wasmBuild ?? NSNull(),
            "inputSha256": digest ?? NSNull(),
            "result": parsed?["result"] ?? NSNull(),
            "recognized": recognized ?? NSNull(),
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        request.timeoutInterval = runnerHoldTimeoutSeconds
        let session = URLSession(
            configuration: runnerHoldSessionConfiguration(), delegate: RunnerHoldRedirectRefusal(),
            delegateQueue: nil)
        let done = DispatchSemaphore(value: 0)
        session.dataTask(with: request) { _, _, _ in done.signal() }.resume()
        _ = done.wait(timeout: .now() + runnerHoldTimeoutSeconds)
        session.invalidateAndCancel()
    }
#endif
/// 開始。断る理由の検査（引数・画素数・Wasm の確認の結果）をすべて終えてから、背景の時間を取り、
/// ジョブを積む。断ったときは何も残さない。0 開始 / 1 断った / 2 web view の経路へ戻す。
func startRunnerJob(
    runner: AnalysisRunner, background: BackgroundTime, token: UInt64, script: Data, spec: Data,
    title: String, subtitle: String, engine: UInt32, image: Data?
) -> Int32 {
    switch engine {
    case 0:
        guard image == nil else {
            return 1
        }
    case 1, 2, 3:
        guard let image, !image.isEmpty else {
            return 1
        }
        guard runnerImageFits(image) else {
            return 2
        }
        // Wasm を使うのは tesseract だけ。ほかのエンジンはこの結果を見ない。
        if engine == 1 && !runner.wasmUsable(waiting: runnerWasmWaitSeconds) {
            return 2
        }
    default:
        return 1
    }
    background.begin(token, title: title, subtitle: subtitle)
    runner.start(
        token, script: String(decoding: script, as: UTF8.self),
        spec: String(decoding: spec, as: UTF8.self), engine: engine, image: image)
    return 0
}
/// 終わりを Rust へ報告し、Rust が決めた結果で背景処理を閉じる。成功で閉じるのは done に決まったときだけで、
/// 失敗・取消し・期限切れ・不正な結果は失敗で閉じる。
func reportThenEnd(
    _ background: BackgroundTime, report: @escaping @Sendable (UInt64, Data) -> Bool
) -> @Sendable (UInt64, Data) -> Void {
    return { token, outcome in
        background.end(token, success: report(token, outcome))
    }
}
/// 通信の要求の枠。[4 バイト LE: meta 長][meta JSON][body]。meta は JSONSerialization で組む。
func requestFrame(_ request: JSValue?, body: JSValue?) -> Data? {
    guard let request = request, request.isString, let text = request.toString(),
        let parsed = try? JSONSerialization.jsonObject(with: Data(text.utf8)),
        let object = parsed as? [String: Any],
        let url = object["url"] as? String,
        let method = object["method"] as? String,
        let headers = object["headers"] as? [[String]],
        headers.allSatisfy({ $0.count == 2 })
    else {
        return nil
    }
    let meta: [String: Any] = ["url": url, "method": method, "headers": headers]
    guard let metaData = try? JSONSerialization.data(withJSONObject: meta),
        let length = UInt32(exactly: metaData.count)
    else {
        return nil
    }
    var frame = Data()
    withUnsafeBytes(of: length.littleEndian) { frame.append(contentsOf: $0) }
    frame.append(metaData)
    if let body = body, body.isString, let text = body.toString() {
        frame.append(Data(text.utf8))
    }
    return frame
}
/// 応答の枠を meta と本文の文字列へ分ける。長さが合わない枠は読まない。
func splitReply(_ data: Data) -> (meta: String, body: String)? {
    let bytes = [UInt8](data)
    guard bytes.count >= 4 else {
        return nil
    }
    let length =
        Int(bytes[0]) | Int(bytes[1]) << 8 | Int(bytes[2]) << 16 | Int(bytes[3]) << 24
    guard length <= bytes.count - 4 else {
        return nil
    }
    let meta = String(decoding: bytes[4..<(4 + length)], as: UTF8.self)
    let body = String(decoding: bytes[(4 + length)...], as: UTF8.self)
    return (meta, body)
}

#if os(iOS)
    // Rust（runner.rs）との入口。文字列とバイト列は戻る前にすべて写す。
    typealias RunnerFetchCallback = @convention(c) (UInt64, UInt64, UnsafePointer<UInt8>?, Int) ->
        Void
    // 戻り値は Rust がこのジョブを done に決めたら 1、それ以外は 0。
    typealias RunnerCompleteCallback = @convention(c) (UInt64, UnsafePointer<UInt8>?, Int) -> Int32
    typealias RunnerExpiredCallback = @convention(c) (UInt64) -> Void
    // アセットは Rust が確保し、同じ長さで RunnerAssetFreeCallback に返して解放させる。
    typealias RunnerAssetCallback = @convention(c) (UInt32, UnsafeMutablePointer<Int>?) -> UnsafeMutablePointer<UInt8>?
    typealias RunnerAssetFreeCallback = @convention(c) (UnsafeMutablePointer<UInt8>?, Int) -> Void
    // OS の AI。結果の文字列は Rust が確保し、RunnerAiFreeCallback で解放させる。
    typealias RunnerAiCallback = @convention(c) (UInt64, UnsafePointer<UInt8>?, Int, UnsafeMutablePointer<Int32>?) -> UnsafeMutablePointer<CChar>?
    typealias RunnerAiFreeCallback = @convention(c) (UnsafeMutablePointer<CChar>?) -> Void

    private final class InstalledRunner: @unchecked Sendable {
        let runner: AnalysisRunner
        let background: BackgroundTime

        init(runner: AnalysisRunner, background: BackgroundTime) {
            self.runner = runner
            self.background = background
        }
    }

    private final class InstalledBox: @unchecked Sendable {
        private let lock = NSLock()
        private var value: InstalledRunner?

        func set(_ next: InstalledRunner) {
            lock.lock()
            defer { lock.unlock() }
            if value == nil {
                value = next
            }
        }

        func get() -> InstalledRunner? {
            lock.lock()
            defer { lock.unlock() }
            return value
        }
    }

    private let installed = InstalledBox()

    private func copyData(_ pointer: UnsafePointer<UInt8>?, _ length: Int) -> Data? {
        guard let pointer = pointer, length >= 0 else {
            return nil
        }
        return Data(bytes: pointer, count: length)
    }
    // 呼ぶのは専用スレッドの assetBuffer だけ。長さは 1 度だけ読み、同じ値で解放する。null と長さ 0 は失敗。
    private func copyAsset(
        _ code: UInt32, asset: RunnerAssetCallback, release: RunnerAssetFreeCallback
    ) -> OwnedBytes? {
        var length = 0
        guard let pointer = asset(code, &length) else {
            return nil
        }
        let count = length
        defer { release(pointer, count) }
        guard count > 0 else {
            return nil
        }
        return OwnedBytes(copying: pointer, count: count)
    }
    // 呼ぶのは OS の AI の専用キュー。文字列は写してから同じキューの上で解放する。
    private func callRunnerAi(
        _ token: UInt64, _ payload: Data, call: RunnerAiCallback, release: RunnerAiFreeCallback
    ) -> RunnerAiAnswer {
        var code: Int32 = 0
        let pointer = payload.withUnsafeBytes { raw in
            call(token, raw.bindMemory(to: UInt8.self).baseAddress, raw.count, &code)
        }
        guard let pointer else {
            return .failed(code == 0 ? 3 : code)
        }
        defer { release(pointer) }
        return .json(String(cString: pointer))
    }

    @_cdecl("aoiko_runner_install")
    func aoiko_runner_install(
        _ fetch: @escaping RunnerFetchCallback,
        _ complete: @escaping RunnerCompleteCallback,
        _ expired: @escaping RunnerExpiredCallback,
        _ asset: @escaping RunnerAssetCallback,
        _ assetFree: @escaping RunnerAssetFreeCallback,
        _ ai: @escaping RunnerAiCallback,
        _ aiFree: @escaping RunnerAiFreeCallback
    ) {
        let background = BackgroundTime(
            scheduler: SystemBackgroundScheduler(), queue: .main,
            onExpired: { token in expired(token) })
        let local = LocalEngineHooks(
            asset: { code in copyAsset(code, asset: asset, release: assetFree) },
            ai: { token, payload in callRunnerAi(token, payload, call: ai, release: aiFree) },
            aiAvailability: { aoiko_ai_availability() },
            recognize: { image in runTextRecognition(on: image) })
        let runner = AnalysisRunner(
            hooks: RunnerHooks(
                fetch: { token, request, frame in
                    frame.withUnsafeBytes { raw in
                        fetch(token, request, raw.bindMemory(to: UInt8.self).baseAddress, raw.count)
                    }
                },
                complete: reportThenEnd(background) { token, outcome in
                    outcome.withUnsafeBytes { raw in
                        complete(token, raw.bindMemory(to: UInt8.self).baseAddress, raw.count) == 1
                    }
                },
                progress: { token, done, total in
                    background.progress(token, completed: done, total: total)
                },
                local: local
            ))
        installed.set(InstalledRunner(runner: runner, background: background))
    }
    // 0 開始 / 1 未設定・引数が不正 / 2 web view の経路へ戻す（端末内のエンジンの領収書だけ）。
    @_cdecl("aoiko_runner_start")
    func aoiko_runner_start(
        _ token: UInt64,
        _ script: UnsafePointer<UInt8>?,
        _ scriptLen: Int,
        _ spec: UnsafePointer<UInt8>?,
        _ specLen: Int,
        _ title: UnsafePointer<CChar>?,
        _ subtitle: UnsafePointer<CChar>?,
        _ engine: UInt32,
        _ image: UnsafePointer<UInt8>?,
        _ imageLen: Int
    ) -> Int32 {
        guard let target = installed.get(),
            let scriptData = copyData(script, scriptLen),
            let specData = copyData(spec, specLen),
            let title = title, let subtitle = subtitle
        else {
            return 1
        }
        return startRunnerJob(
            runner: target.runner, background: target.background, token: token,
            script: scriptData, spec: specData, title: String(cString: title),
            subtitle: String(cString: subtitle), engine: engine,
            image: image == nil ? nil : copyData(image, imageLen))
    }

    @_cdecl("aoiko_runner_cancel")
    func aoiko_runner_cancel(_ token: UInt64) {
        installed.get()?.runner.cancel(token)
    }

    @_cdecl("aoiko_runner_reply")
    func aoiko_runner_reply(
        _ token: UInt64,
        _ request: UInt64,
        _ ok: Int32,
        _ body: UnsafePointer<UInt8>?,
        _ length: Int
    ) {
        let data = ok == 1 ? copyData(body, length) : nil
        installed.get()?.runner.reply(token, request: request, body: data)
    }
#endif