#!/usr/bin/env python3
"""Signing for one Mac App Store build, made through the App Store Connect
API and taken away again when the build is done (as ios_ci_certificate.py
does for the iPhone).

    mac_ci_signing.py certificates <out-dir>   makes the app and installer certificates
    mac_ci_signing.py profile <cert-id> <file> makes the Mac App Store profile
    mac_ci_signing.py has-mac                  whether the app has a macOS version in App Store Connect
    mac_ci_signing.py clean <id>...            revokes certificates and deletes profiles

Each made thing's id is printed as NAME=id, for $GITHUB_ENV.
"""

import base64
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ios_ci_certificate import OPENSSL, call  # noqa: E402

BUNDLE_ID = "com.krowsingre.theboundvigil"


def certificate(out: Path, kind: str, name: str) -> str:
    key, csr = out / f"{name}.key.pem", out / f"{name}.csr"
    subprocess.run([OPENSSL, "genrsa", "-out", str(key), "2048"], check=True, capture_output=True)
    subprocess.run([OPENSSL, "req", "-new", "-key", str(key), "-subj", "/CN=The Bound Vigil Mac build", "-out", str(csr)], check=True)
    made = call(
        "POST",
        "/certificates",
        {"data": {"type": "certificates", "attributes": {"certificateType": kind, "csrContent": csr.read_text()}}},
    )["data"]
    (out / f"{name}.cer").write_bytes(base64.b64decode(made["attributes"]["certificateContent"]))
    return made["id"]


def certificates(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    print(f"MAC_APP_CERTIFICATE_ID={certificate(out, 'MAC_APP_DISTRIBUTION', 'app')}")
    print(f"MAC_INSTALLER_CERTIFICATE_ID={certificate(out, 'MAC_INSTALLER_DISTRIBUTION', 'installer')}")


def bundle_id() -> str:
    found = call("GET", f"/bundleIds?filter[identifier]={BUNDLE_ID}&limit=5")["data"]
    exact = [b for b in found if b["attributes"]["identifier"] == BUNDLE_ID]
    if not exact:
        raise SystemExit(f"No App ID {BUNDLE_ID} in the Apple developer account")
    return exact[0]["id"]


def profile(certificate_id: str, file: str) -> None:
    import time

    made = call(
        "POST",
        "/profiles",
        {
            "data": {
                "type": "profiles",
                "attributes": {"name": f"TBV Mac build {int(time.time())}", "profileType": "MAC_APP_STORE"},
                "relationships": {
                    "bundleId": {"data": {"type": "bundleIds", "id": bundle_id()}},
                    "certificates": {"data": [{"type": "certificates", "id": certificate_id}]},
                },
            }
        },
    )["data"]
    Path(file).write_bytes(base64.b64decode(made["attributes"]["profileContent"]))
    print(f"MAC_PROFILE_ID={made['id']}")


def has_mac() -> None:
    apps = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}&limit=1")["data"]
    if not apps:
        raise SystemExit(1)
    versions = call("GET", f"/apps/{apps[0]['id']}/appStoreVersions?filter[platform]=MAC_OS&limit=1")["data"]
    raise SystemExit(0 if versions else 1)


def clean(ids: list) -> None:
    for made in ids:
        kind, _, made_id = made.partition(":")
        if not made_id:
            continue
        try:
            call("DELETE", f"/{'profiles' if kind == 'profile' else 'certificates'}/{made_id}")
            print(f"Removed {kind} {made_id}", file=sys.stderr)
        except SystemExit as error:
            print(error, file=sys.stderr)


if __name__ == "__main__":
    command, *rest = sys.argv[1:] or ["help"]
    if command == "certificates" and len(rest) == 1:
        certificates(rest[0])
    elif command == "profile" and len(rest) == 2:
        profile(*rest)
    elif command == "has-mac" and not rest:
        has_mac()
    elif command == "clean":
        clean(rest)
    else:
        raise SystemExit(__doc__)
