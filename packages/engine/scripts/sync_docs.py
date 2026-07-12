#!/usr/bin/env python3
"""Sync a robot's generated docs bundle into the Astro docs app.

Usage (from packages/engine)::

    uv run python scripts/sync_docs.py <robot_id> [--dist DIR] [--docs-app DIR]

Copies ``dist/<robot_id>/docs/`` to
``apps/docs/src/content/docs/robots/<robot_id>/`` (delete-then-copy so removed
pages don't linger). Defaults are resolved from the repo root — the first
ancestor of this script containing an ``apps`` directory.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path


def find_repo_root(start: Path) -> Path | None:
    """Walk up from *start* until a directory containing ``apps`` is found."""
    for candidate in (start, *start.parents):
        if (candidate / "apps").is_dir():
            return candidate
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Copy dist/<robot_id>/docs into the Astro docs app content tree."
    )
    parser.add_argument("robot_id", help="Robot id, e.g. rover-v1")
    parser.add_argument(
        "--dist",
        type=Path,
        default=None,
        help="Dist root directory (default: <repo-root>/dist).",
    )
    parser.add_argument(
        "--docs-app",
        type=Path,
        default=None,
        help="Docs app directory (default: <repo-root>/apps/docs).",
    )
    args = parser.parse_args(argv)

    repo_root = find_repo_root(Path(__file__).resolve().parent)
    dist_root = args.dist if args.dist is not None else (repo_root and repo_root / "dist")
    docs_app = (
        args.docs_app if args.docs_app is not None else (repo_root and repo_root / "apps" / "docs")
    )
    if dist_root is None or docs_app is None:
        print(
            "sync_docs: could not locate repo root (no 'apps' directory above this script); "
            "pass --dist and --docs-app explicitly",
            file=sys.stderr,
        )
        return 1

    source = Path(dist_root) / args.robot_id / "docs"
    if not source.is_dir():
        print(
            f"sync_docs: no docs bundle at {source} — run `botforge build` first",
            file=sys.stderr,
        )
        return 1

    dest = Path(docs_app) / "src" / "content" / "docs" / "robots" / args.robot_id
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, dest)

    copied = sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file())
    print(f"synced {len(copied)} file(s) -> {dest}")
    for rel in copied:
        print(f"  {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
