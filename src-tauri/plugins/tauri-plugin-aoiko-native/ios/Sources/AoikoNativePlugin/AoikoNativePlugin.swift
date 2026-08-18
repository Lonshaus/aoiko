import SafariServices
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

// ある環境/ある環境 専用。デスクトップに OS の API で用意されている操作のうち、web view や
// OS の UI を直接触らないと届かないものをまとめる（フォルダ選択・印刷・外部リンク表示）。
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
    // web view の window.print() は web view が例外を投げるだけで何も起きない（tauri#3066）。
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
            // ある端末 は present(animated:) が例外になる。ポップオーバーの起点が要る。
            if UIDevice.current.userInterfaceIdiom == .pad {
                let anchor = CGRect(x: host.bounds.midX, y: host.bounds.midY, width: 1, height: 1)
                controller.present(from: anchor, in: host, animated: true, completionHandler: done)
            } else {
                controller.present(animated: true, completionHandler: done)
            }
        }
    }
    // 外部リンクを あるブラウザ へ飛ばすとアプリごと切り替わり、戻るのに手数が要る。
    // ある環境 の作法どおりアプリ内に重ねて表示し、閉じれば元の画面へ戻る。
    @objc public func openInApp(_ invoke: Invoke) throws {
        struct Args: Decodable {
            let url: String
        }
        let args = try invoke.parseArgs(Args.self)
        // SFあるブラウザViewController は http/https しか受け付けず、それ以外は実行時に落ちる。
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