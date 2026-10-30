import UIKit

/// TBV's own Rust: this phone's push address, and whether it's for Apple's test service.
@_silgen_name("tbv_push_token")
func tbvPushToken(_ token: UnsafePointer<CChar>, _ sandbox: Bool)

/// Silent pushes from TBV's push server, sent when another device of the
/// library has sent changes: iOS wakes TBV, which syncs once (the same
/// sync as the background refresh in BackgroundWork.swift). Nothing is
/// shown and nothing needs the person's permission.
///
/// iOS hands push addresses and pushes only to the app's delegate, which
/// Tauri owns, so the two answers are added to the delegate's class here.
final class TbvPush: NSObject {
  static let shared = TbvPush()
  private var started = false

  func start() {
    NotificationCenter.default.addObserver(
      self, selector: #selector(launched), name: UIApplication.didFinishLaunchingNotification, object: nil)
    // Already open (started late): carry on now.
    DispatchQueue.main.async { self.launched() }
  }

  @objc private func launched() {
    guard !started, let delegate = UIApplication.shared.delegate else { return }
    started = true
    let target: AnyClass = type(of: delegate)

    let gotAddress: @convention(block) (AnyObject, UIApplication, Data) -> Void = { _, _, token in
      let hex = token.map { String(format: "%02x", $0) }.joined()
      #if DEBUG
        let sandbox = true
      #else
        let sandbox = false
      #endif
      hex.withCString { tbvPushToken($0, sandbox) }
    }
    Self.answer(
      target, "application:didRegisterForRemoteNotificationsWithDeviceToken:",
      imp_implementationWithBlock(unsafeBitCast(gotAddress, to: AnyObject.self)), "v@:@@")

    let woken: @convention(block) (AnyObject, UIApplication, NSDictionary, @escaping @convention(block) (UIBackgroundFetchResult) -> Void) -> Void = { _, _, _, done in
      tbvBackgroundSync { finished in
        DispatchQueue.main.async { done(finished ? .newData : .failed) }
      }
    }
    Self.answer(
      target, "application:didReceiveRemoteNotification:fetchCompletionHandler:",
      imp_implementationWithBlock(unsafeBitCast(woken, to: AnyObject.self)), "v@:@@@?")

    UIApplication.shared.registerForRemoteNotifications()
  }

  /// Gives the delegate's class an answer to `selector`. Tauri's delegate
  /// has none of its own for these; were one ever there, TBV's replaces it.
  private static func answer(_ target: AnyClass, _ selector: String, _ imp: IMP, _ types: String) {
    let name = NSSelectorFromString(selector)
    if !class_addMethod(target, name, imp, types), let method = class_getInstanceMethod(target, name) {
      method_setImplementation(method, imp)
    }
  }
}
