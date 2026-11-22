import Foundation
// TextChunking.swift の分け方とまとめ方を、文字数で量る偽の fits で確かめる。
func check(_ condition: Bool, _ name: String) -> Bool {
    print(condition ? "PASS: \(name)" : "FAIL: \(name)")
    return condition
}

func fitsWithin(_ limit: Int) -> (String) async -> Bool {
    { $0.count <= limit }
}

func parts(_ plan: ChunkPlan) -> [String] {
    if case .chunks(let parts) = plan {
        return parts
    }
    return []
}

final class CallLog: @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [Int] = []

    func record(_ index: Int) {
        lock.lock()
        seen.append(index)
        lock.unlock()
    }

    func read() -> [Int] {
        lock.lock()
        defer { lock.unlock() }
        return seen
    }
}

struct StopCall: Error {}

@main
struct TextChunkingTests {
    static func main() async {
        var results: [Bool] = []
        let lines = (1...10).map { "line\($0)" }
        let text = lines.joined(separator: "\n")
        results.append(check(try! await planChunks(text, fits: fitsWithin(1000)) == .single, "全体が収まれば分けない"))
        let two = parts(try! await planChunks(text, fits: fitsWithin(text.count - 1)))
        results.append(check(two.count == 2, "1 文字足りなければ 2 つに分ける"))
        results.append(check(two.joined() == text, "部分をつなぐと元に戻る"))
        let three = parts(try! await planChunks(text, fits: fitsWithin(24)))
        results.append(check(three.allSatisfy { $0.count <= 24 }, "どの部分も上限に収まる"))
        results.append(check(three.count == 3, "上限に合わせて必要な数だけに分ける"))
        results.append(check(three.joined() == text, "3 つに分けても元に戻る"))
        let firstFive = lines[0..<5].joined(separator: "\n") + "\n"
        let exact = parts(try! await planChunks(text, fits: fitsWithin(firstFive.count)))
        results.append(check(exact.first == firstFive, "上限ちょうどの行数まで 1 つの部分に入れる"))
        let longLine = "short\n" + String(repeating: "あ", count: 50) + "\nend"
        let split = parts(try! await planChunks(longLine, fits: fitsWithin(20)))
        results.append(check(split.allSatisfy { $0.count <= 20 } && split.joined() == longLine, "1 行だけで収まらない行はその行の中を文字で分ける"))
        results.append(check(split.count == 4, "長い行は上限いっぱいずつに分ける"))
        let emoji = String(repeating: "👨‍👩‍👧", count: 6)
        let emojiParts = parts(try! await planChunks(emoji, fits: fitsWithin(4)))
        results.append(check(emojiParts.joined() == emoji && emojiParts.allSatisfy { $0.count <= 4 }, "文字の途中では分けない"))
        results.append(check(try! await planChunks("ab", fits: fitsWithin(0)) == .unsplittable, "1 文字でも収まらなければ分けられない"))
        let many = (1...200).map { "row\($0)" }.joined(separator: "\n")
        let manyParts = parts(try! await planChunks(many, fits: fitsWithin(30)))
        results.append(check(manyParts.count > 8 && manyParts.joined() == many, "部分の数に上限を設けない"))
        let withBlank = "a\n\nb\nc"
        results.append(check(parts(try! await planChunks(withBlank, fits: fitsWithin(3))).joined() == withBlank, "空行も残す"))
        results.append(check(firstNonEmpty([]) == "" && lastNonEmpty([]) == "", "値が無ければ空文字"))
        results.append(check(firstNonEmpty(["", ""]) == "" && lastNonEmpty(["", ""]) == "", "全部空なら空文字"))
        results.append(check(firstNonEmpty(["", "a", "b"]) == "a", "最初に現れた値を採る"))
        results.append(check(lastNonEmpty(["a", "b", ""]) == "b", "最後に現れた値を採る"))
        let ordered = try! await runPartsInOrder(["a", "b", "c"]) { index, part in "\(index)\(part)" }
        results.append(check(ordered == ["0a", "1b", "2c"], "部分を順番にすべて送って結果を返す"))
        let cancelLog = CallLog()
        let cancelled = Task {
            try await runPartsInOrder(["a", "b", "c"]) { index, _ in
                cancelLog.record(index)
                withUnsafeCurrentTask { $0?.cancel() }
            }
        }
        var cancelThrown = false
        do {
            _ = try await cancelled.value
        } catch is CancellationError {
            cancelThrown = true
        } catch {}
        results.append(check(cancelLog.read() == [0] && cancelThrown, "取り消された後は次の部分を送らず CancellationError を投げる"))
        let failLog = CallLog()
        var failThrown = false
        do {
            _ = try await runPartsInOrder(["a", "b", "c"]) { index, _ in
                failLog.record(index)
                if index == 1 {
                    throw StopCall()
                }
            }
        } catch is StopCall {
            failThrown = true
        } catch {}
        results.append(check(failLog.read() == [0, 1] && failThrown, "呼び出しが失敗したらそのエラーを投げ、後の部分は送らない"))
        let failureCount = results.filter { !$0 }.count
        if failureCount > 0 {
            print("FAILED: \(failureCount) check(s) failed")
            exit(1)
        }
        print("All TextChunking tests passed")
    }
}