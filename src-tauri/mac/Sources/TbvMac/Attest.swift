import CryptoKit
import DeviceCheck
import Foundation

// Apple's App Attest on the Mac, the same as on iPhone and iPad
// (crates/tauri-plugin-tbv-ios TbvPlugin.appAttest): a Secure Enclave key
// Apple certifies once, tied to this device's signing key, then an
// assertion from it for each Scribe record. Answers JSON the caller frees
// with free(): keyId, attestation and assertion, or unsupported.

private func reply(_ value: [String: Any]) -> UnsafeMutablePointer<CChar>? {
  let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
  return strdup(String(decoding: data, as: UTF8.self))
}

@_cdecl("tbv_mac_app_attest")
public func appAttest(_ publicKeyText: UnsafePointer<CChar>, _ recordText: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  let publicKey = String(cString: publicKeyText)
  let record = String(cString: recordText)
  let service = DCAppAttestService.shared
  guard service.isSupported else { return reply(["unsupported": true]) }
  let defaults = UserDefaults.standard
  let keyName = "tbv.appAttest.keyId"
  let attestationName = "tbv.appAttest.attestation"
  let forName = "tbv.appAttest.publicKey"
  let recordHash = Data(SHA256.hash(data: Data(record.utf8)))
  let done = DispatchSemaphore(value: 0)
  var result: [String: Any] = ["unsupported": true]

  func stamp(_ keyId: String, _ attestation: String) {
    service.generateAssertion(keyId, clientDataHash: recordHash) { assertion, error in
      if let assertion = assertion, error == nil {
        result = ["keyId": keyId, "attestation": attestation, "assertion": assertion.base64EncodedString()]
      } else {
        defaults.removeObject(forKey: keyName)
      }
      done.signal()
    }
  }

  if let keyId = defaults.string(forKey: keyName), let attestation = defaults.string(forKey: attestationName),
    defaults.string(forKey: forName) == publicKey
  {
    stamp(keyId, attestation)
  } else {
    service.generateKey { keyId, error in
      guard let keyId = keyId, error == nil else {
        done.signal()
        return
      }
      let keyHash = Data(SHA256.hash(data: Data(publicKey.utf8)))
      service.attestKey(keyId, clientDataHash: keyHash) { attestation, error in
        guard let attestation = attestation, error == nil else {
          done.signal()
          return
        }
        let encoded = attestation.base64EncodedString()
        defaults.set(keyId, forKey: keyName)
        defaults.set(encoded, forKey: attestationName)
        defaults.set(publicKey, forKey: forName)
        stamp(keyId, encoded)
      }
    }
  }
  // TBV calls this from one of its own threads, never the main one.
  done.wait()
  return reply(result)
}
