// swift-tools-version:5.3

import PackageDescription

let package = Package(
    name: "tauri-plugin-tbv-ios",
    platforms: [
        .iOS(.v14),
    ],
    products: [
        .library(
            name: "tauri-plugin-tbv-ios",
            type: .static,
            targets: ["tauri-plugin-tbv-ios"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-tbv-ios",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"),
    ]
)
