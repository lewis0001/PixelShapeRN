"""Golden-file tests for the full build pipeline (PLAN Phase 1.15).

Both fixture robots are built end-to-end with a committed fake slicer (so
print estimates are byte-identical on every machine). Then:

- ``_test-min``: every TEXT artifact is compared in full against the committed
  goldens under ``tests/goldens/_test-min/``.
- ``rover-v1``: every TEXT artifact's sha256 is compared against the committed
  snapshot ``tests/goldens/rover-v1.hashes.json``.
- Both: the §5.6 output inventory must be complete; binary artifacts
  (STL/STEP/3MF/PNG) are checked for existence and non-zero size. SVG output
  is treated as binary because graphviz layout varies across versions (see
  docs/DECISIONS.md).

Run ``uv run pytest tests/test_goldens.py --update-goldens`` after an
intentional generator change, review the diff, and commit it.
"""

import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).parent
REPO_ROOT = TESTS_DIR.parent.parent.parent
GOLDEN_DIR = TESTS_DIR / "goldens"
FAKE_SLICER = TESTS_DIR / "fixtures" / "fake_slicer.sh"

TEXT_SUFFIXES = {".json", ".yaml", ".yml", ".csv", ".md", ".mdx", ".urdf"}
BINARY_SUFFIXES = {".stl", ".step", ".3mf", ".png", ".svg"}


def _is_text(path: Path) -> bool:
    return path.suffix in TEXT_SUFFIXES


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Build both robots into a temp dist with the deterministic fake slicer."""
    dist = tmp_path_factory.mktemp("dist")
    FAKE_SLICER.chmod(FAKE_SLICER.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    env = dict(os.environ, BOTFORGE_PRUSA_SLICER=str(FAKE_SLICER))
    for robot in ("_test-min", "rover-v1"):
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "botforge_engine.cli",
                "build",
                str(REPO_ROOT / "robots" / robot),
                "--dist",
                str(dist),
            ],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        assert result.returncode == 0, f"build {robot} failed:\n{result.stdout}\n{result.stderr}"
    return dist


def _expected_inventory(dist: Path, robot_id: str) -> list[str]:
    """The §5.6 file inventory, derived from the resolved manifest."""
    manifest = json.loads((dist / robot_id / "manifest.resolved.json").read_text())
    parts = [p["id"] for p in manifest["printed_parts"]]
    steps = manifest["assembly"]["steps"]
    behaviors = [Path(b["file"]).name for b in manifest["behaviors"]]
    docs_pages = [
        "index.mdx",
        "safety.mdx",
        "source-parts.mdx",
        "print-guide.mdx",
        "wiring.mdx",
        "assemble.mdx",
        "flash.mdx",
        "first-run.mdx",
        "play.mdx",
        "troubleshooting.mdx",
    ]
    inventory = [
        "manifest.resolved.json",
        "catalog.json",
        "cad/qc_report.json",
        "print/print_plan.json",
        "wiring/harness.yaml",
        "wiring/wiring.svg",
        "wiring/wiring.png",
        "wiring/wire_bom.csv",
        "bom/bom.json",
        "bom/bom.csv",
        "bom/bom.md",
        "assembly/steps.json",
        "urdf/robot.urdf",
        "firmware/config.json",
    ]
    inventory += [f"cad/stl/{p}.stl" for p in parts]
    inventory += [f"cad/step/{p}.step" for p in parts]
    inventory += [f"cad/3mf/{p}.3mf" for p in parts]
    inventory += [f"assembly/step-{s['id']:02d}.png" for s in steps]
    inventory += [f"behaviors/{b}" for b in behaviors]
    inventory += [f"docs/{page}" for page in docs_pages]
    return inventory


@pytest.mark.parametrize("robot_id", ["_test-min", "rover-v1"])
def test_inventory_complete(built: Path, robot_id: str) -> None:
    root = built / robot_id
    missing = [rel for rel in _expected_inventory(built, robot_id) if not (root / rel).is_file()]
    assert not missing, f"§5.6 artifacts missing for {robot_id}: {missing}"
    empty = [
        rel
        for rel in _expected_inventory(built, robot_id)
        if (root / rel).suffix in BINARY_SUFFIXES and (root / rel).stat().st_size == 0
    ]
    assert not empty, f"empty binary artifacts for {robot_id}: {empty}"


def _text_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.is_file() and _is_text(p))


def test_test_min_goldens(built: Path, update_goldens: bool) -> None:
    root = built / "_test-min"
    golden_root = GOLDEN_DIR / "_test-min"
    if update_goldens:
        if golden_root.exists():
            shutil.rmtree(golden_root)
        for path in _text_files(root):
            dest = golden_root / path.relative_to(root)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest)
        pytest.skip("goldens for _test-min regenerated")
    assert golden_root.exists(), "no goldens committed — run with --update-goldens first"
    built_rel = {str(p.relative_to(root)) for p in _text_files(root)}
    golden_rel = {str(p.relative_to(golden_root)) for p in golden_root.rglob("*") if p.is_file()}
    assert built_rel == golden_rel, (
        f"text artifact set drifted: extra={sorted(built_rel - golden_rel)}, "
        f"missing={sorted(golden_rel - built_rel)}"
    )
    for rel in sorted(built_rel):
        actual = (root / rel).read_text(encoding="utf-8")
        expected = (golden_root / rel).read_text(encoding="utf-8")
        assert actual == expected, f"golden mismatch for _test-min/{rel}"


def test_rover_hashes(built: Path, update_goldens: bool) -> None:
    root = built / "rover-v1"
    hashes_path = GOLDEN_DIR / "rover-v1.hashes.json"
    actual = {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in _text_files(root)
    }
    if update_goldens:
        hashes_path.parent.mkdir(parents=True, exist_ok=True)
        hashes_path.write_text(json.dumps(actual, indent=2, sort_keys=True) + "\n")
        pytest.skip("rover-v1 hash snapshot regenerated")
    assert hashes_path.exists(), "no hash snapshot committed — run with --update-goldens first"
    expected = json.loads(hashes_path.read_text())
    drifted = sorted(
        set(expected) ^ set(actual) | {k for k in set(expected) & set(actual) if expected[k] != actual[k]}
    )
    assert actual == expected, f"rover-v1 snapshot drift in: {drifted}"


def test_rover_print_estimate_sane_with_real_slicer(tmp_path: Path) -> None:
    """PLAN Phase 1 acceptance: rover total print estimate 60-180 g (CI has the slicer)."""
    if shutil.which("prusa-slicer") is None and shutil.which("PrusaSlicer") is None:
        pytest.skip("real prusa-slicer not installed (CI-only check)")
    env = dict(os.environ)
    env.pop("BOTFORGE_PRUSA_SLICER", None)
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "botforge_engine.cli",
            "build",
            str(REPO_ROOT / "robots" / "rover-v1"),
            "--only",
            "cad,print_plan",
            "--dist",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    plan = json.loads((tmp_path / "rover-v1" / "print" / "print_plan.json").read_text())
    assert plan["estimated"] is True
    assert 60 <= plan["totals"]["grams"] <= 180, plan["totals"]
