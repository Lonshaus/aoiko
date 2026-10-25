import Foundation
// シミュレータでの受け入れ試験だけが使う「結果を渡す前の待ち」の部品。宛先の検査と通信の設定だけを置き、
// 通信そのものと環境変数の読み取りは AnalysisRunner.swift の DEBUG かつシミュレータの区画の中にある。
// ここは macOS の試験でも組み立てられるよう、UIKit を使わない。
let runnerHoldPath = "/ctl/hold"
let runnerHoldTimeoutSeconds: TimeInterval = 180
// 宛先として受け付けるのは http://127.0.0.1:<port>/ctl/hold の形だけ。それ以外は待ちを使わない。
func runnerHoldURL(_ raw: String?) -> URL? {
    guard let raw, let components = URLComponents(string: raw),
        components.scheme == "http",
        components.host == "127.0.0.1",
        components.user == nil,
        components.password == nil,
        let port = components.port,
        (1024...65535).contains(port),
        port != 10708,
        port != 31527,
        components.percentEncodedPath == runnerHoldPath,
        components.query == nil,
        components.fragment == nil,
        raw == "http://127.0.0.1:\(port)\(runnerHoldPath)"
    else {
        return nil
    }
    return components.url
}
// 使い捨てのセッション。プロキシを通さず、待ちの上限を付ける。
func runnerHoldSessionConfiguration() -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.connectionProxyDictionary = [:]
    configuration.timeoutIntervalForRequest = runnerHoldTimeoutSeconds
    configuration.timeoutIntervalForResource = runnerHoldTimeoutSeconds
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    return configuration
}
/// 転送の指示には従わない。
final class RunnerHoldRedirectRefusal: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}