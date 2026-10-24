import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

struct BrowserFrameArgs: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct BrowserProtectionArgs: Decodable {
  /// "strict", "balanced" or "off".
  let level: String
  /// WKContentRuleList JSON, made by TBV from its lists.
  let rules: String
}

class BrowserArgs: Decodable {
  let action: String
  let tab: String?
  let url: String?
  let frame: BrowserFrameArgs?
  let protection: BrowserProtectionArgs?
  let text: String?
  let backwards: Bool?
  let script: String?
  let id: String?
  let zoom: Double?
  /// A private tab: nothing it does is kept.
  let incognito: Bool?
}

/// Discover's browser on iPhone and iPad: a tab is one of Apple's web views,
/// laid over the space TBV's page keeps for it; only the tab in front shows.
/// Sites in them can't reach TBV. What they do (the page each is on, files
/// brought down, a pop-up opening as a new tab) waits in a queue that the
/// Rust side reads one at a time.
class TbvBrowser: NSObject, WKNavigationDelegate, WKUIDelegate {
  static let shared = TbvBrowser()

  private var views = [String: WKWebView]()
  private var front: String?
  private var frame = CGRect.zero
  /// Counts shows and hides, so a show that waited (for protection rules)
  /// doesn't bring a page up after a later hide.
  private var turn = 0
  private var waiting: Invoke?
  private var queue = [[String: Any]]()
  /// Downloads under way: their id, where each is saved, its tab and address.
  private var saving = [ObjectIdentifier: (id: String, target: URL, tab: String, url: String)]()
  private var downloads = [String: AnyObject]()
  /// When each address last started coming down, so a page asking again and
  /// again (as one waiting for a sign-in can) brings it down once.
  private var recent = [String: Date]()
  /// The protection level's rules, once compiled.
  private var rules: WKContentRuleList?
  /// Sites shown as on a computer (Request desktop site), by host.
  private var desktopHosts = Set<String>()
  /// What private tabs share while any is open, kept in memory only.
  private var privateStore: WKWebsiteDataStore?
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

  private func nameOf(_ view: WKWebView) -> String? {
    views.first(where: { $0.value === view })?.key
  }

  private func tellPage(_ view: WKWebView, loading: Bool) {
    guard let tab = nameOf(view) else { return }
    var event: [String: Any] = ["kind": "page", "tab": tab, "url": view.url?.absoluteString ?? "", "loading": loading]
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

  /// A tab's web view, made the first time it's asked for. A pop-up's view
  /// must be made from the configuration WebKit hands over.
  private func made(_ tab: String, configuration: WKWebViewConfiguration? = nil, incognito: Bool = false) -> WKWebView? {
    if let view = views[tab] { return view }
    guard let tbv = tbv, let host = tbv.superview else { return nil }
    let config = configuration ?? WKWebViewConfiguration()
    if configuration == nil && incognito {
      let store = privateStore ?? WKWebsiteDataStore.nonPersistent()
      privateStore = store
      config.websiteDataStore = store
    }
    config.allowsInlineMediaPlayback = true
    if let rules = rules { config.userContentController.add(rules) }
    let made = WKWebView(frame: frame, configuration: config)
    made.navigationDelegate = self
    made.uiDelegate = self
    made.allowsBackForwardNavigationGestures = true
    made.isHidden = true
    host.insertSubview(made, aboveSubview: tbv)
    views[tab] = made
    return made
  }

  private func bringForward(_ tab: String) {
    front = tab
    for (name, view) in views {
      view.isHidden = name != tab
      if name == tab { view.frame = frame }
    }
  }

  private func close(_ tab: String) {
    guard let view = views.removeValue(forKey: tab) else { return }
    view.stopLoading()
    view.removeFromSuperview()
    if front == tab { front = nil }
    // The last private tab closed: what they kept goes with them.
    if let store = privateStore, !views.values.contains(where: { $0.configuration.websiteDataStore === store }) {
      privateStore = nil
    }
  }

  /// Compiles the level's rules and puts them on every tab; Off takes them away.
  private func protect(_ protection: BrowserProtectionArgs, then done: @escaping () -> Void) {
    let apply = { (list: WKContentRuleList?) in
      self.rules = list
      for view in self.views.values {
        view.configuration.userContentController.removeAllContentRuleLists()
        if let list = list { view.configuration.userContentController.add(list) }
      }
      done()
    }
    if protection.level == "off" {
      apply(nil)
      return
    }
    WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "tbv-protection", encodedContentRuleList: protection.rules) { list, _ in
      DispatchQueue.main.async { apply(list) }
    }
  }

