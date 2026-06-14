#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.operator_registry_audit_view import build_audit_view, to_html, to_json, to_markdown
from lib.operator_registry_loader import RegistryLoadError, RegistryValidationError


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="operator_registry_audit")
    sub = parser.add_subparsers(dest="cmd", required=True)
    audit = sub.add_parser("audit")
    audit.add_argument("--format", choices=["json", "md", "html"], default="json")
    audit.add_argument("--out")
    audit.add_argument("--registry")
    audit.add_argument("--harness-root")
    return parser


def _render(args: argparse.Namespace) -> tuple[str, int]:
    root = Path(args.harness_root) if args.harness_root else None
    reg = Path(args.registry) if args.registry else None
    view = build_audit_view(harness_root=root, registry_path=reg)
    if args.format == "json":
        text = json.dumps(to_json(view), indent=2, ensure_ascii=False)
    elif args.format == "md":
        text = to_markdown(view)
    else:
        tpl = root / "templates" / "html-artifact.visual-template.html" if root else None
        text = to_html(view, tpl)
    return text, 2 if (not view.schema_ok or view.summary.get("error_count", 0)) else 0


def main() -> int:
    args = _parser().parse_args()
    try:
        text, code = _render(args)
        if args.out:
            Path(args.out).write_text(text, encoding="utf-8")
        else:
            print(text)
        return code
    except RegistryValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except (OSError, RegistryLoadError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
