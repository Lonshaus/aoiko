import Foundation
import FoundationModels
import ImageIO
import Vision

// デプロイ対象は macOS 13.3 / iOS 16.4 だが、SystemLanguageModel は macOS 26 / iOS 26 から。
// FoundationModels の型は #available の外でも名前解決できる（SDK にモジュールがあれば
// コンパイルは通る）ので、参照はすべてこのガードの内側に置くだけでよい。
@_cdecl("aoiko_ai_availability")
func aoiko_ai_availability() -> Int32 {
    guard #available(macOS 26, iOS 26, *) else {
        return 4
    }
    switch SystemLanguageModel.default.availability {
    case .available:
        return 0
    case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible:
            return 1
        case .appleIntelligenceNotEnabled:
            return 2
        case .modelNotReady:
            return 3
        @unknown default:
            return 5
        }
    }
}

@available(macOS 26, iOS 26, *)
@Generable
struct ReceiptItem: Encodable {
    @Guide(description: "品目名")
    var name: String
    @Guide(description: "金額。半角数字のみ")
    var amount: String
}

@available(macOS 26, iOS 26, *)
@Generable
struct Receipt: Encodable {
    @Guide(description: "店名。用紙の最上部に大きく印刷されている屋号。商品名やメニュー名を店名にしない")
    var vendor: String
    @Guide(description: "発行日。YYYY-MM-DD 形式")
    var date: String
    @Guide(description: "「合計」「ご請求額」「領収金額」の額。半角数字のみ。「お預り」「お釣り」「現金」は支払総額ではない")
    var total: String
    @Guide(description: "適格請求書発行事業者の登録番号。大文字 T で始まり、続く 13 桁の数字を含む計 14 文字。見出しの後に印刷されている物だけを採る。取引番号・伝票番号・領収書番号・会員番号・電話番号から作らない。紙面に無ければ空文字")
    var invoiceNumber: String
    @Guide(description: "軽減税率 8% の課税対象額（税込の売上額）。消費税額そのものではない。8% の品が無ければ空文字")
    var amount8: String
    @Guide(description: "標準税率 10% の課税対象額（税込の売上額）。消費税額そのものではない。10% の品が無ければ空文字。8% の額をここに写さない")
    var amount10: String
    @Guide(description: "明細行の一覧。明細行が無いレシートでは空配列")
    var items: [ReceiptItem]
}

@available(macOS 26, iOS 26, *)
private let receiptInstructions = """
あなたは日本のレシート・領収書から経理に必要な項目を抜き出す担当です。
入力は OCR の結果なので、濁点の脱落や数字の読み違いが混じっています。

守ること：
- 紙面に印刷されていない値を作らない。読み取れない項目は空文字にする。
- 支払総額は「合計」「ご請求額」「領収金額」の額。「お預り」「お釣り」「現金」と混同しない。
- 税率ごとの額は課税対象額（売上額）であって、消費税額ではない。両者はレシート上で隣接して並ぶので注意する。
- クレジット売上票・ポイント明細・会員番号・広告・返品案内は買い物の内訳ではない。
- 明細行が無いレシート（金額だけの領収書）では品目を空配列にする。書かれていない品目を推測しない。
"""

// EXIF の向きを読まないと、スマホで撮った写真は縦横が入れ替わったまま認識される。
@available(macOS 26, iOS 26, *)
private func exifOrientation(of data: Data) -> CGImagePropertyOrientation {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let raw = properties[kCGImagePropertyOrientation] as? UInt32,
        let orientation = CGImagePropertyOrientation(rawValue: raw)
    else {
        return .up
    }
    return orientation
}

// Vision は読み取り順を保証しない。行の高さ方向で並べ、同じ行内は左から右へ。
@available(macOS 26, iOS 26, *)
private func readingOrder(
    _ a: VNRecognizedTextObservation, _ b: VNRecognizedTextObservation
) -> Bool {
    let ay = 1 - a.boundingBox.midY
    let by = 1 - b.boundingBox.midY
    // 固定値だと字の大きさで破綻する。同じ印刷行でも midY は実測で 0.01 ほどずれ、
    // 0.006 のような定数では見出しと金額が別行に割れて順序が入れ替わる。
    // desktop.rs の same_row と同じく、背の高い方の高さの半分を閾値にする。
    let tolerance = max(a.boundingBox.height, b.boundingBox.height) / 2
    if abs(ay - by) <= tolerance {
        return a.boundingBox.minX < b.boundingBox.minX
    }
    return ay < by
}

@available(macOS 26, iOS 26, *)
private func recognizeReceiptText(from data: Data) -> String? {
    let handler = VNImageRequestHandler(data: data, orientation: exifOrientation(of: data), options: [:])
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision3
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ja-JP", "en-US"]
    request.usesLanguageCorrection = true
    guard (try? handler.perform([request])) != nil, let observations = request.results else {
        return nil
    }
    let text = observations
        .sorted(by: readingOrder)
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: "\n")
    return text.isEmpty ? nil : text
}

@available(macOS 26, iOS 26, *)
private func runExtraction(text: String) -> (json: String?, err: Int32) {
    // respond(to:generating:) は async。@_cdecl は C ABI なので async のまま公開できず、
    // ここで同期に落とす（呼び元は tauri の (async) コマンドでワーカースレッドから来るので、
    // ここで止めても UI スレッドは止まらない）。
    final class Box: @unchecked Sendable {
        var json: String?
        var err: Int32 = 3
    }
    let box = Box()
    let semaphore = DispatchSemaphore(value: 0)
    Task {
        defer { semaphore.signal() }
        do {
            let session = LanguageModelSession(instructions: receiptInstructions)
            let response = try await session.respond(to: text, generating: Receipt.self)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.withoutEscapingSlashes]
            let data = try encoder.encode(response.content)
            box.json = String(data: data, encoding: .utf8)
            box.err = 0
        } catch let e as LanguageModelSession.GenerationError {
            if case .exceededContextWindowSize = e {
                box.err = 1
            } else {
                box.err = 3
            }
        } catch {
            box.err = 3
        }
    }
    semaphore.wait()
    return (box.json, box.err)
}

@_cdecl("aoiko_ai_extract")
func aoiko_ai_extract(
    _ bytes: UnsafePointer<UInt8>, _ length: Int, _ outErr: UnsafeMutablePointer<Int32>
) -> UnsafeMutablePointer<CChar>? {
    guard #available(macOS 26, iOS 26, *) else {
        outErr.pointee = 4
        return nil
    }
    let data = Data(bytes: bytes, count: length)
    guard let text = recognizeReceiptText(from: data) else {
        outErr.pointee = 2
        return nil
    }
    let (json, err) = runExtraction(text: text)
    outErr.pointee = err
    guard let json else {
        return nil
    }
    return strdup(json)
}

@_cdecl("aoiko_ai_free")
func aoiko_ai_free(_ p: UnsafeMutablePointer<CChar>?) {
    free(p)
}