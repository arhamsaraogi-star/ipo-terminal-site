"""Encrypted vault format, shared with src/web/src/lib/vault.ts.

Layout (binary):
  magic  b"IPOV1"          5 bytes
  iters  uint32 big-endian 4 bytes   PBKDF2-SHA-256 iterations
  salt                     16 bytes
  iv                       12 bytes  AES-GCM nonce
  ct                       rest      AES-256-GCM(gzip(utf-8 JSON)) incl. 16-byte tag

The passphrase is NEVER stored in the repo. CI reads it from the TERMINAL_PASSPHRASE secret.
The salt is public and stable (config/vault.json) so a browser that chose "remember this device" keeps
working across daily builds; rotate it together with the passphrase. The IV is fresh for every build.
"""
from __future__ import annotations

import gzip
import json
import os
import struct

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MAGIC = b"IPOV1"
ITERATIONS = 600_000
MIN_PASSPHRASE = 12


def derive_key(passphrase: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(passphrase.encode("utf-8"))


def seal(payload: dict, passphrase: str, iterations: int = ITERATIONS, salt: bytes | None = None) -> bytes:
    if len(passphrase) < MIN_PASSPHRASE:
        raise ValueError(f"passphrase must be at least {MIN_PASSPHRASE} characters")
    salt = salt or os.urandom(16)
    if len(salt) != 16:
        raise ValueError("salt must be 16 bytes")
    iv = os.urandom(12)
    plain = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), mtime=0)
    ct = AESGCM(derive_key(passphrase, salt, iterations)).encrypt(iv, plain, MAGIC)
    return MAGIC + struct.pack(">I", iterations) + salt + iv + ct


def open_vault(blob: bytes, passphrase: str) -> dict:
    if blob[:5] != MAGIC:
        raise ValueError("not an IPOV1 vault")
    (iters,) = struct.unpack(">I", blob[5:9])
    salt, iv, ct = blob[9:25], blob[25:37], blob[37:]
    plain = AESGCM(derive_key(passphrase, salt, iters)).decrypt(iv, ct, MAGIC)
    return json.loads(gzip.decompress(plain))


# ───────────────────────── IPOV2: named users ─────────────────────────
# Layout:
#   magic  b"IPOV2"            5 bytes
#   hlen   uint32 big-endian   4 bytes
#   header UTF-8 JSON          hlen bytes  {"v":2,"iters":N,"users":[{"u":uid,"iv":hex,"wk":hex}]}
#   iv                         12 bytes
#   ct                         rest  AES-256-GCM(DEK, gzip(JSON), aad=b"IPOV2")
# A fresh random data key (DEK) encrypts the payload on every build; it is wrapped once per user with
#   KEK = first 32 bytes of PBKDF2-SHA-256(password, salt_u, iters, 64)   (bytes 32-64 are the user's sync key, browser-only)
#   salt_u = SHA-256(public_salt || uid)[:16]   — stable, so "remember this device" survives rebuilds
#   uid    = SHA-256("ipo-terminal-user:" + lower(username))[:24 hex]   — usernames are never published
# Users and passwords come only from the TERMINAL_USERS secret ("username:password" per line).
import hashlib

MAGIC2 = b"IPOV2"
MIN_PASSWORD = 8


def user_id(username: str) -> str:
    return hashlib.sha256(("ipo-terminal-user:" + username.strip().lower()).encode()).hexdigest()[:24]


def user_salt(public_salt: bytes, uid: str) -> bytes:
    return hashlib.sha256(public_salt + uid.encode()).digest()[:16]


def parse_users(text: str) -> list[tuple[str, str]]:
    out = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        u, p = line.split(":", 1)
        u, p = u.strip(), p.strip()
        if not u or len(p) < MIN_PASSWORD:
            raise ValueError(f"user '{u or '?'}': password must be at least {MIN_PASSWORD} characters")
        out.append((u, p))
    if not out:
        raise ValueError("no users defined")
    return out


def _kek(password: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=64, salt=salt, iterations=iterations)
    return kdf.derive(password.encode("utf-8"))[:32]


def seal_v2(payload: dict, users: list[tuple[str, str]], public_salt: bytes, iterations: int = ITERATIONS) -> bytes:
    dek = os.urandom(32)
    entries = []
    for username, password in users:
        uid = user_id(username)
        iv_u = os.urandom(12)
        wk = AESGCM(_kek(password, user_salt(public_salt, uid), iterations)).encrypt(iv_u, dek, b"IPOV2-key:" + uid.encode())
        entries.append({"u": uid, "iv": iv_u.hex(), "wk": wk.hex()})
    header = json.dumps({"v": 2, "iters": iterations, "salt": public_salt.hex(), "users": entries}, separators=(",", ":")).encode()
    iv = os.urandom(12)
    plain = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), mtime=0)
    ct = AESGCM(dek).encrypt(iv, plain, MAGIC2)
    return MAGIC2 + struct.pack(">I", len(header)) + header + iv + ct


def open_v2(blob: bytes, username: str, password: str) -> dict:
    if blob[:5] != MAGIC2:
        raise ValueError("not an IPOV2 vault")
    (hl,) = struct.unpack(">I", blob[5:9])
    h = json.loads(blob[9:9 + hl])
    uid = user_id(username)
    e = next((x for x in h["users"] if x["u"] == uid), None)
    if not e:
        raise ValueError("unknown user")
    kek = _kek(password, user_salt(bytes.fromhex(h["salt"]), uid), h["iters"])
    dek = AESGCM(kek).decrypt(bytes.fromhex(e["iv"]), bytes.fromhex(e["wk"]), b"IPOV2-key:" + uid.encode())
    rest = blob[9 + hl:]
    return json.loads(gzip.decompress(AESGCM(dek).decrypt(rest[:12], rest[12:], MAGIC2)))
