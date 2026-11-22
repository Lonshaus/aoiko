// 1 件の入力が上限に収まらないとき、部分に分けて順に送るための分け方。
// FoundationModels に依存しないので、単体で試せる。
enum ChunkPlan: Equatable, Sendable {
    case single
    case chunks([String])
    case unsplittable
}
// fits は「この文字列を 1 回で送っても上限に収まるか」。まず行の区切りで分け、
// 1 行だけでも収まらない行はその行の中を文字で分ける。量は足すほど増えるので、
// 区切り位置は小さい幅から倍々に広げて超えた所で二分探索する。こうすると量る文字数が
// 部分の大きさに比例し、入力全体の長さには引きずられない。部分をそのままつなぐと元の
// 文字列に戻る。1 文字でも収まらないときだけ unsplittable を返す。
func planChunks(_ text: String, fits: (String) async throws -> Bool) async throws -> ChunkPlan {
    if try await fits(text) {
        return .single
    }
    let pieces = text.split(separator: "\n", omittingEmptySubsequences: false)
    var lines = pieces.enumerated().map { index, piece in
        index < pieces.count - 1 ? String(piece) + "\n" : String(piece)
    }
    var parts: [String] = []
    var start = 0
    while start < lines.count {
        try Task.checkCancellation()
        if try await !fits(lines[start]) {
            let characters = Array(lines[start])
            let count = try await largestFitting(from: 0, below: characters.count) {
                try await fits(String(characters[0..<$0]))
            }
            if count == 0 {
                return .unsplittable
            }
            parts.append(String(characters[0..<count]))
            lines[start] = String(characters[count...])
            continue
        }
        let remaining = lines.count - start
        let count = try await largestFitting(from: 1, below: remaining + 1) {
            try await fits(lines[start..<(start + $0)].joined())
        }
        parts.append(lines[start..<(start + count)].joined())
        start += count
    }
    return .chunks(parts)
}
// good は収まると分かっている数、bad は収まらないと分かっている（または範囲外の）数。
// good から倍々に試して bad を見つけ、その間を二分探索して収まる最大の数を返す。
private func largestFitting(
    from good: Int, below bad: Int, fits: (Int) async throws -> Bool
) async throws -> Int {
    var good = good
    var bad = bad
    var probe = max(1, good * 2)
    while probe < bad {
        try Task.checkCancellation()
        if try await fits(probe) {
            good = probe
            probe *= 2
        } else {
            bad = probe
        }
    }
    while bad - good > 1 {
        try Task.checkCancellation()
        let mid = (good + bad) / 2
        if try await fits(mid) {
            good = mid
        } else {
            bad = mid
        }
    }
    return good
}
// 取り消された後に次の部分を送り始めないよう、呼び出しの前に毎回取り消しを確かめる。
func runPartsInOrder<T>(
    _ parts: [String], isolation: isolated (any Actor)? = #isolation,
    call: (Int, String) async throws -> T
) async throws -> [T] {
    var results: [T] = []
    for (index, part) in parts.enumerated() {
        try Task.checkCancellation()
        results.append(try await call(index, part))
    }
    return results
}

func firstNonEmpty(_ values: [String]) -> String {
    values.first { !$0.isEmpty } ?? ""
}

func lastNonEmpty(_ values: [String]) -> String {
    values.last { !$0.isEmpty } ?? ""
}