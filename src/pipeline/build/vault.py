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


# ───────────────────────── IPOV3: self-service accounts ─────────────────────────
# Layout:
#   magic  b"IPOV3"            5 bytes
#   hlen   uint32 big-endian   4 bytes
#   header UTF-8 JSON          {"v":3,"iters":N,"salt":hex,"repo":"owner/name","mk":{"iv":hex,"wk":hex}}
#   iv                         12 bytes
#   ct                         rest  AES-256-GCM(DEK, gzip(JSON), aad=b"IPOV3")
# DEK: fresh random key per build, wrapped with the master key MK = PBKDF2-SHA-256(access code, public salt, iters).
# The access code is the TERMINAL_PASSPHRASE secret. Members sign up in the browser once with it; their browser then
# stores MK wrapped under their own password (users/<uid>.key on the `userdata` branch), so afterwards they sign in
# with username + password on any device. No password or access code is ever in the repo.
MAGIC3 = b"IPOV3"
MIN_ACCESS_CODE = 6


def seal_v3(payload: dict, access_code: str, public_salt: bytes, iterations: int = ITERATIONS, repo: str | None = None) -> bytes:
    if len(access_code) < MIN_ACCESS_CODE:
        raise ValueError(f"access code must be at least {MIN_ACCESS_CODE} characters")
    mk = derive_key(access_code, public_salt, iterations)
    dek = os.urandom(32)
    iv_k = os.urandom(12)
    wk = AESGCM(mk).encrypt(iv_k, dek, b"IPOV3-dek")
    header = json.dumps({"v": 3, "iters": iterations, "salt": public_salt.hex(), "repo": repo,
                         "mk": {"iv": iv_k.hex(), "wk": wk.hex()}}, separators=(",", ":")).encode()
    iv = os.urandom(12)
    plain = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), mtime=0)
    return MAGIC3 + struct.pack(">I", len(header)) + header + iv + AESGCM(dek).encrypt(iv, plain, MAGIC3)


def open_v3(blob: bytes, access_code: str) -> dict:
    if blob[:5] != MAGIC3:
        raise ValueError("not an IPOV3 vault")
    (hl,) = struct.unpack(">I", blob[5:9])
    h = json.loads(blob[9:9 + hl])
    mk = derive_key(access_code, bytes.fromhex(h["salt"]), h["iters"])
    dek = AESGCM(mk).decrypt(bytes.fromhex(h["mk"]["iv"]), bytes.fromhex(h["mk"]["wk"]), b"IPOV3-dek")
    rest = blob[9 + hl:]
    return json.loads(gzip.decompress(AESGCM(dek).decrypt(rest[:12], rest[12:], MAGIC3)))
