fn main() {
    // The Mac app's own Swift (src-tauri/mac): buying in the Mac App Store.
    #[cfg(target_os = "macos")]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        swift_rs::SwiftLinker::new("13.0").with_package("TbvMac", "mac/").link();
    }
    // The RAR reader is C++ but doesn't ask for the C++ library, which Android's
    // libc doesn't carry; without this the app can't even start on a phone.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-lib=static=c++_static");
        println!("cargo:rustc-link-lib=static=c++abi");
    }
    tauri_build::build()
}
