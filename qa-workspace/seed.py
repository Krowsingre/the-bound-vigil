import hashlib
import os
import sqlite3
from pathlib import Path

home = Path(os.environ["APPDATA"]) / "com.krowsingre.theboundvigil"
fixture = Path(__file__).with_name("figure.epub").read_bytes()
with sqlite3.connect(home / "library.sqlite3") as connection:
    connection.create_function("tbv_sync_live", 0, lambda: 0)
    for title in ("Split Fixture Alpha", "Split Fixture Beta"):
        path = home / "Library" / (title + ".epub")
        data = fixture + title.encode()
        path.write_bytes(data)
        book = "sha256:" + hashlib.sha256(data).hexdigest()
        connection.execute("INSERT INTO books (id,title,authors,format,file_size,added_at) VALUES (?,?,?,?,?,?)",
                           (book,title,'["TBV Fixture"]',"epub",len(data),"2026-01-01T00:00:00Z"))
        connection.execute("INSERT INTO local_files (book_id,path) VALUES (?,?)", (book,str(path)))
