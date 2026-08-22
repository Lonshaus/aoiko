import SafariServices
import Tauri
import UIKit
import UniformTypeIdentifiers
import Vision
import WebKit

// iOS/iPadOS 専用。デスクトップに OS の API で用意されている操作のうち、WKWebView や
// UIKit を直接触らないと届かないものをまとめる（フォルダ選択・印刷・外部リンク表示）。
//
// フォルダ選択は UIDocumentPickerViewController で選ばせ、security-scoped bookmark を
// base64 化してトークンとして Rust 側へ返す。読み書きそのものは Rust 側（backup.rs の
// std::fs）が行い、ここは resolveBookmark で取ったスコープを開いたまま保つ役だけを持つ。
class AoikoNativePlugin: Plugin, UIDocumentPickerDelegate {
    private var pendingPickInvoke: Invoke?
    // start は stop と対で呼ばないとリソースを漏らす。読み書きは Rust 側で起きるため
    // 「いつ終わったか」を知れず、token ごとに一度だけ取得して選び直しまで保持する。
    private var scopedFolders: [String: URL] = [:]

    @objc public func pickFolder(_ invoke: Invoke) {
        pendingPickInvoke = invoke
        DispatchQueue.main.async {
            guard let presenter = self.manager.viewController else {
                invoke.reject("表示元のウィンドウが見つかりません")
                self.pendingPickInvoke = nil
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let invoke = pendingPickInvoke else {
            return
        }
        pendingPickInvoke = nil
        guard let url = urls.first else {
            invoke.resolve()
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            invoke.reject("フォルダへのアクセス権を取得できません")
            return
        }
        // bookmark を作るだけなのでここでは手放す。読み書き用のスコープは resolveBookmark 側。
        defer { url.stopAccessingSecurityScopedResource() }
        do {
            let bookmark = try url.bookmarkData()
            let token = bookmark.base64EncodedString()
            releaseScope(exceptToken: token)
            invoke.resolve([
                "token": token,
                "name": url.lastPathComponent,
            ])
        } catch {
            invoke.reject("フォルダを記録できません: \(error.localizedDescription)")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingPickInvoke?.resolve()
        pendingPickInvoke = nil
    }

    // 解決できなければ ready=false。例外は投げない（JS 側が「選び直し」へ倒す）。
    @objc public func resolveBookmark(_ invoke: Invoke) throws {
        struct Args: Decodable {
            let token: String
        }
        let args = try invoke.parseArgs(Args.self)
        // 取得済みなら再取得しない（バックアップのたびにスコープが積み上がる）。
        if let held = scopedFolders[args.token] {
            invoke.resolve(["ready": true, "path": held.absoluteString])
            return
        }
        guard let bookmark = Data(base64Encoded: args.token) else {
            invoke.resolve(["ready": false])
            return
        }
        var isStale = false
        do {
            let url = try URL(resolvingBookmarkData: bookmark, bookmarkDataIsStale: &isStale)
            guard url.startAccessingSecurityScopedResource() else {
                invoke.resolve(["ready": false])
                return
            }
            scopedFolders[args.token] = url
            // isStale でも読み書きは通るため作り直さない。
            invoke.resolve([
                "ready": true,
                "path": url.absoluteString,
            ])
        } catch {
            invoke.resolve(["ready": false])
        }
    }
    // 選び直したら古い token のスコープは用済み。
    private func releaseScope(exceptToken keepToken: String?) {
        for (token, url) in scopedFolders where token != keepToken {
            url.stopAccessingSecurityScopedResource()
            scopedFolders.removeValue(forKey: token)
        }
    }
    // WKWebView の window.print() は WebKit が例外を投げるだけで何も起きない（tauri#3066）。
    // 印刷用のスタイルは web 側に揃っているので、描画は viewPrintFormatter に任せる。
    @objc public func printPage(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard let host = self.manager.viewController?.view,
                let webView = Self.findWebView(host)
            else {
                invoke.reject("印刷対象の画面が見つかりません")
                return
            }
            let info = UIPrintInfo.printInfo()
            info.outputType = .general
            info.jobName = "aoiko"
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            let done: UIPrintInteractionController.CompletionHandler = { _, _, error in
                if let error {
                    invoke.reject("印刷できません: \(error.localizedDescription)")
                } else {
                    invoke.resolve()
                }
            }
            // iPad は present(animated:) が例外になる。ポップオーバーの起点が要る。
            if UIDevice.current.userInterfaceIdiom == .pad {
                let anchor = CGRect(x: host.bounds.midX, y: host.bounds.midY, width: 1, height: 1)
                controller.present(from: anchor, in: host, animated: true, completionHandler: done)
            } else {
                controller.present(animated: true, completionHandler: done)
            }
        }
    }
    // 外部リンクを Safari へ飛ばすとアプリごと切り替わり、戻るのに手数が要る。
    // iOS の作法どおりアプリ内に重ねて表示し、閉じれば元の画面へ戻る。
    @objc public func openInApp(_ invoke: Invoke) throws {
        struct Args: Decodable {
            let url: String
        }
        let args = try invoke.parseArgs(Args.self)
        // SFSafariViewController は http/https しか受け付けず、それ以外は実行時に落ちる。
        guard let url = URL(string: args.url), url.scheme == "http" || url.scheme == "https" else {
            invoke.reject("アプリ内で開けない URL です")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.manager.viewController else {
                invoke.reject("表示元のウィンドウが見つかりません")
                return
            }
            presenter.present(SFSafariViewController(url: url), animated: true)
            invoke.resolve()
        }
    }

    // perform は同期。呼び元の (async) がすでにワーカースレッドなので、ここは
    // DispatchQueue.main へ乗せない（乗せると認識のあいだメインスレッドが止まる）。
    @objc public func recognizeText(_ invoke: Invoke) throws {
        // 形式は Vision が中身から判定する。呼び元から種別を渡す必要は無い。
        struct Args: Decodable {
            let imageBase64: String
        }
        let args = try invoke.parseArgs(Args.self)
        guard let data = Data(base64Encoded: args.imageBase64) else {
            invoke.reject("base64 を解けません")
            return
        }
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
            invoke.reject("文字を認識できません: \(error.localizedDescription)")
            return
        }
        guard let observations = request.results else {
            invoke.reject("テキストが見つかりません")
            return
        }
        // 先頭が誤っていても次の候補が正しいことがある（`T` の欠けは実測）。
        let words: [RecognizedWord] = observations.compactMap { o in
            let candidates = o.topCandidates(3)
            guard let top = candidates.first, !top.string.isEmpty else {
                return nil
            }
            let box = o.boundingBox
            return RecognizedWord(
                text: top.string,
                x: box.minX,
                // Vision は左下原点で y が上向き。左上原点・下向きへ揃える。
                y: 1.0 - box.maxY,
                width: box.width,
                height: box.height,
                confidence: Double(top.confidence),
                alternates: candidates.dropFirst().map { $0.string }
                    .filter { !$0.isEmpty && $0 != top.string }
            )
        }
        // 単語のまとまりで返るので、行内は空白で繋ぐ。
        let recognized = Self.wordsToLines(words, separator: " ")
        guard !recognized.lines.isEmpty else {
            invoke.reject("テキストが見つかりません")
            return
        }
        invoke.resolve(recognized)
    }

    // デスクトップ側の words_to_lines と同じ形。web 側は出どころを区別しない。
    struct RecognizedWord: Encodable {
        let text: String
        let x: Double
        let y: Double
        let width: Double
        let height: Double
        let confidence: Double?
        let alternates: [String]
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

    // Vision は読む順を保証せず、左右のセルを別々に返す。閾値は行の高さの半分。
    private static func wordsToLines(_ words: [RecognizedWord], separator: String) -> RecognizedText {
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

    private static func findWebView(_ view: UIView) -> WKWebView? {
        if let webView = view as? WKWebView {
            return webView
        }
        for sub in view.subviews {
            if let found = findWebView(sub) {
                return found
            }
        }
        return nil
    }
}

@_cdecl("init_plugin_aoiko_native")
func initPlugin() -> Plugin {
    return AoikoNativePlugin()
}