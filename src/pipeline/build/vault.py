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
