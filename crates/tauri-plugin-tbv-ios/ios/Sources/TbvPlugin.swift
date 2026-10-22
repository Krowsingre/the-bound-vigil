import AVFoundation
import AuthenticationServices
import PhotosUI
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

class PathArgs: Decodable {
  let path: String
}

class PickArgs: Decodable {
  /// Kept for good (a key file a saved server reads at every sign-in),
  /// rather than only until it's imported.
  let keep: Bool?
}

class UrlArgs: Decodable {
  let url: String
}

/// The iPhone app's own pieces: folders chosen in Files (iCloud Drive's
/// library folder), iCloud files brought down when TBV reads them, and
/// audiobooks that keep playing with the screen locked.
class TbvPlugin: Plugin, UIDocumentPickerDelegate, PHPickerViewControllerDelegate, ASWebAuthenticationPresentationContextProviding {
  /// Folders chosen in Files, by path, kept as bookmarks so TBV can open
  /// them again after a restart.
  private static let foldersKey = "tbv.folders"
  private var picking: Invoke?
  /// Whether the picker showing is for files (copied in) rather than a folder.
  private var pickingFiles = false
  private var keepingPicked = false
  private var signIn: ASWebAuthenticationSession?

  override init() {
    super.init()
    reopenFolders()
    // Playback, not ambient: audio goes on with the screen locked or
    // another app open, and the silent switch doesn't mute an audiobook.
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
  }

