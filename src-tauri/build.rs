fn main() {
    // The Mac app's own Swift (src-tauri/mac): buying in the Mac App Store.
    #[cfg(target_os = "macos")]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        swift_rs::SwiftLinker::new("13.0").with_package("TbvMac", "mac/").link();
    }
    tauri_build::build()
}
