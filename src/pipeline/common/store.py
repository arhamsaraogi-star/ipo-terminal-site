"""Repository data access + schema validation. The only module that knows the on-disk layout."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterator

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[3]
SCHEMAS = ROOT / "schemas"
RULES = ROOT / "rules"
DATA = ROOT / "data"
IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> str:
    return datetime.now(IST).replace(microsecond=0).isoformat()


# ---------- schemas ----------
def _registry() -> Registry:
    reg = Registry()
    for p in SCHEMAS.glob("*.schema.json"):
        reg = reg.with_resource(p.name, Resource.from_contents(json.loads(p.read_text())))
    return reg


_REG = None


def validator(schema_file: str, pointer: str | None = None) -> Draft202012Validator:
    global _REG
    _REG = _REG or _registry()
    ref = schema_file + (f"#/$defs/{pointer}" if pointer else "")
    return Draft202012Validator({"$ref": ref}, registry=_REG, format_checker=FormatChecker())


def schema_errors(obj: Any, schema_file: str, pointer: str | None = None) -> list[str]:
    return [f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}"
            for e in validator(schema_file, pointer).iter_errors(obj)]


# ---------- rules ----------
def event_types() -> dict[str, dict]:
    return yaml.safe_load((RULES / "event_types.yaml").read_text())


def lockin_rules() -> list[dict]:
    return yaml.safe_load((RULES / "lockin.yaml").read_text())["rules"]


# ---------- io ----------
def read_json(p: Path, default: Any = None) -> Any:
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def write_json(p: Path, obj: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=False) + "\n", encoding="utf-8")


def read_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def write_jsonl(p: Path, rows: list[dict]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


@dataclass
class CompanyBundle:
    company: dict
    offerings: list = field(default_factory=list)
    facts: dict | None = None
    documents: list = field(default_factory=list)
    events: list = field(default_factory=list)
    lockins: list = field(default_factory=list)
    news: list = field(default_factory=list)


def company_dirs(data: Path = DATA) -> Iterator[Path]:
    yield from sorted(p for p in (data / "companies").iterdir() if (p / "company.json").exists())


def load_company(d: Path) -> CompanyBundle:
    return CompanyBundle(
        company=read_json(d / "company.json"),
        offerings=read_json(d / "offerings.json", []),
        facts=read_json(d / "facts.json"),
        documents=read_json(d / "documents.json", []),
        events=read_jsonl(d / "events.jsonl"),
        lockins=read_json(d / "lockins.json", []),
        news=read_jsonl(d / "news.jsonl"),
    )


def save_company(b: CompanyBundle, data: Path = DATA) -> Path:
    d = data / "companies" / b.company["company_id"]
    write_json(d / "company.json", b.company)
    write_json(d / "offerings.json", b.offerings)
    if b.facts is not None:
        write_json(d / "facts.json", b.facts)
    write_json(d / "documents.json", b.documents)
    write_jsonl(d / "events.jsonl", b.events)
    write_json(d / "lockins.json", b.lockins)
    write_jsonl(d / "news.jsonl", b.news)
    return d
