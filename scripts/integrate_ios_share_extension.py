#!/usr/bin/env python3
"""Add TBV's Share Extension and Home Screen widgets to the actual
Tauri-generated XcodeGen project.

Run after 'tauri ios init --ci', before 'tauri ios build'.
Does not touch the checked-in Tauri configuration.
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
widget_source = root / "ios-widgets"
widget_dir = apple / "TBVWidgets"
GROUP = ["group.com.krowsingre.theboundvigil"]

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
widget_dir.mkdir(parents=True, exist_ok=True)
for name in ("TBVWidgets.swift", "Info.plist", "Widgets.entitlements"):
    shutil.copy2(widget_source / name, widget_dir / name)

spec = spec.replace(host_dependencies,
    "    dependencies:\n      - target: TBVShareExtension\n        embed: true\n"
    "      - target: TBVWidgets\n        embed: true\n"
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
      properties:
        CFBundleDisplayName: The Bound Vigil
        NSExtension:
          NSExtensionPointIdentifier: com.apple.share-services
          NSExtensionPrincipalClass: $(PRODUCT_MODULE_NAME).ShareViewController
          NSExtensionAttributes:
            NSExtensionActivationRule:
              NSExtensionActivationSupportsFileWithMaxCount: 20
              NSExtensionActivationSupportsAttachmentsWithMaxCount: 20
    entitlements:
      path: TBVShareExtension/ShareExtension.entitlements
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.krowsingre.theboundvigil.ShareExtension
        PRODUCT_NAME: TBVShareExtension
        SWIFT_VERSION: "5.0"
        CODE_SIGN_STYLE: Automatic
        CODE_SIGN_ENTITLEMENTS: TBVShareExtension/ShareExtension.entitlements
        DEVELOPMENT_TEAM: {team}
        SKIP_INSTALL: true
        APPLICATION_EXTENSION_API_ONLY: true

  TBVWidgets:
    type: app-extension
    platform: iOS
    deploymentTarget: "16.0"
    sources:
      - path: TBVWidgets/TBVWidgets.swift
    info:
      path: TBVWidgets/Info.plist
      properties:
        CFBundleDisplayName: The Bound Vigil
        NSExtension:
          NSExtensionPointIdentifier: com.apple.widgetkit-extension
    entitlements:
      path: TBVWidgets/Widgets.entitlements
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.krowsingre.theboundvigil.Widgets
        PRODUCT_NAME: TBVWidgets
        SWIFT_VERSION: "5.0"
        CODE_SIGN_STYLE: Automatic
        CODE_SIGN_ENTITLEMENTS: TBVWidgets/Widgets.entitlements
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
# Silent pushes from TBV's push server (Push.swift). TestFlight and the App
# Store use Apple's real push service.
entitlements["aps-environment"] = "production"
with host_entitlements.open("wb") as f:
    plistlib.dump(entitlements, f)
# XcodeGen regenerates target entitlements as well; restore the declared
# App Group after project generation, just as for the host target.
extension_entitlements = target_dir / "ShareExtension.entitlements"
with extension_entitlements.open("rb") as f:
    extension_data = plistlib.load(f)
extension_data["com.apple.security.application-groups"] = ["group.com.krowsingre.theboundvigil"]
with extension_entitlements.open("wb") as f:
    plistlib.dump(extension_data, f)
with extension_entitlements.open("rb") as f:
    extension_verified = plistlib.load(f)
if extension_verified.get("com.apple.security.application-groups") != ["group.com.krowsingre.theboundvigil"]:
    raise SystemExit("Share Extension App Group entitlement file verification failed")

# The widgets read what TBV writes into the same App Group.
widget_entitlements = widget_dir / "Widgets.entitlements"
with widget_entitlements.open("rb") as f:
    widget_data = plistlib.load(f)
widget_data["com.apple.security.application-groups"] = GROUP
with widget_entitlements.open("wb") as f:
    plistlib.dump(widget_data, f)
with widget_entitlements.open("rb") as f:
    if plistlib.load(f).get("com.apple.security.application-groups") != GROUP:
        raise SystemExit("Widgets App Group entitlement file verification failed")

with host_entitlements.open("rb") as f:
    verified = plistlib.load(f)
if verified.get("com.apple.security.application-groups") != ["group.com.krowsingre.theboundvigil"]:
    raise SystemExit("Host App Group entitlement verification failed")
if verified.get("aps-environment") != "production":
    raise SystemExit("Host push entitlement verification failed")
print("Share Extension and widget targets generated and App Group entitlements verified")
