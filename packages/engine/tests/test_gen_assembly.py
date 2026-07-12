"""Assembly generator tests against the real registry + robots (PLAN Phase 1.9).

Fake ``cad/stl/<part>.stl`` files are synthesized up front so these tests do
not depend on the cad generator being implemented.
"""

from pathlib import Path

import json

import trimesh
from PIL import Image

from botforge_engine.generators import assembly
from botforge_engine.generators.base import BuildContext
from botforge_engine.loader import load_registry, load_robot, resolve

REPO_ROOT = Path(__file__).resolve().parents[3]


def _make_ctx(robot_id: str, tmp_path: Path, with_stls: bool = True) -> BuildContext:
    registry = load_registry(REPO_ROOT / "registry")
    bundle = load_robot(REPO_ROOT / "robots" / robot_id)
    resolved = resolve(bundle, registry)
    dist_dir = tmp_path / robot_id
    dist_dir.mkdir(parents=True, exist_ok=True)
    if with_stls:
        stl_dir = dist_dir / "cad" / "stl"
        stl_dir.mkdir(parents=True, exist_ok=True)
        for part in resolved.printed_parts:
            trimesh.creation.box(extents=[30.0, 24.0, 8.0]).export(stl_dir / f"{part.id}.stl")
    return BuildContext(
        resolved=resolved, robot_dir=bundle.robot_dir, dist_dir=dist_dir, registry=registry
    )


def test_test_min_steps_json_schema_and_renders(tmp_path: Path) -> None:
    ctx = _make_ctx("_test-min", tmp_path)
    assembly.run(ctx)
    out = ctx.dist_dir / "assembly"

    data = json.loads((out / "steps.json").read_text(encoding="utf-8"))
    assert data["robot_id"] == "_test-min"
    assert len(data["steps"]) == 2
    first, second = data["steps"]
    assert set(first) == {"id", "title", "note", "adds", "fasteners", "image"}
    assert first["image"] == "step-01.png"
    assert second["image"] == "step-02.png"
    assert first["adds"] == ["core"]
    assert first["fasteners"] == ["m2x6_selftap x2"]
    assert first["note"] is None
    assert second["adds"] == ["eyes", "buzz"]
    assert second["fasteners"] == []
    assert second["note"] == "Press-fit both boards."

    # renders happened (EGL available in this environment) at 1600x1200
    assert not [msg for msg in ctx.report if "renders skipped" in msg], ctx.report
    for name in ("step-01.png", "step-02.png"):
        assert (out / name).is_file()
        with Image.open(out / name) as img:
            assert img.size == (1600, 1200)
    # step 2 highlights different parts, so the image content must differ
    assert (out / "step-01.png").read_bytes() != (out / "step-02.png").read_bytes()


def test_rover_steps_and_wheel_instance_poses(tmp_path: Path) -> None:
    ctx = _make_ctx("rover-v1", tmp_path)
    assembly.run(ctx)
    out = ctx.dist_dir / "assembly"

    data = json.loads((out / "steps.json").read_text(encoding="utf-8"))
    assert data["robot_id"] == "rover-v1"
    assert len(data["steps"]) == 11
    assert [step["image"] for step in data["steps"]] == [
        f"step-{i:02d}.png" for i in range(1, 12)
    ]
    # step 1 ("Print check") has empty adds but still renders the base state
    assert data["steps"][0]["adds"] == []
    assert data["steps"][0]["fasteners"] == []
    # step 11 adds wheel@1/wheel@2 — pose lookup with the @n suffix must work
    assert "wheel@1" in data["steps"][10]["adds"]
    assert "wheel@2" in data["steps"][10]["adds"]
    assert not [msg for msg in ctx.report if "has no pose" in msg], ctx.report
    assert not [msg for msg in ctx.report if "no STL" in msg], ctx.report
    assert not [msg for msg in ctx.report if "renders skipped" in msg], ctx.report

    pngs = sorted(path.name for path in out.glob("step-*.png"))
    assert pngs == [f"step-{i:02d}.png" for i in range(1, 12)]
    for name in pngs:
        with Image.open(out / name) as img:
            assert img.size == (1600, 1200)
    assert (out / "step-01.png").read_bytes() != (out / "step-02.png").read_bytes()


def test_steps_json_deterministic_across_runs(tmp_path: Path) -> None:
    ctx_a = _make_ctx("_test-min", tmp_path / "a")
    ctx_b = _make_ctx("_test-min", tmp_path / "b")
    assembly.run(ctx_a)
    assembly.run(ctx_b)
    payload_a = (ctx_a.dist_dir / "assembly" / "steps.json").read_bytes()
    payload_b = (ctx_b.dist_dir / "assembly" / "steps.json").read_bytes()
    assert payload_a == payload_b
    assert payload_a.endswith(b"\n")
    assert b"timestamp" not in payload_a


def test_missing_stls_fall_back_to_box_with_warning(tmp_path: Path) -> None:
    ctx = _make_ctx("_test-min", tmp_path, with_stls=False)
    assembly.run(ctx)
    assert any("no STL for printed part 'plate'" in msg for msg in ctx.report), ctx.report
    # steps.json and renders are still produced from the fallback geometry
    assert (ctx.dist_dir / "assembly" / "steps.json").is_file()
    assert (ctx.dist_dir / "assembly" / "step-01.png").is_file()
