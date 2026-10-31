import AppKit
import Foundation
import StoreKit

// Buying TBV in the Mac App Store, the same two plans as on iPhone and
// iPad (one purchase covers them all). Each function waits for the App
// Store and answers in JSON, which the caller frees with free().

private func answer(_ value: [String: Any]) -> UnsafeMutablePointer<CChar>? {
  let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
  return strdup(String(decoding: data, as: UTF8.self))
}

/// Runs `work` and waits for it: the caller is one of TBV's own threads, never the main one.
private func wait(_ work: @escaping () async -> [String: Any]) -> UnsafeMutablePointer<CChar>? {
  let done = DispatchSemaphore(value: 0)
  var result: [String: Any] = [:]
  Task.detached {
    result = await work()
    done.signal()
  }
  done.wait()
  return answer(result)
}

private var listening = false

/// Finishes purchases that arrive outside the purchase sheet: renewals,
/// Ask to Buy approvals, refunds, seats given or taken away. What they change
/// shows the next time TBV asks the App Store.
private func listenForUpdates() {
  if listening { return }
  listening = true
  Task.detached {
    for await update in Transaction.updates {
      if case .verified(let t) = update { await t.finish() }
    }
  }
}

/// Which plans are owned, their prices, and whether the free month is on offer.
@_cdecl("tbv_mac_store_status")
public func storeStatus(_ lifetimeId: UnsafePointer<CChar>, _ yearlyId: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  let lifetimeProduct = String(cString: lifetimeId)
  let yearlyProduct = String(cString: yearlyId)
  return wait {
    var lifetime = false
    var yearly = false
    var shared = false
    var lifetimeShared = false
    listenForUpdates()
    for await entitlement in Transaction.currentEntitlements {
      guard case .verified(let t) = entitlement, t.revocationDate == nil else { continue }
      // Bought by someone else (family, or a seat an organisation gave them).
      if t.productID == lifetimeProduct {
        lifetime = true
        lifetimeShared = t.ownershipType != .purchased
      }
      if t.productID == yearlyProduct, (t.expirationDate ?? .distantFuture) > Date() {
        yearly = true
        shared = t.ownershipType != .purchased
      }
    }
    let products = (try? await Product.products(for: [lifetimeProduct, yearlyProduct])) ?? []
    let plan = products.first { $0.id == yearlyProduct }
    // A renewal that couldn't be charged keeps the plan through Apple's
    // billing grace period (16 days) while Apple tries again.
    if !yearly, let statuses = try? await plan?.subscription?.status {
      for s in statuses {
        if case .verified(let t) = s.transaction, t.productID == yearlyProduct, t.revocationDate == nil, s.state == .inGracePeriod {
          yearly = true
          shared = t.ownershipType != .purchased
        }
      }
    }
    var freeMonth = false
    if let sub = plan?.subscription, sub.introductoryOffer?.paymentMode == .freeTrial {
      freeMonth = await sub.isEligibleForIntroOffer
    }
    return [
      "lifetime": lifetime,
      "yearly": yearly,
      "price": (products.first { $0.id == lifetimeProduct }?.displayPrice).map { $0 as Any } ?? NSNull(),
      "yearlyPrice": (plan?.displayPrice).map { $0 as Any } ?? NSNull(),
      "freeMonth": freeMonth,
      "shared": shared,
      "lifetimeShared": lifetimeShared,
    ]
  }
}

/// Buys with the sheet attached to TBV's own window. Without one, the Mac
/// can open the sheet behind TBV, which then looks stuck while it waits.
private func purchase(_ product: Product) async throws -> Product.PurchaseResult {
  if #available(macOS 15.2, *) {
    let window = await MainActor.run { () -> NSWindow? in
      NSApp.activate(ignoringOtherApps: true)
      return NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first { $0.isVisible }
    }
    if let window {
      return try await product.purchase(confirmIn: window)
    }
  }
  return try await product.purchase()
}

/// The App Store's sheet for buying a plan. `ok` is false if it was cancelled.
@_cdecl("tbv_mac_store_buy")
public func storeBuy(_ productId: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  let id = String(cString: productId)
  return wait {
    do {
      guard let product = try await Product.products(for: [id]).first else {
        return ["error": "The App Store isn't offering that plan yet."]
      }
      switch try await purchase(product) {
      case .success(let result):
        guard case .verified(let t) = result else { return ["error": "The App Store couldn't confirm the purchase."] }
        await t.finish()
        return ["ok": true]
      case .pending:
        // Ask to Buy, or the bank wants a check: it goes through later.
        return ["ok": false, "pending": true]
      case .userCancelled:
        return ["ok": false]
      @unknown default:
        return ["ok": false]
      }
    } catch {
      return ["error": error.localizedDescription]
    }
  }
}

/// Asks the App Store for purchases made before (it may ask to sign in).
@_cdecl("tbv_mac_store_restore")
public func storeRestore() -> UnsafeMutablePointer<CChar>? {
  return wait {
    do {
      try await AppStore.sync()
      return ["ok": true]
    } catch {
      return ["error": error.localizedDescription]
    }
  }
}
