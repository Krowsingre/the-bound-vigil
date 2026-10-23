import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

class BrowserArgs: Decodable {
  let action: String
  let url: String?
  let x: Double?
  let y: Double?
  let width: Double?
  let height: Double?
}

/// Browse › Browser on iPhone and iPad: Apple's web view laid over the space
/// TBV's page keeps for it. Sites in it can't reach TBV. What it does (the
/// page it's on, files it brought down) waits in a queue that the Rust side
/// reads one at a time.
class TbvBrowser: NSObject, WKNavigationDelegate, WKUIDelegate {
  static let shared = TbvBrowser()

  private var view: WKWebView?
  private var waiting: Invoke?
  private var queue = [[String: Any]]()
  /// Where each download is being saved.
  private var saving = [ObjectIdentifier: URL]()
  /// TBV's own web view. The browser sits beside it, in the same view, so
  /// the two share their top-left corner.
  weak var tbv: WKWebView?

  /// The folder the browser's downloads wait in, until added or let go.
  static var downloadsFolder: URL {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
    return caches.appendingPathComponent("Browser downloads", isDirectory: true)
  }

  private func tell(_ event: [String: Any]) {
    if let invoke = waiting {
      waiting = nil
      invoke.resolve(event)
    } else {
      queue.append(event)
      if queue.count > 100 { queue.removeFirst(queue.count - 100) }
    }
  }

  private func tellPage(loading: Bool) {
    guard let view = view else { return }
    var event: [String: Any] = ["kind": "page", "url": view.url?.absoluteString ?? "", "loading": loading]
    if let title = view.title, !title.isEmpty { event["title"] = title }
    tell(event)
  }

  /// The next thing that happened, as soon as there is one.
  func next(_ invoke: Invoke) {
    DispatchQueue.main.async {
      if !self.queue.isEmpty {
        invoke.resolve(self.queue.removeFirst())
      } else {
        self.waiting?.resolve(["kind": "none"])
        self.waiting = invoke
      }
    }
  }

  private func made() -> WKWebView? {
    if let view = view { return view }
    guard let tbv = tbv, let host = tbv.superview else { return nil }
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    let made = WKWebView(frame: .zero, configuration: config)
    made.navigationDelegate = self
    made.uiDelegate = self
    made.allowsBackForwardNavigationGestures = true
    made.isHidden = true
    host.insertSubview(made, aboveSubview: tbv)
    view = made
    return made
  }

  func act(_ args: BrowserArgs, _ invoke: Invoke) {
    DispatchQueue.main.async {
      if args.action == "hide" {
        self.view?.isHidden = true
        invoke.resolve(["ok": true])
        return
      }
      // Clearing needs no page open: the data lives in the shared store.
      if args.action == "clear" {
        WKWebsiteDataStore.default().removeData(
          ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast
        ) {}
        invoke.resolve(["ok": true])
        return
      }
      guard let view = self.made() else {
        invoke.reject("TBV couldn't show the browser.")
        return
      }
      if let x = args.x, let y = args.y, let width = args.width, let height = args.height {
        let corner = self.tbv?.frame.origin ?? .zero
        view.frame = CGRect(x: corner.x + x, y: corner.y + y, width: max(width, 1), height: max(height, 1))
      }
      let address = args.url.flatMap { URL(string: $0) }
      switch args.action {
      case "show":
        view.isHidden = false
        if let address = address { view.load(URLRequest(url: address)) }
      case "place":
        break
      case "go":
        if let address = address { view.load(URLRequest(url: address)) }
      case "back":
        view.goBack()
      case "forward":
        view.goForward()
      case "reload":
        view.reload()
      case "stop":
        view.stopLoading()
      case "clear":
        WKWebsiteDataStore.default().removeData(
          ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast
        ) {}
      default:
        invoke.reject("The browser can't do that.")
        return
      }
      invoke.resolve(["ok": true])
    }
  }

  // MARK: Pages

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    tellPage(loading: true)
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    tellPage(loading: true)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    tellPage(loading: false)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    tellPage(loading: false)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    tellPage(loading: false)
  }

  /// A link that opens a new window opens here instead.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
    return nil
  }

  /// Mail and other links that aren't web pages go to the phone's own apps.
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let scheme = navigationAction.request.url?.scheme?.lowercased() ?? ""
    if !["http", "https", "about", "blob", "data"].contains(scheme), let url = navigationAction.request.url {
      UIApplication.shared.open(url)
      decisionHandler(.cancel)
      return
    }
    if #available(iOS 14.5, *), navigationAction.shouldPerformDownload {
      decisionHandler(.download)
      return
    }
    decisionHandler(.allow)
  }

  /// A file the web view can't show, or one sent as a download, is brought down.
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    let response = navigationResponse.response as? HTTPURLResponse
    let attachment = (response?.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased().hasPrefix("attachment")
    if #available(iOS 14.5, *), attachment || !navigationResponse.canShowMIMEType {
      decisionHandler(.download)
      return
    }
    decisionHandler(.allow)
  }
}

@available(iOS 14.5, *)
extension TbvBrowser: WKDownloadDelegate {
  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let folder = TbvBrowser.downloadsFolder.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
    let target = folder.appendingPathComponent(name)
    saving[ObjectIdentifier(download)] = target
    completionHandler(target)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let target = saving.removeValue(forKey: ObjectIdentifier(download)) else { return }
    tell(["kind": "download", "path": target.path, "name": target.lastPathComponent, "ok": true])
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    guard let target = saving.removeValue(forKey: ObjectIdentifier(download)) else { return }
    tell(["kind": "download", "path": target.path, "name": target.lastPathComponent, "ok": false])
  }
}
