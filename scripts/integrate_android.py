"""Fits the Android project that `tauri android init` makes for TBV's test version.

- Signs release builds with TBV's own upload key when the ANDROID_KEYSTORE_BASE64
  and ANDROID_KEYSTORE_PASSWORD secrets are there (so each new build installs
  over the last one), or with the build machine's debug key when they aren't
  (a pull request's build, for checking only).
- Turns off Android's own backups, so a phone's activation (and the code it
  was made for) can't be carried to another phone in a backup.

Run from the repository's root after `tauri android init` and `tauri icon`.
"""

import base64
import os
import re
import sys
from pathlib import Path

ANDROID = Path("src-tauri/gen/android")
GRADLE = ANDROID / "app/build.gradle.kts"
MANIFEST = ANDROID / "app/src/main/AndroidManifest.xml"


def fail(message: str) -> None:
    print(f"::error::{message}")
    sys.exit(1)


def signing() -> None:
    source = GRADLE.read_text()
    if "signingConfigs" in source:
        fail("build.gradle.kts already has signing set up; this script expects Tauri's own file.")
    keystore = os.environ.get("ANDROID_KEYSTORE_BASE64", "").strip()
    password = os.environ.get("ANDROID_KEYSTORE_PASSWORD", "").strip()
    if keystore and password:
        store = (ANDROID / "tbv-upload.p12").resolve()
        store.write_bytes(base64.b64decode(keystore))
        (ANDROID / "keystore.properties").write_text(f"password={password}\nkeyAlias=tbv\nstoreFile={store}\n")
        block = """    signingConfigs {
        create("release") {
            val keystoreProperties = Properties()
            keystoreProperties.load(FileInputStream(rootProject.file("keystore.properties")))
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }
"""
        config = 'signingConfig = signingConfigs.getByName("release")'
        print("Signing with TBV's upload key.")
    else:
        block = ""
        config = 'signingConfig = signingConfigs.getByName("debug")'
        print("::warning::The Android signing secrets aren't set, so this build is signed with a throwaway key. It can't install over an earlier build.")
    if block:
        if not re.search(r"(?m)^\s*buildTypes \{", source):
            fail("build.gradle.kts has no buildTypes block.")
        source = re.sub(r"(?m)^(\s*buildTypes \{)", lambda m: block + m.group(1), source, count=1)
        if "import java.io.FileInputStream" not in source:
            source = "import java.io.FileInputStream\n" + source
        if "import java.util.Properties" not in source:
            source = "import java.util.Properties\n" + source
    release = re.search(r'getByName\("release"\)\s*\{', source)
    if not release:
        fail('build.gradle.kts has no getByName("release") build type.')
    source = source[: release.end()] + f"\n            {config}" + source[release.end() :]
    GRADLE.write_text(source)


def no_backups() -> None:
    manifest = MANIFEST.read_text()
    if "android:allowBackup" in manifest:
        manifest = re.sub(r'android:allowBackup="[^"]*"', 'android:allowBackup="false"', manifest)
    else:
        manifest, count = re.subn(r"<application\b", '<application android:allowBackup="false"', manifest, count=1)
        if count != 1:
            fail("AndroidManifest.xml has no <application> element.")
    MANIFEST.write_text(manifest)


if __name__ == "__main__":
    if not GRADLE.exists() or not MANIFEST.exists():
        fail("Run `npx tauri android init --ci` first.")
    signing()
    no_backups()
    print("The Android project is ready.")
