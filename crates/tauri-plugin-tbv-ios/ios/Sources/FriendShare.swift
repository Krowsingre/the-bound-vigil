import CloudKit
import UIKit

/// Send to a TBV friend (embre, 19 November): books go to another TBV user
/// anywhere, through Apple's CloudKit, with no server of TBV's own.
///
/// Sending puts the books in a zone of the sender's own iCloud (one zone per
/// send, records of type "SentBook" holding each file) and shares the zone
/// read-only with anyone who has its link. The link goes out through the
/// Share sheet. Sends older than 30 days are deleted, so the sender's iCloud
/// doesn't fill up.
///
/// Receiving: tapping the link opens TBV (iOS hands the app delegate the
/// share), or the link is pasted into TBV. Either way the share is accepted,
/// each book is brought down into the shared inbox the share-sheet add-on
/// uses, and TBV adds them as it does shared books.
@available(iOS 15.0, *)
final class TbvFriendShare: NSObject {
  static let shared = TbvFriendShare()
  static let arrived = Notification.Name("TBVFriendBooksArrived")
  private let container = CKContainer(identifier: "iCloud.com.krowsingre.theboundvigil")
  private let recordType = "SentBook"
  private let keepDays: Double = 30
  private var started = false

  /// iOS hands a tapped link only to the app's delegate, which Tauri owns,
  /// so the answer is added to the delegate's class here (as in Push.swift).
  func start() {
    NotificationCenter.default.addObserver(
      self, selector: #selector(launched), name: UIApplication.didFinishLaunchingNotification, object: nil)
    DispatchQueue.main.async { self.launched() }
  }

  @objc private func launched() {
    guard !started, let delegate = UIApplication.shared.delegate else { return }
    started = true
    let target: AnyClass = type(of: delegate)
    let accepted: @convention(block) (AnyObject, UIApplication, CKShare.Metadata) -> Void = { _, _, metadata in
      TbvFriendShare.shared.accept(metadata) { _ in }
    }
    let name = NSSelectorFromString("application:userDidAcceptCloudKitShareWithMetadata:")
    let imp = imp_implementationWithBlock(unsafeBitCast(accepted, to: AnyObject.self))
    if !class_addMethod(target, name, imp, "v@:@@"), let method = class_getInstanceMethod(target, name) {
      method_setImplementation(method, imp)
    }
  }

  // MARK: Sending

  /// Shares the files and answers the link.
  func send(paths: [String], titles: [String], done: @escaping (Result<URL, Error>) -> Void) {
    let db = container.privateCloudDatabase
    let stamp = Int(Date().timeIntervalSince1970)
    let zone = CKRecordZone(zoneName: "Sent-\(stamp)-\(UUID().uuidString)")
    let records: [CKRecord] = paths.enumerated().map { index, path in
      let file = URL(fileURLWithPath: path)
      let record = CKRecord(recordType: recordType, recordID: CKRecord.ID(recordName: UUID().uuidString, zoneID: zone.zoneID))
      record["title"] = (index < titles.count ? titles[index] : file.deletingPathExtension().lastPathComponent) as CKRecordValue
      record["fileName"] = file.lastPathComponent as CKRecordValue
      record["file"] = CKAsset(fileURL: file)
      return record
    }
    let share = CKShare(recordZoneID: zone.zoneID)
    share[CKShare.SystemFieldKey.title] = (titles.count == 1 ? titles[0] : "\(titles.count) books") as CKRecordValue
    share.publicPermission = .readOnly

    let makeZone = CKModifyRecordZonesOperation(recordZonesToSave: [zone], recordZoneIDsToDelete: nil)
    makeZone.qualityOfService = .userInitiated
    makeZone.modifyRecordZonesResultBlock = { result in
      if case .failure(let error) = result {
        done(.failure(error))
        return
      }
      var saved: CKShare?
      let save = CKModifyRecordsOperation(recordsToSave: [share] + records, recordIDsToDelete: nil)
      save.qualityOfService = .userInitiated
      save.perRecordSaveBlock = { _, result in
        if case .success(let record) = result, let record = record as? CKShare { saved = record }
      }
      save.modifyRecordsResultBlock = { result in
        switch result {
        case .failure(let error):
          // Nothing half-sent is left behind.
          db.add(CKModifyRecordZonesOperation(recordZonesToSave: nil, recordZoneIDsToDelete: [zone.zoneID]))
          done(.failure(error))
        case .success:
          if let url = saved?.url ?? share.url {
            done(.success(url))
            self.clearOld()
          } else {
            done(.failure(NSError(domain: "TBV", code: 1, userInfo: [NSLocalizedDescriptionKey: "iCloud didn't give a link for the books."])))
          }
        }
      }
      db.add(save)
    }
    db.add(makeZone)
  }

  /// Deletes sends older than 30 days: their links stop working.
  private func clearOld() {
    let db = container.privateCloudDatabase
    let oldest = Date().timeIntervalSince1970 - keepDays * 24 * 3600
    db.fetchAllRecordZones { zones, _ in
      let old = (zones ?? []).map(\.zoneID).filter { id in
        let parts = id.zoneName.split(separator: "-")
        guard parts.count > 2, parts[0] == "Sent", let at = Double(parts[1]) else { return false }
        return at < oldest
      }
      guard !old.isEmpty else { return }
      db.add(CKModifyRecordZonesOperation(recordZonesToSave: nil, recordZoneIDsToDelete: old))
    }
  }

  // MARK: Receiving

  /// A pasted link: answers how many books came.
  func receive(link: URL, done: @escaping (Result<Int, Error>) -> Void) {
    let fetch = CKFetchShareMetadataOperation(shareURLs: [link])
    fetch.qualityOfService = .userInitiated
    var found: CKShare.Metadata?
    var trouble: Error?
    fetch.perShareMetadataResultBlock = { _, result in
      switch result {
      case .success(let metadata): found = metadata
      case .failure(let error): trouble = error
      }
    }
    fetch.fetchShareMetadataResultBlock = { result in
      if case .failure(let error) = result {
        done(.failure(trouble ?? error))
        return
      }
      guard let metadata = found else {
        done(.failure(trouble ?? Self.problem("That link isn't one TBV can open.")))
        return
      }
      self.accept(metadata, done: done)
    }
    container.add(fetch)
  }

  func accept(_ metadata: CKShare.Metadata, done: @escaping (Result<Int, Error>) -> Void) {
    if metadata.participantRole == .owner {
      done(.failure(Self.problem("That's a link you sent. Your friend opens it on their iPhone or iPad.")))
      return
    }
    let zone = metadata.share.recordID.zoneID
    // Opened before: the books are just brought down again.
    if metadata.participantStatus == .accepted {
      bringDown(zone, done: done)
      return
    }
    let accept = CKAcceptSharesOperation(shareMetadatas: [metadata])
    accept.qualityOfService = .userInitiated
    accept.acceptSharesResultBlock = { result in
      if case .failure(let error) = result {
        done(.failure(error))
        return
      }
      self.bringDown(zone, done: done)
    }
    container.add(accept)
  }

  /// Copies each book into a new batch of the shared inbox, hidden until all
  /// are there, then tells TBV to look.
  private func bringDown(_ zone: CKRecordZone.ID, done: @escaping (Result<Int, Error>) -> Void) {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.krowsingre.theboundvigil") else {
      done(.failure(Self.problem("TBV's shared storage is unavailable.")))
      return
    }
    let inbox = root.appendingPathComponent("IncomingShares", isDirectory: true)
    let batchID = UUID().uuidString
    let batch = inbox.appendingPathComponent("." + batchID, isDirectory: true)
    let published = inbox.appendingPathComponent(batchID, isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: batch, withIntermediateDirectories: true)
    } catch {
      done(.failure(error))
      return
    }
    var count = 0
    let changes = CKFetchRecordZoneChangesOperation(recordZoneIDs: [zone], configurationsByRecordZoneID: nil)
    changes.qualityOfService = .userInitiated
    changes.recordWasChangedBlock = { _, result in
      guard case .success(let record) = result, record.recordType == self.recordType,
            let asset = record["file"] as? CKAsset, let from = asset.fileURL else { return }
      let name = (record["fileName"] as? String).map(Self.safeName) ?? "Book \(count + 1)"
      // The asset's file goes when this block ends, so it's copied now.
      let folder = batch.appendingPathComponent(String(count), isDirectory: true)
      do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: from, to: folder.appendingPathComponent(name))
        count += 1
      } catch {}
    }
    changes.fetchRecordZoneChangesResultBlock = { result in
      if case .failure(let error) = result {
        try? FileManager.default.removeItem(at: batch)
        done(.failure(error))
        return
      }
      guard count > 0 else {
        try? FileManager.default.removeItem(at: batch)
        done(.failure(Self.problem("There were no books behind that link. The sender may have taken them back.")))
        return
      }
      do {
        try FileManager.default.moveItem(at: batch, to: published)
      } catch {
        done(.failure(error))
        return
      }
      DispatchQueue.main.async { NotificationCenter.default.post(name: Self.arrived, object: nil) }
      done(.success(count))
    }
    container.sharedCloudDatabase.add(changes)
  }

  private static func safeName(_ name: String) -> String {
    let cleaned = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
    return cleaned.isEmpty || cleaned.hasPrefix(".") ? "Book" : cleaned
  }

  static func problem(_ text: String) -> Error {
    NSError(domain: "TBV", code: 2, userInfo: [NSLocalizedDescriptionKey: text])
  }

  /// What went wrong, in words.
  static func words(_ error: Error) -> String {
    guard let ck = error as? CKError else { return error.localizedDescription }
    switch ck.code {
    case .notAuthenticated:
      return "Sign in to iCloud in the Settings app first. TBV uses it to pass books between friends."
    case .quotaExceeded:
      return "Your iCloud storage is full, so the books couldn't be sent."
    case .networkUnavailable, .networkFailure, .serviceUnavailable, .requestRateLimited, .zoneBusy:
      return "iCloud couldn't be reached. Check the connection and try again."
    case .unknownItem, .zoneNotFound, .userDeletedZone:
      return "That link doesn't work any more. Links last 30 days; ask your friend to send the book again."
    case .limitExceeded:
      return "That's too much to send at once. Try fewer books."
    case .partialFailure:
      if let first = ck.partialErrorsByItemID?.values.first { return words(first) }
      return ck.localizedDescription
    default:
      return ck.localizedDescription
    }
  }
}

class FriendShareArgs: Decodable {
  let action: String
  let paths: [String]?
  let titles: [String]?
  let link: String?
}
