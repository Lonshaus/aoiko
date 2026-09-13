import Foundation

// respond(to:generating:) は async。@_cdecl は C ABI なので async のまま公開できず、
// ここで同期に落とす。aoiko_ai_extract と aoiko_ai_run はプロセス内で同じモデルを
// 取り合うので、単一化・締め切り付きの待ち・見捨てる判断をここへ集約する
// （AppleIntelligence.swift は body を組み立てて渡すだけにする）。

/// 生成 1 回ぶんの結果。json が nil でも err == 0 はあり得ない
/// （0 が nil を伴って外へ漏れないようにするのは呼び出し元 = AppleIntelligence.swift の責務）。
struct AppleAIOutcome: Sendable {
    var json: String?
    var err: Int32
}

/// 締め切り超過。0 は成功、1..4 は既存の意味（AppleIntelligence.swift 側）、
/// 6/7 は commands.rs 側（ゲート・入力サイズ）で使う。
let appleAITimedOutError: Int32 = 5
/// 直前の生成がまだ終わっていない。ゲートが弾いたことを示す。
let appleAIBusyError: Int32 = 6

// 読み書きを同じロックの下に置き、「完了」と「見捨てられた」の判定を単一の
// トランザクションにする。締め切りの瞬間に書き込みが間に合った場合、待つ側が
// wait(timeout:) の戻り値ではなくここの finished を見て判断するので、
// 既にある結果をタイムアウト扱いで握りつぶさない。
private final class OutcomeBox: @unchecked Sendable {
    private let lock = NSLock()
    private var outcome: AppleAIOutcome?
    private var finished = false

    func write(_ outcome: AppleAIOutcome) {
        lock.lock()
        defer { lock.unlock() }
        self.outcome = outcome
        finished = true
    }

    func snapshot() -> (finished: Bool, outcome: AppleAIOutcome?) {
        lock.lock()
        defer { lock.unlock() }
        return (finished, outcome)
    }
}

// aoiko_ai_extract と aoiko_ai_run は同じプロセス内モデルを取り合うので、
// 1 つのゲートで両方の入り口を締め合う（プロセス全体で単一化）。
private final class SingleFlightGate: @unchecked Sendable {
    private let lock = NSLock()
    private var busy = false

    func tryAcquire() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if busy {
            return false
        }
        busy = true
        return true
    }

    // 締め切りでは呼ばない。締め切りが見捨てるのは「待つ側」であって「仕事」ではなく、
    // ここで解放すると、まだ載っている生成の横で次の生成が始まってしまう
    // （ゲートが防ぎたい積み上がりそのもの）。生成が終わらない限りゲートは閉じたままで、
    // 両方の入り口が appleAIBusyError を返し続ける。タイマーでの回収は追加しない
    // （回収すると、前の生成がモデルを握ったまま次を始めることになり、今の状態より悪い）。
    func release() {
        lock.lock()
        defer { lock.unlock() }
        busy = false
    }
}

private let gate = SingleFlightGate()

/// FoundationModels を使う 3 経路（レシート抽出・分類・注文取込）が共通で通る唯一の入口。
/// ゲート確保 → Task 開始 → 締め切り付きで待つ → 見捨てる/受け取るの判断までをここに閉じる。
/// body は自分の結果を書き込んで返すだけで、コード 1..4 の意味は呼び出し元が決める。
/// FoundationModels の respond に cancellation が効く保証は無いため、task.cancel() は
/// 「呼べるものは呼ぶ」に留まり、実際に積み上がりを防ぐのはゲートの単一化。
func runSingleFlight(
    deadline: TimeInterval,
    body: @escaping @Sendable () async -> AppleAIOutcome
) -> AppleAIOutcome {
    guard gate.tryAcquire() else {
        return AppleAIOutcome(json: nil, err: appleAIBusyError)
    }
    let box = OutcomeBox()
    let semaphore = DispatchSemaphore(value: 0)
    let task = Task {
        defer {
            gate.release()
            semaphore.signal()
        }
        box.write(await body())
    }
    // wait() の戻り値（.success か .timedOut か）は意図的に見ない。締め切りちょうどに
    // body が書き終わった場合、signal() より先に締め切りが来て .timedOut が返ることが
    // あり得るが、box には既に結果が載っている。ここで verdict を信用して弾くと、
    // 間に合った結果をタイムアウト扱いで握りつぶしてしまう。
    _ = semaphore.wait(timeout: .now() + deadline)
    let snapshot = box.snapshot()
    if snapshot.finished, let outcome = snapshot.outcome {
        return outcome
    }
    task.cancel()
    return AppleAIOutcome(json: nil, err: appleAITimedOutError)
}