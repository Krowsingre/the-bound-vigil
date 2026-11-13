import Foundation
import Tauri
import WidgetKit

// TBV's Home Screen and Lock Screen widgets (ios-widgets/TBVWidgets.swift).
// Kept in its own file: importing WidgetKit beside PhotosUI in
// TbvPlugin.swift hid the photo picker's types from the compiler.
extension TbvPlugin {
  /// The folder TBV's widgets read from, inside the App Group it shares
  /// with them.
  @objc public func widgetFolder(_ invoke: Invoke) throws {
    guard let root = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: "group.com.krowsingre.theboundvigil"
    ) else {
      invoke.reject("TBV's shared storage is unavailable.")
      return
    }
    invoke.resolve(["path": root.appendingPathComponent("Widget", isDirectory: true).path])
  }

  /// Tells the Home Screen and Lock Screen widgets to read again.
  @objc public func reloadWidgets(_ invoke: Invoke) throws {
    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }
    invoke.resolve()
  }
}
