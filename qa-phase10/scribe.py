import os
import sqlite3
import sys
import time
from pathlib import Path

db = Path(os.environ["APPDATA"]) / "com.krowsingre.theboundvigil" / "library.sqlite3"
stamp = "2026-01-01T00:00:00Z"
with sqlite3.connect(db) as con:
    con.create_function('tbv_sync_live', 0, lambda: 0)
    con.create_function('tbv_sync_device', 0, lambda: 'qa')
    if sys.argv[1] == "seed":
        con.execute("INSERT INTO writing_projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    ("close-probe", "Shutdown Probe", stamp, stamp))
        con.execute("INSERT INTO writing_chapters (id, project_id, title, body, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("close-chapter", "close-probe", "Test Chapter", "<p>Initial words</p>", 0, stamp, stamp))
    elif sys.argv[1] == "lock":
        ready, release = map(Path, sys.argv[2:])
        con.execute("BEGIN IMMEDIATE")
        ready.touch()
        deadline = time.monotonic() + 8
        while not release.exists() and time.monotonic() < deadline:
            time.sleep(.01)
    else:
        body = con.execute("SELECT body FROM writing_chapters WHERE id='close-chapter'").fetchone()[0]
        if "saved on close" not in body:
            raise SystemExit(f"Scribe did not save edit: {body!r}")
        print("Verified Scribe edit persisted after Windows shutdown")

