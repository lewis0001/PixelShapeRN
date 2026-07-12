"""Catalog generator — website card data into dist/<id>/catalog.json.

Implements PLAN Phase 1.13: one JSON card per robot for the website grid.
Cost and print totals are read from the upstream ``bom/bom.json`` and
``print/print_plan.json`` artifacts (the generator order runs bom before
catalog in real builds); when an upstream file is missing the corresponding
fields are ``null`` and a warning lands in ``ctx.report``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from botforge_engine.generators.base import BuildContext

name = "catalog"


def _load_json(ctx: BuildContext, rel: str, fields: str) -> dict[str, Any] | None:
    """Parse ``dist/<rel>`` if present, else warn (``fields`` names what goes null)."""
    path = ctx.dist_dir / Path(rel)
    if not path.is_file():
        ctx.report.append(f"catalog: {rel} not found — {fields} null")
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        ctx.report.append(f"catalog: could not read {rel} ({exc}) — {fields} null")
        return None
    return data if isinstance(data, dict) else None


def _round2(value: Any) -> float | int | None:
    return round(value, 2) if isinstance(value, (int, float)) else None


def run(ctx: BuildContext) -> None:
    """Write ``catalog.json`` at the dist root."""
    resolved = ctx.resolved
    robot = resolved.robot

    steps = resolved.assembly.steps
    hero_image: str | None = None
    if steps:
        hero_image = f"assembly/step-{len(steps):02d}.png"
    else:
        ctx.report.append("catalog: robot has no assembly steps — hero_image null")

    est_cost_usd: float | int | None = None
    bom = _load_json(ctx, "bom/bom.json", "est_cost_usd")
    if bom is not None:
        est_cost_usd = _round2(bom.get("totals", {}).get("estimated_total_usd"))

    grams: float | int | None = None
    minutes: float | int | None = None
    plan = _load_json(ctx, "print/print_plan.json", "print totals")
    if plan is not None:
        totals = plan.get("totals", {})
        if isinstance(totals, dict):
            grams = _round2(totals.get("grams"))
            minutes = _round2(totals.get("minutes"))

    card: dict[str, Any] = {
        "id": robot.id,
        "name": robot.name,
        "tagline": robot.tagline,
        "version": robot.version,
        "difficulty": robot.difficulty,
        "size_class": robot.size_class,
        "est_build_minutes": robot.est_build_minutes,
        "hero_color": robot.hero_color,
        "hero_image": hero_image,
        "est_cost_usd": est_cost_usd,
        "print": {"grams": grams, "minutes": minutes},
        "behaviors": [behavior.id for behavior in resolved.behaviors],
        "links": {
            "docs": f"/docs/robots/{robot.id}/",
            "download": f"/robots/{robot.id}#download",
        },
    }
    out_path = ctx.dist_dir / "catalog.json"
    out_path.write_text(json.dumps(card, indent=2) + "\n", encoding="utf-8")