  func act(_ args: BrowserArgs, _ invoke: Invoke) {
    DispatchQueue.main.async {
      if let f = args.frame {
        let corner = self.tbv?.frame.origin ?? .zero
        self.frame = CGRect(x: corner.x + f.x, y: corner.y + f.y, width: max(f.width, 1), height: max(f.height, 1))
      }
      if args.action == "show" || args.action == "hide" { self.turn += 1 }
      let mine = self.turn
      switch args.action {
      case "hide":
        for view in self.views.values { view.isHidden = true }
        invoke.resolve(["ok": true])
        return
      case "place":
        if let front = self.front { self.views[front]?.frame = self.frame }
        invoke.resolve(["ok": true])
        return
      case "clear":
        // Clearing needs no tab open: the data lives in the shared store.
        WKWebsiteDataStore.default().removeData(
          ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast
        ) { invoke.resolve(["ok": true]) }
        return
      case "protect":
        if let protection = args.protection {
          self.protect(protection) { invoke.resolve(["ok": true]) }
        } else {
          invoke.resolve(["ok": true])
        }
        return
      case "desktopSites":
        self.desktopHosts = Set((args.text ?? "").split(separator: "\n").map { String($0).lowercased() })
        invoke.resolve(["ok": true])
        return
      case "clearSite":
        // One site's cookies and storage: the records WebKit keeps under its name.
        let host = (args.text ?? "").lowercased()
        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        store.fetchDataRecords(ofTypes: types) { records in
          let theirs = records.filter { record in
            let name = record.displayName.lowercased()
            return !host.isEmpty && (host == name || host.hasSuffix("." + name) || name.hasSuffix("." + host))
          }
          store.removeData(ofTypes: types, for: theirs) { invoke.resolve(["ok": true]) }
        }
        return
      case "openApp":
        if let address = args.url.flatMap({ URL(string: $0) }) {
          UIApplication.shared.open(address) { opened in
            if opened { invoke.resolve(["ok": true]) } else { invoke.reject("No app on this device opens that link.") }
          }
        } else {
          invoke.reject("That isn't a link TBV can open.")
        }
        return
      case "share":
        guard let address = args.url.flatMap({ URL(string: $0) }), let shown = self.shownController else {
          invoke.reject("TBV couldn't open the Share sheet.")
          return
        }
        let sheet = UIActivityViewController(activityItems: [address], applicationActivities: nil)
        // On iPad the sheet points at the button it came from.
        if let popover = sheet.popoverPresentationController, let tbv = self.tbv {
          popover.sourceView = tbv
          if let f = args.frame {
            popover.sourceRect = CGRect(x: f.x, y: f.y, width: max(f.width, 1), height: max(f.height, 1))
          } else {
            popover.sourceRect = CGRect(x: tbv.bounds.midX, y: tbv.bounds.minY + 60, width: 1, height: 1)
          }
        }
        shown.present(sheet, animated: true)
        invoke.resolve(["ok": true])
        return
      case "cancel":
        if let id = args.id, let download = self.downloads.removeValue(forKey: id) {
          if #available(iOS 14.5, *), let download = download as? WKDownload {
            download.cancel { _ in }
          }
        }
        invoke.resolve(["ok": true])
        return
      default:
        break
      }
      guard let tab = args.tab else {
        invoke.reject("That isn't one of the browser's tabs.")
        return
      }
      if args.action == "close" {
        self.close(tab)
        invoke.resolve(["ok": true])
        return
      }
      let show = {
        guard let view = self.made(tab, incognito: args.incognito ?? false) else {
          invoke.reject("TBV couldn't show the browser.")
          return
        }
        let address = args.url.flatMap { URL(string: $0) }
        switch args.action {
        case "show":
          if mine == self.turn { self.bringForward(tab) } else { self.front = tab }
          if let address = address { view.load(URLRequest(url: address)) }
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
        case "zoom":
          if #available(iOS 14.0, *) { view.pageZoom = CGFloat(args.zoom ?? 1) }
        case "history":
          // The pages behind and ahead, nearest first, for the Back and Forward buttons' menus.
          let entry = { (item: WKBackForwardListItem) -> [String: String] in
            ["title": item.title ?? "", "url": item.url.absoluteString]
          }
          invoke.resolve([
            "back": view.backForwardList.backList.reversed().map(entry),
            "forward": view.backForwardList.forwardList.map(entry),
          ])
          return
        case "find":
          let text = (try? JSONEncoder().encode(args.text ?? "")).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
          view.evaluateJavaScript("window.find(\(text), false, \(args.backwards ?? false), true)") { _, _ in }
        case "run":
          // TBV's script answers with JSON text (the article, for reader mode).
          view.evaluateJavaScript(args.script ?? "null") { result, _ in
            invoke.resolve(["result": (result as? String) ?? "null"])
          }
          return
        default:
          invoke.reject("The browser can't do that.")
          return
        }
        invoke.resolve(["ok": true])
      }
      // A first show brings the protection level with it, set before the page loads.
      if args.action == "show", let protection = args.protection, self.views[tab] == nil {
        self.protect(protection, then: show)
      } else {
        show()
      }
    }
  }

  // MARK: Pages

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    tellPage(webView, loading: true)
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    tellPage(webView, loading: true)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    tellPage(webView, loading: false)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    tellPage(webView, loading: false)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    tellPage(webView, loading: false)
    // A page that couldn't open: TBV says why on a page of its own. Not for a
    // load that was stopped, or one that became a download.
    let failed = error as NSError
    if failed.domain == NSURLErrorDomain && failed.code == NSURLErrorCancelled { return }
    if failed.domain == "WebKitErrorDomain" && (failed.code == 102 || failed.code == 204) { return }
    guard let tab = nameOf(webView) else { return }
    let url = (failed.userInfo[NSURLErrorFailingURLStringErrorKey] as? String) ?? webView.url?.absoluteString ?? ""
    tell(["kind": "failed", "tab": tab, "url": url, "reason": reason(failed)])
  }

  /// Why a page couldn't open, in plain words.
  private func reason(_ error: NSError) -> String {
    guard error.domain == NSURLErrorDomain else { return error.localizedDescription }
    switch error.code {
    case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorDataNotAllowed:
      return "You're not connected to the internet."
    case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
      return "TBV couldn't find this site. Check the address, or your internet connection."
    case NSURLErrorTimedOut:
      return "The site took too long to answer."
    case NSURLErrorCannotConnectToHost:
      return "TBV couldn't reach this site. It may be down, or your connection may have dropped."
    case NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateNotYetValid,
      NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorSecureConnectionFailed:
      return "This site's security certificate isn't valid, so TBV didn't open it. Someone could be pretending to be the site."
    case NSURLErrorHTTPTooManyRedirects:
      return "The site kept sending TBV somewhere else, so it stopped."
    default:
      return error.localizedDescription
    }
  }

  /// A link or pop-up that opens a new window opens as a new tab, still joined
  /// to the page that opened it, so sign-ins in a pop-up can finish.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    let tab = "p" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12).lowercased()
    guard let view = made(tab, configuration: configuration) else {
      webView.load(navigationAction.request)
      return nil
    }
    bringForward(tab)
    tell(["kind": "newTab", "tab": tab, "url": navigationAction.request.url?.absoluteString ?? "", "from": nameOf(webView) ?? ""])
    return view
  }

  /// Holding a link: TBV's own items (a new tab, and the library for a book
  /// file) come first, then Apple's.
  @available(iOS 13.0, *)
  func webView(
    _ webView: WKWebView, contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo,
    completionHandler: @escaping (UIContextMenuConfiguration?) -> Void
  ) {
    let tab = nameOf(webView) ?? ""
    let link = elementInfo.linkURL
    let web = ["http", "https"].contains(link?.scheme?.lowercased() ?? "")
    completionHandler(
      UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { suggested in
        guard web, let link = link else { return UIMenu(title: "", children: suggested) }
        var ours: [UIMenuElement] = [
          UIAction(title: "Open in New Tab", image: UIImage(systemName: "plus.square.on.square")) { _ in
            self.tell(["kind": "menu", "tab": tab, "action": "newTab", "url": link.absoluteString])
          }
        ]
        let books = ["epub", "kepub", "pdf", "mobi", "azw", "azw3", "fb2", "cbz", "cbr", "djvu", "m4b", "mp3"]
        if books.contains(link.pathExtension.lowercased()) {
          ours.append(
            UIAction(title: "Add to TBV Library", image: UIImage(systemName: "books.vertical")) { _ in
              self.tell(["kind": "menu", "tab": tab, "action": "addBook", "url": link.absoluteString])
            })
        }
        return UIMenu(title: link.host ?? "", children: [UIMenu(title: "", options: .displayInline, children: ours)] + suggested)
      })
  }

  /// A page that closes itself (a sign-in pop-up when it's done) closes its tab.
  func webViewDidClose(_ webView: WKWebView) {
    guard let tab = nameOf(webView) else { return }
    close(tab)
    tell(["kind": "closed", "tab": tab])
  }

  /// The view controller on top, to show a site's messages over.
  private var shownController: UIViewController? {
    var shown = tbv?.window?.rootViewController
    while let next = shown?.presentedViewController { shown = next }
    return shown
  }

  private func siteName(_ frame: WKFrameInfo) -> String {
    frame.request.url?.host ?? "This page"
  }

  func webView(
    _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void
  ) {
    guard let shown = shownController else { return completionHandler() }
    let alert = UIAlertController(title: siteName(frame), message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
    shown.present(alert, animated: true)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
  ) {
    guard let shown = shownController else { return completionHandler(false) }
    let alert = UIAlertController(title: siteName(frame), message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
    shown.present(alert, animated: true)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
  ) {
    guard let shown = shownController else { return completionHandler(nil) }
    let alert = UIAlertController(title: siteName(frame), message: prompt, preferredStyle: .alert)
    alert.addTextField { $0.text = defaultText }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
    shown.present(alert, animated: true)
  }

  /// Whether `url` is already coming down, or just started: then it isn't brought down again.
  private func again(_ url: URL?) -> Bool {
    guard let address = url?.absoluteString else { return false }
    let now = Date()
    recent = recent.filter { now.timeIntervalSince($0.value) < 30 }
    if recent[address] != nil || saving.values.contains(where: { $0.url == address }) { return true }
    recent[address] = now
    return false
  }

  /// Mail and other links that aren't web pages go to the phone's own apps,
  /// once TBV's page has asked (if chosen). Sites chosen for their desktop
  /// version are asked for it.
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences,
    decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
  ) {
    let scheme = navigationAction.request.url?.scheme?.lowercased() ?? ""
    if !["http", "https", "about", "blob", "data"].contains(scheme), let url = navigationAction.request.url {
      if !["file", "javascript"].contains(scheme) {
        tell(["kind": "external", "tab": nameOf(webView) ?? "", "url": url.absoluteString])
      }
      decisionHandler(.cancel, preferences)
      return
    }
    if #available(iOS 14.5, *), navigationAction.shouldPerformDownload {
      decisionHandler(again(navigationAction.request.url) ? .cancel : .download, preferences)
      return
    }
    if navigationAction.targetFrame?.isMainFrame ?? true, let host = navigationAction.request.url?.host?.lowercased() {
      preferences.preferredContentMode = desktopHosts.contains(host) ? .desktop : .recommended
    }
    decisionHandler(.allow, preferences)
  }

  /// A file the web view can't show, or one sent as a download, is brought down.
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    let response = navigationResponse.response as? HTTPURLResponse
    let attachment = (response?.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased().hasPrefix("attachment")
    if #available(iOS 14.5, *), attachment || !navigationResponse.canShowMIMEType {
      decisionHandler(again(navigationResponse.response.url) ? .cancel : .download)
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
    let id = UUID().uuidString.lowercased()
    let folder = TbvBrowser.downloadsFolder.appendingPathComponent(id, isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
    let target = folder.appendingPathComponent(name)
    let tab = download.webView.flatMap { nameOf($0) } ?? ""
    let address = download.originalRequest?.url?.absoluteString ?? response.url?.absoluteString ?? ""
    saving[ObjectIdentifier(download)] = (id: id, target: target, tab: tab, url: address)
    downloads[id] = download
    tell(["kind": "downloadStart", "tab": tab, "id": id, "name": name, "url": address])
    completionHandler(target)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let saved = saving.removeValue(forKey: ObjectIdentifier(download)) else { return }
    downloads.removeValue(forKey: saved.id)
    tell(["kind": "download", "tab": saved.tab, "id": saved.id, "path": saved.target.path, "name": saved.target.lastPathComponent, "ok": true])
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    guard let saved = saving.removeValue(forKey: ObjectIdentifier(download)) else { return }
    // A failed one may be tried again straight away.
    recent.removeValue(forKey: saved.url)
    // Cancelled from TBV: nothing to tell, and nothing kept.
    if downloads.removeValue(forKey: saved.id) == nil {
      try? FileManager.default.removeItem(at: saved.target.deletingLastPathComponent())
      return
    }
    tell(["kind": "download", "tab": saved.tab, "id": saved.id, "path": saved.target.path, "name": saved.target.lastPathComponent, "ok": false])
  }
}
