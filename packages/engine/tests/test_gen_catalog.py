"""Catalog generator tests — card data, upstream artifact wiring, warnings."""

import json
from pathlib import Path

from botforge_engine.generators import catalog
from botforge_engine.generators.base import BuildContext
from botforge_engine.loader import load_registry, load_robot, resolve

REPO_ROOT = Path(__file__).resolve().parents[3]


def _ctx(robot_id: str, tmp_path: Path) -> BuildContext:
    registry = load_registry(REPO_ROOT / "registry")
    bundle = load_robot(REPO_ROOT / "robots" / robot_id)
    resolved = resolve(bundle, registry)
    dist_dir = tmp_path / "dist" / resolved.robot.id
    dist_dir.mkdir(parents=True, exist_ok=True)
    return BuildContext(
        resolved=resolved, robot_dir=bundle.robot_dir, dist_dir=dist_dir, registry=registry
    )


def _write_upstream(ctx: BuildContext) -> None:
    bom_dir = ctx.dist_dir / "bom"
    bom_dir.mkdir(parents=True, exist_ok=True)
    (bom_dir / "bom.json").write_text(
        json.dumps({"totals": {"estimated_total_usd": 23.34}}) + "\n", encoding="utf-8"
    )
    print_dir = ctx.dist_dir / "print"
    print_dir.mkdir(parents=True, exist_ok=True)
    (print_dir / "print_plan.json").write_text(
        json.dumps({"totals": {"grams": 73.0, "minutes": 280}}) + "\n", encoding="utf-8"
    )


def test_rover_card_with_upstream_artifacts(tmp_path: Path) -> None:
    ctx = _ctx("rover-v1", tmp_path)
    _write_upstream(ctx)
    catalog.run(ctx)
    card = json.loads((ctx.dist_dir / "catalog.json").read_text(encoding="utf-8"))
    assert card == {
        "id": "rover-v1",
        "name": "Rover",
        "tagline": "A palm-sized explorer that dodges obstacles and follows lines.",
        "version": "1.0.0",
        "difficulty": "beginner",
        "size_class": "palm",
        "est_build_minutes": 90,
        "hero_color": "#ff6b35",
        "hero_image": "assembly/step-11.png",
        "est_cost_usd": 23.34,
        "print": {"grams": 73.0, "minutes": 280},
        "behaviors": ["avoid", "follow", "pet"],
        "links": {"docs": "/docs/robots/rover-v1/", "download": "/robots/rover-v1#download"},
    }
    assert ctx.report == []


def test_hero_image_uses_last_assembly_step_zero_padded(tmp_path: Path) -> None:
    ctx = _ctx("rover-v1", tmp_path)
    _write_upstream(ctx)
    catalog.run(ctx)
    card = json.loads((ctx.dist_dir / "catalog.json").read_text(encoding="utf-8"))
    assert card["hero_image"] == "assembly/step-11.png"

    ctx_min = _ctx("_test-min", tmp_path)
    catalog.run(ctx_min)
    card_min = json.loads((ctx_min.dist_dir / "catalog.json").read_text(encoding="utf-8"))
    assert card_min["hero_image"] == "assembly/step-02.png"
    assert card_min["id"] == "_test-min"
    assert card_min["behaviors"] == ["blink"]


def test_missing_upstream_files_null_fields_and_warn(tmp_path: Path) -> None:
    ctx = _ctx("rover-v1", tmp_path)
    catalog.run(ctx)
    card = json.loads((ctx.dist_dir / "catalog.json").read_text(encoding="utf-8"))
    assert card["est_cost_usd"] is None
    assert card["print"] == {"grams": None, "minutes": None}
    assert any("bom/bom.json" in msg for msg in ctx.report)
    assert any("print/print_plan.json" in msg for msg in ctx.report)


def test_catalog_is_deterministic(tmp_path: Path) -> None:
    outputs = []
    for sub in ("a", "b"):
        ctx = _ctx("rover-v1", tmp_path / sub)
        _write_upstream(ctx)
        catalog.run(ctx)
        outputs.append((ctx.dist_dir / "catalog.json").read_bytes())
    assert outputs[0] == outputs[1]
    assert outputs[0].endswith(b"\n")
