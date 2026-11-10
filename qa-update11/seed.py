import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

home = Path(os.environ["APPDATA"]) / "com.krowsingre.theboundvigil"
data = Path(__file__).with_name("fixture.epub").read_bytes()
with sqlite3.connect(home / "library.sqlite3") as db:
    db.create_function("tbv_sync_live", 0, lambda: 0)
    for volume in (1, 2):
        title = f"Fixture volume {volume}"
        content = data + bytes([volume])
        filename = home / "Library" / (title + ".epub")
        filename.write_bytes(content)
        book = "sha256:" + hashlib.sha256(content).hexdigest()
        db.execute("INSERT INTO books (id,title,authors,format,file_size,added_at,series,series_index) VALUES (?,?,?,?,?,?,?,?)",
                   (book,title,json.dumps(["Fixture Author"]),"epub",len(content),datetime.now(timezone.utc).isoformat(),"Update Fixture",volume))
        db.execute("INSERT INTO local_files (book_id,path) VALUES (?,?)",(book,str(filename)))