  private func reopenFolders() {
    let saved = UserDefaults.standard.dictionary(forKey: TbvPlugin.foldersKey) as? [String: Data] ?? [:]
    var kept = [String: Data]()
    for (_, bookmark) in saved {
      var stale = false
      guard let url = try? URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale),
        url.startAccessingSecurityScopedResource()
      else { continue }
      kept[url.path] = stale ? ((try? url.bookmarkData()) ?? bookmark) : bookmark
    }
    UserDefaults.standard.set(kept, forKey: TbvPlugin.foldersKey)
  }

  /// Asks for a folder in Files. Answers its path, or no path if cancelled.
  @objc public func pickFolder(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      if let earlier = self.picking {
        earlier.resolve(["cancelled": true])
      }
      self.picking = invoke
      self.pickingFiles = false
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
      picker.delegate = self
      picker.allowsMultipleSelection = false
      guard let shown = self.manager.viewController else {
        self.picking = nil
        invoke.reject("TBV couldn't show the Files picker.")
        return
      }
      shown.present(picker, animated: true)
    }
  }

  /// Asks for files in Files (books, documents, audio). iCloud brings each
  /// one down and the picker copies it into TBV's own folder, so it's there
  /// to import however long the queue takes. Answers their paths.
  @objc public func pickFiles(_ invoke: Invoke) throws {
    let keep = (try? invoke.parseArgs(PickArgs.self))?.keep ?? false
    DispatchQueue.main.async {
      if let earlier = self.picking {
        earlier.resolve(["cancelled": true])
      }
      self.picking = invoke
      self.pickingFiles = true
      self.keepingPicked = keep
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.item], asCopy: true)
      picker.delegate = self
      picker.allowsMultipleSelection = true
      guard let shown = self.manager.viewController else {
        self.picking = nil
        invoke.reject("TBV couldn't show the Files picker.")
        return
      }
      shown.present(picker, animated: true)
    }
  }

  /// Moves picked copies out of the picker's inbox, which the system may
  /// empty, into a folder of TBV's own. Copies from earlier picks that are
  /// over a day old are cleared away first. Ones to keep go where nothing
  /// clears them.
  private func keepPicked(_ urls: [URL], forGood: Bool) -> [String] {
    let files = FileManager.default
    if forGood, let support = files.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
      let here = support.appendingPathComponent("Kept", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
      try? files.createDirectory(at: here, withIntermediateDirectories: true)
      return urls.map { url in
        let target = here.appendingPathComponent(url.lastPathComponent)
        return (try? files.moveItem(at: url, to: target)) != nil ? target.path : url.path
      }
    }
    guard let caches = files.urls(for: .cachesDirectory, in: .userDomainMask).first else { return urls.map(\.path) }
    let picked = caches.appendingPathComponent("Picked", isDirectory: true)
    let dayAgo = Date().addingTimeInterval(-86_400)
    for old in (try? files.contentsOfDirectory(at: picked, includingPropertiesForKeys: [.creationDateKey])) ?? [] {
      let made = (try? old.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
      if made < dayAgo { try? files.removeItem(at: old) }
    }
    let here = picked.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try? files.createDirectory(at: here, withIntermediateDirectories: true)
    return urls.map { url in
      let target = here.appendingPathComponent(url.lastPathComponent)
      if (try? files.moveItem(at: url, to: target)) != nil { return target.path }
      if (try? files.copyItem(at: url, to: target)) != nil { return target.path }
      return url.path
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = picking else { return }
    picking = nil
    if pickingFiles {
      pickingFiles = false
      invoke.resolve(["paths": keepPicked(urls, forGood: keepingPicked)])
      return
    }
    guard let url = urls.first, url.startAccessingSecurityScopedResource() else {
      invoke.reject("TBV wasn't allowed into that folder.")
      return
    }
    var saved = UserDefaults.standard.dictionary(forKey: TbvPlugin.foldersKey) as? [String: Data] ?? [:]
    if let bookmark = try? url.bookmarkData() {
      saved[url.path] = bookmark
      UserDefaults.standard.set(saved, forKey: TbvPlugin.foldersKey)
    }
    invoke.resolve(["path": url.path])
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    guard let invoke = picking else { return }
    picking = nil
    pickingFiles = false
    invoke.resolve(["cancelled": true])
  }

  /// What kind of device this is: "iPhone" or "iPad".
  @objc public func deviceKind(_ invoke: Invoke) throws {
    invoke.resolve(["kind": UIDevice.current.model])
  }

  /// Asks for a picture from Photos (a profile picture). It's saved as a
  /// JPEG in TBV's own folder; answers its path, or no path if cancelled.
  @objc public func pickPhoto(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      if let earlier = self.picking {
        earlier.resolve(["cancelled": true])
      }
      var config = PHPickerConfiguration()
      config.filter = .images
      config.selectionLimit = 1
      let picker = PHPickerViewController(configuration: config)
      picker.delegate = self
      guard let shown = self.manager.viewController else {
        invoke.reject("TBV couldn't show your photos.")
        return
      }
      self.picking = invoke
      self.pickingFiles = false
      shown.present(picker, animated: true)
    }
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let invoke = picking else { return }
    picking = nil
    guard let item = results.first?.itemProvider, item.canLoadObject(ofClass: UIImage.self) else {
      invoke.resolve(["cancelled": true])
      return
    }
    item.loadObject(ofClass: UIImage.self) { object, _ in
      guard let image = object as? UIImage, let jpeg = image.jpegData(compressionQuality: 0.9) else {
        invoke.reject("That photo couldn't be read.")
        return
      }
      let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        .appendingPathComponent("Picked", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
      try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let target = folder.appendingPathComponent("photo.jpg")
      do {
        try jpeg.write(to: target)
        invoke.resolve(["path": target.path])
      } catch {
        invoke.reject("That photo couldn't be saved.")
      }
    }
  }

  /// Browse › Browser: shows, moves, hides or steers the web view.
  @objc public func browser(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(BrowserArgs.self)
    TbvBrowser.shared.act(args, invoke)
  }

  /// The browser's next event (a page, or a download), once there is one.
  @objc public func browserEvent(_ invoke: Invoke) throws {
    TbvBrowser.shared.next(invoke)
  }

  /// Where the browser's downloads wait.
  @objc public func browserDownloads(_ invoke: Invoke) throws {
    invoke.resolve(["path": TbvBrowser.downloadsFolder.path])
  }

  override func load(webview: WKWebView) {
    TbvBrowser.shared.tbv = webview
  }

  /// Brings down a file iCloud hasn't kept on the phone yet, waiting until
  /// it's here. Answers whether it arrived.
  @objc public func fetchFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    let url = URL(fileURLWithPath: args.path)
    DispatchQueue.global(qos: .userInitiated).async {
      let files = FileManager.default
      try? files.startDownloadingUbiquitousItem(at: url)
      // Reading through a coordinator makes iCloud bring the file down first.
      var failed: NSError?
      NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &failed) { _ in }
      let giveUp = Date().addingTimeInterval(600)
      while !files.fileExists(atPath: url.path) && Date() < giveUp {
        Thread.sleep(forTimeInterval: 0.5)
      }
      invoke.resolve(["ok": files.fileExists(atPath: url.path)])
    }
  }

  /// Asks iCloud for the latest of a folder or file: a coordinated read
  /// makes it catch up first, since on a phone it doesn't always notice new
  /// files another device made. Gives up waiting after 20 seconds.
  @objc public func refreshItem(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    let url = URL(fileURLWithPath: args.path)
    DispatchQueue.global(qos: .userInitiated).async {
      let done = DispatchSemaphore(value: 0)
      DispatchQueue.global(qos: .userInitiated).async {
        try? FileManager.default.startDownloadingUbiquitousItem(at: url)
        var failed: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &failed) { _ in }
        done.signal()
      }
      _ = done.wait(timeout: .now() + 20)
      invoke.resolve(["ok": true])
    }
  }

  /// Shows a sign-in page over TBV. Its answer goes to TBV's own listener on
  /// this phone, which only hears it while TBV stays in front, as it does here.
  @objc public func openSignIn(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url) else {
      invoke.reject("That sign-in address isn't valid.")
      return
    }
    DispatchQueue.main.async {
      self.signIn?.cancel()
      // The answer comes back to TBV's listener, never to this scheme.
      let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "tbv-signin") { _, _ in }
      session.presentationContextProvider = self
      self.signIn = session
      if session.start() {
        invoke.resolve(["ok": true])
      } else {
        invoke.reject("TBV couldn't open the sign-in page.")
      }
    }
  }

  @objc public func closeSignIn(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      self.signIn?.cancel()
      self.signIn = nil
      invoke.resolve(["ok": true])
    }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return manager.viewController?.view.window ?? ASPresentationAnchor()
  }
}

@_cdecl("init_plugin_tbv")
func initPlugin() -> Plugin {
  return TbvPlugin()
}
