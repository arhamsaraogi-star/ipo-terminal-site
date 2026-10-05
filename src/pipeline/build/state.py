"""Encrypted pipeline state, so the whole system can live in ONE public repository.

data/ (companies, events, documents, news, changes, extracted text) is never committed in plaintext.
Each run: unpack state -> ingest -> pack state -> force-push to the orphan `state` branch (single commit,
so the repo does not grow). Same IPOV1 format and passphrase as the site vault.

    python -m pipeline.build.state pack   state.enc     # data/ -> encrypted blob
    python -m pipeline.build.state unpack state.enc     # encrypted blob -> data/
"""
from __future__ import annotations

import io
import json
import os
import sys
import tarfile
from pathlib import Path

from pipeline.build.vault import ITERATIONS, open_vault, seal
from pipeline.common.store import DATA, ROOT, read_json


def _pw() -> str:
    pw = os.environ.get("TERMINAL_PASSPHRASE", "")
    if not pw:
        sys.exit("TERMINAL_PASSPHRASE is not set")
    return pw


def pack(out: Path) -> None:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        t.add(DATA, arcname="data", filter=lambda ti: None if ti.name.endswith((".pyc", ".DS_Store")) else ti)
    import base64
    cfg = read_json(ROOT / "config" / "vault.json", {})
    blob = seal({"tar_b64": base64.b64encode(buf.getvalue()).decode()}, _pw(), cfg.get("iterations", ITERATIONS),
                bytes.fromhex(cfg["salt"]) if cfg.get("salt") else None)
    out.write_bytes(blob)
    print(f"state packed: {len(blob):,} bytes")


def unpack(src: Path) -> None:
    import base64
    payload = open_vault(src.read_bytes(), _pw())
    raw = base64.b64decode(payload["tar_b64"])
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as t:
        for m in t.getmembers():
            if not m.name.startswith("data") or ".." in Path(m.name).parts or m.issym() or m.islnk():
                raise SystemExit(f"refusing unsafe path in state: {m.name}")
        t.extractall(ROOT, filter="data")
    n = len(list((DATA / "companies").glob("*/company.json")))
    print(f"state unpacked: {n} companies")


if __name__ == "__main__":
    cmd, path = sys.argv[1], Path(sys.argv[2])
    {"pack": pack, "unpack": unpack}[cmd](path)
    json.dumps({})
