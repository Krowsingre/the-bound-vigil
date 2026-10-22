import AVFoundation
import AuthenticationServices
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

class PathArgs: Decodable {
  let path: String
}

class UrlArgs: Decodable {
  let url: String
}

/// The iPhone app's own pieces: folders chosen in Files (iCloud Drive's
/// library folder), iCloud files brought down when TBV reads them, and
/// audiobooks that keep playing with the screen locked.
class TbvPlugin: Plugin, UIDocumentPickerDelegate, ASWebAuthenticationPresentationContextProviding {
  /// Folders chosen in Files, by path, kept as bookmarks so TBV can open
  /// them again after a restart.
  private static let foldersKey = "tbv.folders"
  private var picking: Invoke?
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

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = picking else { return }
    picking = nil
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
    invoke.resolve(["cancelled": true])
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
