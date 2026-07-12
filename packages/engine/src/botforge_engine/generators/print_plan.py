"""Print-plan generator — slicer estimates per part into dist/<id>/print/print_plan.json.

Runs the PrusaSlicer CLI with ``infra/profiles/pla-0.20.ini`` against each printed
part's STL and parses filament grams + print time from the gcode comments
(PLAN Phase 1.6). When no slicer binary is available (local dev sandboxes;
the CI image ships one) the plan is still written with null estimates.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from botforge_engine.generators.base import BuildContext

name = "print_plan"

PROFILE_NAME = "pla-0.20"

_GRAMS_RE = re.compile(r";\s*(?:total\s+)?filament used \[g\]\s*=\s*([0-9]+(?:\.[0-9]+)?)")
_TIME_NORMAL_RE = re.compile(r";\s*estimated printing time \(normal mode\)\s*=\s*([^\r\n]+)")
_TIME_ANY_RE = re.compile(r";\s*estimated printing time[^=\r\n]*=\s*([^\r\n]+)")
_TIME_TOKEN_RE = re.compile(r"(\d+)\s*([dhms])")

_SECONDS = {"d": 86400, "h": 3600, "m": 60, "s": 1}


def parse_gcode_stats(text: str) -> dict[str, Any]:
    """Parse filament grams and print minutes from PrusaSlicer gcode comments.

    Returns ``{"grams": float | None, "minutes": int | None}``. Grams come from
    ``; filament used [g] = 12.34``; minutes from
    ``; estimated printing time (normal mode) = 1d 2h 3m 45s`` (any subset of
    d/h/m/s tokens), rounded to the nearest whole minute.
    """
    grams: float | None = None
    match = _GRAMS_RE.search(text)
    if match:
        grams = float(match.group(1))

    minutes: int | None = None
    time_match = _TIME_NORMAL_RE.search(text) or _TIME_ANY_RE.search(text)
    if time_match:
        seconds = 0
        found = False
        for value, unit in _TIME_TOKEN_RE.findall(time_match.group(1)):
            seconds += int(value) * _SECONDS[unit]
            found = True
        if found:
            minutes = round(seconds / 60)

    return {"grams": grams, "minutes": minutes}


def _find_slicer() -> str | None:
    """Locate the PrusaSlicer binary (env override first, then PATH)."""
    return (
        os.environ.get("BOTFORGE_PRUSA_SLICER")
        or shutil.which("prusa-slicer")
        or shutil.which("PrusaSlicer")
    )


def _find_profile(robot_dir: Path) -> Path | None:
    """Walk up from *robot_dir* to the repo root (dir containing ``infra``)."""
    start = robot_dir.resolve()
    for candidate in (start, *start.parents):
        if (candidate / "infra").is_dir():
            profile = candidate / "infra" / "profiles" / f"{PROFILE_NAME}.ini"
            return profile if profile.is_file() else None
    return None


def _slice(slicer: str, profile: Path, stl: Path) -> dict[str, Any] | None:
    """Slice one STL and return parsed stats, or ``None`` when slicing fails."""
    with tempfile.TemporaryDirectory(prefix="botforge-slice-") as tmp:
        gcode = Path(tmp) / f"{stl.stem}.gcode"
        base = [slicer, "--export-gcode", "--load", str(profile), "-o", str(gcode), str(stl)]
        # --loglevel keeps newer slicers quiet; retry without it for older builds.
        for cmd in ([*base, "--loglevel", "1"], base):
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            except (OSError, subprocess.TimeoutExpired):
                return None
            if result.returncode == 0 and gcode.is_file():
                return parse_gcode_stats(gcode.read_text(encoding="utf-8", errors="replace"))
    return None


def run(ctx: BuildContext) -> None:
    """Write ``print/print_plan.json`` with per-part filament/time estimates."""
    slicer = _find_slicer()
    profile: Path | None = None
    if slicer is None:
        ctx.report.append("print_plan: prusa-slicer not found — estimates skipped (CI provides it)")
    else:
        profile = _find_profile(ctx.robot_dir)
        if profile is None:
            ctx.report.append(
                f"print_plan: slicer profile infra/profiles/{PROFILE_NAME}.ini not found "
                "— estimates skipped"
            )

    estimated = slicer is not None and profile is not None

    parts: list[dict[str, Any]] = []
    for part in ctx.resolved.printed_parts:
        grams: float | None = None
        minutes: int | None = None
        if estimated:
            stl = ctx.dist_dir / "cad" / "stl" / f"{part.id}.stl"
            if not stl.is_file():
                ctx.report.append(
                    f"print_plan: missing STL for part '{part.id}' "
                    f"(expected cad/stl/{part.id}.stl) — estimates null"
                )
            else:
                stats = _slice(slicer, profile, stl)  # type: ignore[arg-type]
                if stats is None:
                    ctx.report.append(
                        f"print_plan: slicing failed for part '{part.id}' — estimates null"
                    )
                else:
                    grams = stats["grams"]
                    minutes = stats["minutes"]
        parts.append(
            {
                "part_id": part.id,
                "qty": part.qty,
                "grams": round(grams, 2) if grams is not None else None,
                "minutes": minutes,
                "plate_hints": {
                    "orientation": "flat",
                    "material": part.material,
                    "color_role": part.color_role,
                },
            }
        )

    gram_totals = [p["grams"] * p["qty"] for p in parts if p["grams"] is not None]
    minute_totals = [p["minutes"] * p["qty"] for p in parts if p["minutes"] is not None]
    payload = {
        "profile": PROFILE_NAME,
        "estimated": estimated,
        "parts": parts,
        "totals": {
            "grams": round(sum(gram_totals), 2) if gram_totals else None,
            "minutes": sum(minute_totals) if minute_totals else None,
        },
    }

    out = ctx.ensure_dir("print") / "print_plan.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
