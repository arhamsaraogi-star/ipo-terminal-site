"""Generate a new public vault salt. Run together with changing the TERMINAL_PASSPHRASE secret."""
import json, os
from pathlib import Path
p = Path(__file__).resolve().parents[1] / "config" / "vault.json"
cfg = json.loads(p.read_text())
cfg["salt"] = os.urandom(16).hex()
p.write_text(json.dumps(cfg, indent=2) + "\n")
print("new salt written to config/vault.json — commit it and update the TERMINAL_PASSPHRASE secret")
