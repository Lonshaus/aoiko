import CoreGraphics
import Foundation
import ImageIO
import Vision
// OS 内蔵の文字認識。プラグインのコマンド（web view の経路）と解析の実行環境（AnalysisRunner）が
// 同じこの関数を使う。UIKit を使わないので、macOS でも試験できる。
// デスクトップ側の words_to_lines と同じ形。web 側は出どころを区別しない。
struct RecognizedWord: Encodable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let confidence: Double?
    let alternates: [String]
    /// 文字の基線の傾き（この正規化座標での dy/dx）。取れないときは nil。
    let slope: Double?
}

struct RecognizedLine: Encodable {
    let text: String
    let words: [RecognizedWord]
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct RecognizedText: Encodable {
    let lines: [RecognizedLine]
    let text: String
}
/// 読めなかった理由。failed の文字列は Vision の説明で、web view の経路の文言にだけ使う。
enum TextRecognitionFailure: Error {
    case noText
    case failed(String)
}
// perform は同期。呼び元はメインスレッド以外から呼ぶ（認識のあいだスレッドが止まる）。
// 形式は Vision が中身から判定する。呼び元から種別を渡す必要は無い。
func runTextRecognition(on data: Data) -> Result<RecognizedText, TextRecognitionFailure> {
    let handler = VNImageRequestHandler(data: data, options: [:])
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision3
    request.recognitionLevel = .accurate
    // ja-JP は revision 3 の .accurate でしか使えない（.fast は非対応）。
    request.recognitionLanguages = ["ja-JP", "en-US"]
    request.usesLanguageCorrection = true
    do {
        try handler.perform([request])
    } catch {
        return .failure(.failed(error.localizedDescription))
    }
    guard let observations = request.results else {
        return .failure(.noText)
    }
    // 先頭が誤っていても次の候補が正しいことがある（`T` の欠けは実測）。
    let words: [RecognizedWord] = observations.compactMap { o in
        let candidates = o.topCandidates(3)
        guard let top = candidates.first, !top.string.isEmpty else {
            return nil
        }
        let box = o.boundingBox
        // 外接矩形は軸に平行なので、傾けて撮ると基線の向きが失われる。四隅は実際に
        // 回るので、下辺から傾きを取る。y を反転すればこちらの正規化座標での傾きに
        // なり、画素の縦横比を掛け戻す必要は無い（角度が要るときだけ）。
        let dx = Double(o.bottomRight.x - o.bottomLeft.x)
        let slope: Double? =
            abs(dx) < 1e-6 ? nil : Double(o.bottomLeft.y - o.bottomRight.y) / dx
        return RecognizedWord(
            text: top.string,
            x: box.minX,
            // Vision は左下原点で y が上向き。左上原点・下向きへ揃える。
            y: 1.0 - box.maxY,
            width: box.width,
            height: box.height,
            confidence: Double(top.confidence),
            alternates: candidates.dropFirst().map { $0.string }
                .filter { !$0.isEmpty && $0 != top.string },
            slope: slope
        )
    }
    // 単語のまとまりで返るので、行内は空白で繋ぐ。
    let recognized = wordsToLines(words, separator: " ")
    guard !recognized.lines.isEmpty else {
        return .failure(.noText)
    }
    return .success(recognized)
}
// Vision は読む順を保証せず、左右のセルを別々に返す。閾値は行の高さの半分。
private func wordsToLines(_ words: [RecognizedWord], separator: String) -> RecognizedText {
    let sorted = words.sorted { ($0.y + $0.height / 2) < ($1.y + $1.height / 2) }
    var rows: [[RecognizedWord]] = []
    for w in sorted {
        if let head = rows.last?.first {
            let limit = max(head.height, w.height) / 2
            if abs((head.y + head.height / 2) - (w.y + w.height / 2)) <= limit {
                rows[rows.count - 1].append(w)
                continue
            }
        }
        rows.append([w])
    }
    let lines: [RecognizedLine] = rows.compactMap { row in
        let ordered = row.sorted { $0.x < $1.x }
        guard let first = ordered.first else {
            return nil
        }
        let text = ordered.map { $0.text }.joined(separator: separator)
        if text.isEmpty {
            return nil
        }
        var left = first.x
        var top = first.y
        var right = first.x + first.width
        var bottom = first.y + first.height
        for w in ordered.dropFirst() {
            left = min(left, w.x)
            top = min(top, w.y)
            right = max(right, w.x + w.width)
            bottom = max(bottom, w.y + w.height)
        }
        return RecognizedLine(
            text: text, words: ordered,
            x: left, y: top, width: right - left, height: bottom - top
        )
    }
    return RecognizedText(lines: lines, text: lines.map { $0.text }.joined(separator: "\n"))
}