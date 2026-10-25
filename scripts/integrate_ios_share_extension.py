#!/usr/bin/env python3
"""Add TBV's Share Extension to the actual Tauri-generated XcodeGen project.

Run after 'tauri ios init --ci', before 'tauri ios build'.
Does not touch the checked-in Tauri configuration or the main branch.
"""
from pathlib import Path
import plistlib
import shutil
import os
import subprocess

root = Path(__file__).resolve().parents[1]
apple = root / "src-tauri/gen/apple"
project = apple / "project.yml"
host_entitlements = apple / "the-bound-vigil_iOS/the-bound-vigil_iOS.entitlements"
source = root / "ios-share-extension"
target_dir = apple / "TBVShareExtension"

spec = project.read_text()
host_target = "  the-bound-vigil_iOS:\n"
host_dependencies = "    dependencies:\n      - framework: libapp.a\n        embed: false\n"
if spec.count(host_target) != 1 or spec.count(host_dependencies) != 1:
    raise SystemExit("Unexpected generated XcodeGen project layout; refusing to modify it")
if "  TBVShareExtension:\n" in spec:
    raise SystemExit("Share Extension target already exists")

target_dir.mkdir(parents=True, exist_ok=True)
for name in ("ShareViewController.swift", "Info.plist", "ShareExtension.entitlements"):
    shutil.copy2(source / name, target_dir / name)

spec = spec.replace(host_dependencies,
    "    dependencies:\n      - target: TBVShareExtension\n        embed: true\n"
    "      - framework: libapp.a\n        embed: false\n", 1)
team = os.environ.get("APPLE_DEVELOPMENT_TEAM", "").strip()
if not team or not team.isalnum():
    raise SystemExit("APPLE_DEVELOPMENT_TEAM must be supplied")
spec += f"""
  TBVShareExtension:
    type: app-extension
    platform: iOS
    deploymentTarget: "15.0"
    sources:
      - path: TBVShareExtension/ShareViewController.swift
    info:
      path: TBVShareExtension/Info.plist
    entitlements:
      path: TBVShareExtension/ShareExtension.entitlements
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.krowsingre.theboundvigil.ShareExtension
        PRODUCT_NAME: TBVShareExtension
        SWIFT_VERSION: "5.0"
        CODE_SIGN_STYLE: Automatic
        DEVELOPMENT_TEAM: {team}
        SKIP_INSTALL: true
        APPLICATION_EXTENSION_API_ONLY: true
"""
project.write_text(spec)
# XcodeGen regenerates the host entitlement file, so write the App Group
# AFTER regeneration and immediately read it back.
subprocess.run(["xcodegen", "generate"], cwd=apple, check=True)
with host_entitlements.open("rb") as f:
    entitlements = plistlib.load(f)
entitlements["com.apple.security.application-groups"] = ["group.com.krowsingre.theboundvigil"]
with host_entitlements.open("wb") as f:
    plistlib.dump(entitlements, f)
with host_entitlements.open("rb") as f:
    verified = plistlib.load(f)
if verified.get("com.apple.security.application-groups") != ["group.com.krowsingre.theboundvigil"]:
    raise SystemExit("Host App Group entitlement verification failed")
print("Share Extension target generated and host App Group entitlement verified")
