"""CAD generator tests: real registry + robots (_test-min, rover-v1) end to end."""

import json
import math
from pathlib import Path

import pytest
import trimesh

from botforge_engine.generators import cad
from botforge_engine.generators.base import BuildContext
from botforge_engine.loader import load_registry, load_robot, resolve

REPO_ROOT = Path(__file__).resolve().parents[3]
ROBOT_IDS = ("_test-min", "rover-v1")
FORMATS = (("stl", "stl"), ("step", "step"), ("3mf", "3mf"))


@pytest.fixture(scope="module")
def builds(tmp_path_factory) -> dict[str, BuildContext]:
    """Run the cad generator for both real robots into per-module tmp dists."""
    registry = load_registry(REPO_ROOT / "registry")
    contexts: dict[str, BuildContext] = {}
    for robot_id in ROBOT_IDS:
        robot_dir = REPO_ROOT / "robots" / robot_id
        resolved = resolve(load_robot(robot_dir), registry)
        dist_dir = tmp_path_factory.mktemp("dist" + robot_id.replace("_", "-")) / robot_id
        dist_dir.mkdir(parents=True)
        ctx = BuildContext(
            resolved=resolved, robot_dir=robot_dir, dist_dir=dist_dir, registry=registry
        )
        cad.run(ctx)
        contexts[robot_id] = ctx
    return contexts


def _mesh(ctx: BuildContext, part_id: str) -> trimesh.Trimesh:
    return trimesh.load_mesh(str(ctx.dist_dir / "cad" / "stl" / f"{part_id}.stl"), validate=True)


@pytest.mark.parametrize("robot_id", ROBOT_IDS)
def test_every_part_has_stl_step_3mf(builds, robot_id) -> None:
    ctx = builds[robot_id]
    assert ctx.resolved.printed_parts, f"{robot_id} should declare printed parts"
    for part in ctx.resolved.printed_parts:
        for sub, ext in FORMATS:
            path = ctx.dist_dir / "cad" / sub / f"{part.id}.{ext}"
            assert path.is_file(), f"missing {robot_id} {path.name}"
            assert path.stat().st_size > 0, f"empty {robot_id} {path.name}"


@pytest.mark.parametrize("robot_id", ROBOT_IDS)
def test_every_part_watertight_with_positive_volume(builds, robot_id) -> None:
    ctx = builds[robot_id]
    for part in ctx.resolved.printed_parts:
        mesh = _mesh(ctx, part.id)
        assert mesh.is_watertight, f"{robot_id}/{part.id} not watertight"
        assert mesh.volume > 0, f"{robot_id}/{part.id} volume {mesh.volume}"


@pytest.mark.parametrize("robot_id", ROBOT_IDS)
def test_qc_report_parses_and_covers_every_part(builds, robot_id) -> None:
    ctx = builds[robot_id]
    report = json.loads((ctx.dist_dir / "cad" / "qc_report.json").read_text(encoding="utf-8"))
    assert set(report) == {part.id for part in ctx.resolved.printed_parts}
    for part_id, entry in report.items():
        assert entry["watertight"] is True, part_id
        assert entry["volume_mm3"] > 0, part_id
        assert len(entry["bbox"]) == 3, part_id
        assert all(0 < e <= 200 for e in entry["bbox"]), part_id
        assert 0 <= entry["overhang_pct"] <= 100, part_id


def test_rover_chassis_bbox_within_envelope(builds) -> None:
    bbox = _mesh(builds["rover-v1"], "chassis").extents
    assert 90 <= bbox[0] <= 96 + 5, bbox
    assert 68 <= bbox[1] <= 74 + 5, bbox
    assert 5 <= bbox[2] <= 40, bbox


def test_rover_wheel_bore_and_height(builds) -> None:
    mesh = _mesh(builds["rover-v1"], "wheel")
    assert 8 <= mesh.extents[2] <= 16, mesh.extents
    assert 40 <= mesh.extents[0] <= 44, mesh.extents
    # The N20 D-shaft bore (Ø3.2) leaves wall vertices within ~1.7 mm of the axis.
    radii = [math.hypot(x, y) for x, y, _ in mesh.vertices]
    assert min(radii) < 1.75, f"no bore surface near axis (min r={min(radii):.2f})"


def test_no_part_needs_support(builds) -> None:
    warnings = [msg for ctx in builds.values() for msg in ctx.report]
    for msg in warnings:  # surface any sub-threshold report content when debugging
        print("cad warning:", msg)
    for robot_id, ctx in builds.items():
        report = json.loads((ctx.dist_dir / "cad" / "qc_report.json").read_text(encoding="utf-8"))
        for part_id, entry in report.items():
            print(f"{robot_id}/{part_id}: overhang {entry['overhang_pct']}%")
            assert entry["overhang_pct"] <= 2.0, f"{robot_id}/{part_id}: {entry}"
    assert warnings == [], warnings
