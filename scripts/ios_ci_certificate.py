#!/usr/bin/env python3
"""A signing certificate for one iPhone build, made through the App Store
Connect API and revoked when the build is done.

Xcode would otherwise make a new Apple Development certificate on every
fresh build machine and leave it behind, until the account reaches Apple's
limit and signing stops.

    ios_ci_certificate.py create <out-dir>   prints the certificate's id
    ios_ci_certificate.py revoke <id>
    ios_ci_certificate.py clear-old          revokes every Development certificate

Reads APPLE_API_KEY_ID, APPLE_API_ISSUER and the key at
~/private_keys/AuthKey_<id>.p8. Uses only the standard library and openssl.
"""

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.appstoreconnect.apple.com/v1"
OPENSSL = "/usr/bin/openssl" if Path("/usr/bin/openssl").exists() else "openssl"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def der_to_raw(der: bytes) -> bytes:
    """An ECDSA signature from openssl (DER) as the r||s pair JWTs use."""
    def read_int(at: int):
        assert der[at] == 0x02
        length = der[at + 1]
        value = der[at + 2 : at + 2 + length].lstrip(b"\0")
        return value.rjust(32, b"\0"), at + 2 + length

    at = 2 if der[1] < 0x80 else 3
    r, at = read_int(at)
    s, _ = read_int(at)
    return r + s


def token() -> str:
    key_id = os.environ["APPLE_API_KEY_ID"]
    key = Path.home() / "private_keys" / f"AuthKey_{key_id}.p8"
    header = b64url(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}).encode())
    now = int(time.time())
    claims = {"iss": os.environ["APPLE_API_ISSUER"], "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"}
    signing = f"{header}.{b64url(json.dumps(claims).encode())}"
    der = subprocess.run([OPENSSL, "dgst", "-sha256", "-sign", str(key)], input=signing.encode(), capture_output=True, check=True).stdout
    return f"{signing}.{b64url(der_to_raw(der))}"


def call(method: str, path: str, body=None):
    request = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            text = response.read()
            return json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        raise SystemExit(f"App Store Connect said {error.code} to {method} {path}: {error.read().decode(errors='replace')}")


def create(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    key, csr = out / "key.pem", out / "request.csr"
    subprocess.run([OPENSSL, "genrsa", "-out", str(key), "2048"], check=True, capture_output=True)
    subprocess.run([OPENSSL, "req", "-new", "-key", str(key), "-subj", "/CN=The Bound Vigil build", "-out", str(csr)], check=True)
    made = call(
        "POST",
        "/certificates",
        {"data": {"type": "certificates", "attributes": {"certificateType": "DEVELOPMENT", "csrContent": csr.read_text()}}},
    )["data"]
    (out / "certificate.cer").write_bytes(base64.b64decode(made["attributes"]["certificateContent"]))
    print(made["id"])


def revoke(certificate_id: str) -> None:
    call("DELETE", f"/certificates/{certificate_id}")
    print(f"Revoked {certificate_id}", file=sys.stderr)


def clear_old() -> None:
    found = call("GET", "/certificates?filter[certificateType]=DEVELOPMENT,IOS_DEVELOPMENT&limit=200")["data"]
    for certificate in found:
        revoke(certificate["id"])
    print(f"Revoked {len(found)} old Development certificates", file=sys.stderr)


if __name__ == "__main__":
    command, *rest = sys.argv[1:] or ["help"]
    if command == "create" and len(rest) == 1:
        create(rest[0])
    elif command == "revoke" and len(rest) == 1:
        revoke(rest[0])
    elif command == "clear-old" and not rest:
        clear_old()
    else:
        raise SystemExit(__doc__)
