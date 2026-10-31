"""Makes crates/tbv-core/tests/fixtures/app_attest.json: a stand-in for an
Apple App Attest stamp (root, intermediate and key certificates shaped like
Apple's, an attestation and an assertion), for apple_attest.rs's tests.
Needs the `cryptography` package. Run from the repository's top folder."""

import base64, datetime, hashlib, json, pathlib
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

APP_ID = "TEAMID1234.com.krowsingre.theboundvigil"
PUBLIC_KEY = "a1" * 32  # a device's Ed25519 key, in hex
RECORD = '{"event":"import","projectId":"p1","schema":1}'

def sha(*parts):
    h = hashlib.sha256()
    for p in parts:
        h.update(p)
    return h.digest()

def cbor(v):
    def head(major, n):
        if n < 24: return bytes([major << 5 | n])
        if n < 256: return bytes([major << 5 | 24, n])
        if n < 65536: return bytes([major << 5 | 25]) + n.to_bytes(2, "big")
        return bytes([major << 5 | 26]) + n.to_bytes(4, "big")
    if isinstance(v, int): return head(0, v)
    if isinstance(v, bytes): return head(2, len(v)) + v
    if isinstance(v, str): b = v.encode(); return head(3, len(b)) + b
    if isinstance(v, list): return head(4, len(v)) + b"".join(cbor(x) for x in v)
    if isinstance(v, dict): return head(5, len(v)) + b"".join(cbor(k) + cbor(x) for k, x in v.items())
    raise TypeError(v)

def name(cn):
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Test")])

def cert(subject, issuer, public, signer, algorithm, ca, extra=None):
    now = datetime.datetime(2026, 1, 1)
    b = (x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(public)
         .serial_number(x509.random_serial_number()).not_valid_before(now).not_valid_after(now + datetime.timedelta(days=3650)))
    if ca: b = b.add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
    if extra: b = b.add_extension(extra, critical=False)
    return b.sign(signer, algorithm)

root_key = ec.generate_private_key(ec.SECP384R1())
mid_key = ec.generate_private_key(ec.SECP384R1())
leaf_key = ec.generate_private_key(ec.SECP256R1())
root = cert(name("Test Root"), name("Test Root"), root_key.public_key(), root_key, hashes.SHA384(), True)
mid = cert(name("Test CA 1"), name("Test Root"), mid_key.public_key(), root_key, hashes.SHA384(), True)

point = leaf_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
cred = sha(point)
rp = sha(APP_ID.encode())
auth = rp + bytes([0x40]) + (0).to_bytes(4, "big") + b"appattest\0\0\0\0\0\0\0" + len(cred).to_bytes(2, "big") + cred
nonce = sha(auth, sha(PUBLIC_KEY.encode()))
ext = x509.UnrecognizedExtension(x509.ObjectIdentifier("1.2.840.113635.100.8.2"), bytes([0x30, 0x24, 0xA1, 0x22, 0x04, 0x20]) + nonce)
leaf = cert(name(cred.hex()), name("Test CA 1"), leaf_key.public_key(), mid_key, hashes.SHA256(), False, ext)

der = lambda c: c.public_bytes(serialization.Encoding.DER)
attestation = cbor({"fmt": "apple-appattest", "attStmt": {"x5c": [der(leaf), der(mid)], "receipt": b"r"}, "authData": auth})
assertion_data = rp + bytes([0x00]) + (1).to_bytes(4, "big")
signature = leaf_key.sign(sha(assertion_data, sha(RECORD.encode())), ec.ECDSA(hashes.SHA256()))
assertion = cbor({"signature": signature, "authenticatorData": assertion_data})
b64 = lambda b: base64.b64encode(b).decode()
stamp = json.dumps({"keyId": b64(cred), "attestation": b64(attestation), "assertion": b64(assertion)})

out = pathlib.Path("crates/tbv-core/tests/fixtures/app_attest.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"root": b64(der(root)), "appId": APP_ID, "publicKey": PUBLIC_KEY, "record": RECORD, "stamp": stamp}, indent=1) + "\n")
print("wrote", out)
