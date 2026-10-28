import UIKit
import UniformTypeIdentifiers

/// Receives user-selected files and stages them for The Bound Vigil.
/// This extension does not attempt to bypass another app's export or DRM restrictions.
final class ShareViewController: UIViewController {
    private let groupID = "group.com.krowsingre.theboundvigil"
    private let inboxName = "IncomingShares"
    private var hasStarted = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !hasStarted else { return }
        hasStarted = true
        receive()
    }

    private func receive() {
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID) else {
            finish(error: "Shared storage is unavailable.")
            return
        }
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        guard !providers.isEmpty else {
            finish(error: "No files were provided.")
            return
        }
        let inbox = root.appendingPathComponent(inboxName, isDirectory: true)
        let batchID = UUID().uuidString
        // Hidden until all attachment copies have completed.
        let batch = inbox.appendingPathComponent("." + batchID, isDirectory: true)
        let publishedBatch = inbox.appendingPathComponent(batchID, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: batch, withIntermediateDirectories: true)
        } catch {
            finish(error: "Unable to prepare shared storage.")
            return
        }

        let group = DispatchGroup()
        let lock = NSLock()
        var copied = 0
        for provider in providers {
            // A packed EPUB when one is offered; Apple Books may offer only
            // the unpacked folder (a package), which TBV packs up itself.
            let types = provider.registeredTypeIdentifiers
            guard let type = types.first(where: { $0 == "org.idpf.epub-container" }) ?? types.first(where: {
                guard let ut = UTType($0) else { return false }
                return ut.conforms(to: .data) || ut.conforms(to: .content) || ut.conforms(to: .audio) || ut.conforms(to: .package)
            }) else { continue }
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                defer { group.leave() }
                guard let url = url else { return }
                // The suggested name can lack the extension TBV tells formats by.
                var rawName = provider.suggestedName ?? url.lastPathComponent
                if URL(fileURLWithPath: rawName).pathExtension.isEmpty && !url.pathExtension.isEmpty {
                    rawName += "." + url.pathExtension
                }
                let safeName = URL(fileURLWithPath: rawName).lastPathComponent
                guard !safeName.isEmpty && safeName != "." && safeName != ".." else { return }
                // Each attachment has its own directory, so original filenames
                // remain unchanged even when two attachments have the same name.
                let attachmentFolder = batch.appendingPathComponent(UUID().uuidString, isDirectory: true)
                let destination = attachmentFolder.appendingPathComponent(safeName)
                do {
                    try FileManager.default.createDirectory(at: attachmentFolder, withIntermediateDirectories: true)
                    try FileManager.default.copyItem(at: url, to: destination)
                    lock.lock()
                    copied += 1
                    lock.unlock()
                } catch {
                    // Another attachment may still be valid.
                }
            }
        }
        group.notify(queue: .main) {
            // The last write to copied happens before group completion.
            if copied == 0 {
                try? FileManager.default.removeItem(at: batch)
                self.finish(error: "No supported files could be copied.")
            } else {
                do {
                    try FileManager.default.moveItem(at: batch, to: publishedBatch)
                    self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                } catch {
                    self.finish(error: "Unable to finish staging shared files.")
                }
            }
        }
    }

    private func finish(error: String) {
        let alert = UIAlertController(title: "The Bound Vigil", message: error, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            self.extensionContext?.cancelRequest(withError: NSError(
                domain: "TheBoundVigil.ShareExtension", code: 1,
                userInfo: [NSLocalizedDescriptionKey: error]))
        })
        present(alert, animated: true)
    }
}
