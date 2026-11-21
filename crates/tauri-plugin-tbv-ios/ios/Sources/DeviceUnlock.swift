import LocalAuthentication
import Tauri

// Face ID or Touch ID as a shortcut to the Hidden collection's password
// (embre, 21 November). Only says whether the person passed: the books are
// hidden, not locked, so nothing is kept in the Keychain for this.

struct DeviceUnlockArgs: Decodable {
  let reason: String
}

extension TbvPlugin {
  /// Which of Face ID, Touch ID or Optic ID this device has set up, or none.
  @objc public func deviceUnlockKind(_ invoke: Invoke) throws {
    let context = LAContext()
    var problem: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &problem) else {
      invoke.resolve(["kind": "none"])
      return
    }
    switch context.biometryType {
    case .faceID: invoke.resolve(["kind": "faceId"])
    case .touchID: invoke.resolve(["kind": "touchId"])
    default:
      if #available(iOS 17.0, *), context.biometryType == .opticID {
        invoke.resolve(["kind": "opticId"])
      } else {
        invoke.resolve(["kind": "none"])
      }
    }
  }

  /// Asks for Face ID or Touch ID; true when the person passed.
  @objc public func deviceUnlock(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(DeviceUnlockArgs.self)
    let context = LAContext()
    // The TBV password is the way in when the face or finger isn't recognised.
    context.localizedFallbackTitle = ""
    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: args.reason) { passed, _ in
      invoke.resolve(["ok": passed])
    }
  }
}
