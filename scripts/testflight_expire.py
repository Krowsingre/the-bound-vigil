#!/usr/bin/env python3
"""Expires TestFlight builds whose version starts with a prefix, on every
platform (iPhone and Mac). Apple doesn't let builds be deleted; an expired
build can no longer be installed and leaves the testers' list.

    testflight_expire.py <prefix> [--dry-run]

Reads the same key as ios_ci_certificate.py.
"""

import sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from ios_ci_certificate import API, call  # noqa: E402

BUNDLE_ID = "com.krowsingre.theboundvigil"


def pages(path: str):
    while path:
        page = call("GET", path)
        yield from page.get("data", [])
        following = (page.get("links") or {}).get("next")
        path = following.removeprefix(API) if following else None


def main() -> None:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        raise SystemExit("Say which versions, e.g. 1.")
    prefix = sys.argv[1].strip()
    dry = "--dry-run" in sys.argv
    apps = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"]
    if not apps:
        raise SystemExit(f"No app with bundle id {BUNDLE_ID}")
    app = apps[0]["id"]
    expired = kept = 0
    for version in pages(f"/preReleaseVersions?filter[app]={app}&limit=200"):
        name = version["attributes"]["version"]
        platform = version["attributes"].get("platform", "")
        if not name.startswith(prefix):
            continue
        for build in pages(f"/preReleaseVersions/{version['id']}/builds?limit=200"):
            attrs = build["attributes"]
            label = f"{platform} {name} ({attrs.get('version')})"
            if attrs.get("expired"):
                kept += 1
                continue
            print(("Would expire " if dry else "Expiring ") + label, flush=True)
            if not dry:
                call("PATCH", f"/builds/{build['id']}", {"data": {"type": "builds", "id": build["id"], "attributes": {"expired": True}}})
            expired += 1
    print(f"{'Would expire' if dry else 'Expired'} {expired} builds; {kept} were already expired.")


if __name__ == "__main__":
    main()
