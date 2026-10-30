// swift-tools-version:5.7
// The Mac app's own Swift: buying through the Mac App Store (StoreKit has
// no other way in). Built and linked by src-tauri/build.rs, Mac only.
import PackageDescription

let package = Package(
  name: "TbvMac",
  platforms: [.macOS(.v13)],
  products: [.library(name: "TbvMac", type: .static, targets: ["TbvMac"])],
  targets: [.target(name: "TbvMac", path: "Sources/TbvMac")]
)
