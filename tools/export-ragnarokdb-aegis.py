#!/usr/bin/env python
"""Export the client equip scripts from the RagnarokDB, read-only.

    python -I -X utf8 tools/export-ragnarokdb-aegis.py <out.json> [path-to-ragnarok.db]

Writes { "<item id>": { "aegis": "<aegisScript>", "desc": "<description>", "servers": [...], "name": "<name>" } }.
The database path defaults to the RAGNAROK_DB environment variable. The file is opened read-only
(`mode=ro&immutable=1`, or `PRAGMA query_only` for a network share): this project never writes to the RagnarokDB. See docs/script-audit.md.
"""
import json
import os
import sqlite3
import sys


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = sys.argv[1]
    path = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("RAGNAROK_DB")
    if not path:
        sys.exit("pass the database path or set RAGNAROK_DB")
    if path.startswith("\\\\") or path.startswith("//"):
        # SQLite cannot take a UNC share as a file: URI; open it plainly and forbid every write.
        con = sqlite3.connect(path)
        con.execute("PRAGMA query_only = ON")
    else:
        con = sqlite3.connect("file:" + path.replace("\\", "/") + "?mode=ro&immutable=1", uri=True)
    items = {}
    for item_id, name, raw in con.execute("SELECT id, name, raw_json FROM items"):
        try:
            data = json.loads(raw) if raw else {}
        except ValueError:
            continue
        items[str(item_id)] = {
            "aegis": data.get("aegisScript") or "",
            "desc": data.get("description") or "",
            "servers": data.get("availableServers") or [],
            "name": name,
        }
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(items, handle, ensure_ascii=False)
    print(f"{len(items)} items -> {out}")


if __name__ == "__main__":
    main()
