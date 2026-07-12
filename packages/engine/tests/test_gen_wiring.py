"""Wiring generator tests against the real registry and robots (rover-v1, _test-min)."""

import csv
from pathlib import Path

import pytest
import yaml

from botforge_engine.generators import wiring
from botforge_engine.generators.base import BuildContext
from botforge_engine.loader import load_registry, load_robot, resolve

REPO_ROOT = Path(__file__).resolve().parents[3]
EXPECTED_FILES = {"harness.yaml", "wiring.svg", "wiring.png", "wire_bom.csv"}


def _run_wiring(robot_id: str, dist_root: Path) -> BuildContext:
    registry = load_registry(REPO_ROOT / "registry")
    bundle = load_robot(REPO_ROOT / "robots" / robot_id)
    resolved = resolve(bundle, registry)
    ctx = BuildContext(
        resolved=resolved,
        robot_dir=bundle.robot_dir,
        dist_dir=dist_root / resolved.robot.id,
        registry=registry,
    )
    wiring.run(ctx)
    return ctx


@pytest.fixture(scope="module")
def rover_ctx(tmp_path_factory: pytest.TempPathFactory) -> BuildContext:
    return _run_wiring("rover-v1", tmp_path_factory.mktemp("rover-dist"))


@pytest.fixture(scope="module")
def test_min_ctx(tmp_path_factory: pytest.TempPathFactory) -> BuildContext:
    return _run_wiring("_test-min", tmp_path_factory.mktemp("test-min-dist"))


def _wiring_dir(ctx: BuildContext) -> Path:
    return ctx.dist_dir / "wiring"


def _read_bom_rows(ctx: BuildContext) -> list[list[str]]:
    with (_wiring_dir(ctx) / "wire_bom.csv").open(encoding="utf-8", newline="") as fh:
        return list(csv.reader(fh))


def test_rover_harness_yaml_connectors_and_cables(rover_ctx: BuildContext) -> None:
    harness = yaml.safe_load((_wiring_dir(rover_ctx) / "harness.yaml").read_text(encoding="utf-8"))

    # every rover instance participates in connections → one connector each
    instance_ids = [m.id for m in rover_ctx.resolved.modules]
    assert set(harness["connectors"]) == set(instance_ids)
    for inst_id in instance_ids:
        connector = harness["connectors"][inst_id]
        assert connector["type"] == rover_ctx.resolved.module_for(inst_id).wiring.connector
        assert connector["pinlabels"], inst_id

    # expected cable groups with expected wire counts
    assert harness["cables"]["core__mdrv"]["wirecount"] == 5
    assert harness["cables"]["pwr__core"]["wirecount"] == 2
    assert harness["cables"]["mdrv__motor_left"]["wirecount"] == 2
    assert set(harness["cables"]) == {
        "core__buzz",
        "core__eyes",
        "core__line",
        "core__mdrv",
        "core__range",
        "mdrv__motor_left",
        "mdrv__motor_right",
        "pwr__core",
        "pwr__mdrv",
        "sw__pwr",
    }
    for cable in harness["cables"].values():
        assert len(cable["colors"]) == cable["wirecount"]
        assert len(cable["wirelabels"]) == cable["wirecount"]
        assert cable["length_unit"] == "mm"
    # signal wires from the DRV8833 colour map, labelled FROM→TO
    assert harness["cables"]["core__mdrv"]["colors"] == ["YE", "OG", "GN", "BU", "WH"]
    assert harness["cables"]["core__mdrv"]["wirelabels"][0] == "core.gpio4→mdrv.ain1"
    # one connection set per cable, cable order sorted by (from, to)
    assert len(harness["connections"]) == len(harness["cables"])


def test_test_min_harness_yaml(test_min_ctx: BuildContext) -> None:
    harness = yaml.safe_load(
        (_wiring_dir(test_min_ctx) / "harness.yaml").read_text(encoding="utf-8")
    )
    assert set(harness["connectors"]) == {"core", "eyes", "buzz"}
    assert set(harness["cables"]) == {"core__eyes", "core__buzz"}
    assert harness["cables"]["core__eyes"]["wirecount"] == 3
    assert harness["cables"]["core__buzz"]["wirecount"] == 2


def test_rover_wire_bom(rover_ctx: BuildContext) -> None:
    rows = _read_bom_rows(rover_ctx)
    assert rows[0] == ["from", "to", "color", "length_mm", "label"]
    data = rows[1:]
    assert len(data) == 28  # one row per manifest connection
    assert data[0] == ["pwr.5v", "core.5v", "RD", "60", "pwr.5v→core.5v"]
    for row in data:
        assert row[4] == f"{row[0]}→{row[1]}"


def test_test_min_wire_bom(test_min_ctx: BuildContext) -> None:
    rows = _read_bom_rows(test_min_ctx)
    assert rows[0] == ["from", "to", "color", "length_mm", "label"]
    data = rows[1:]
    assert len(data) == 5
    assert data[0] == ["core.gpio38", "eyes.din", "GN", "40", "core.gpio38→eyes.din"]
    for row in data:
        assert row[4] == f"{row[0]}→{row[1]}"


@pytest.mark.parametrize("ctx_fixture", ["rover_ctx", "test_min_ctx"])
def test_diagrams_render_and_no_extra_files(
    ctx_fixture: str, request: pytest.FixtureRequest
) -> None:
    ctx: BuildContext = request.getfixturevalue(ctx_fixture)
    out_dir = _wiring_dir(ctx)

    svg = out_dir / "wiring.svg"
    assert svg.is_file() and svg.stat().st_size > 0
    assert "<svg" in svg.read_text(encoding="utf-8")

    png = out_dir / "wiring.png"
    assert png.is_file() and png.stat().st_size > 0

    assert {p.name for p in out_dir.iterdir()} == EXPECTED_FILES
    # graphviz is installed here, so rendering must not have been skipped
    assert not [msg for msg in ctx.report if "render skipped" in msg]


def test_outputs_are_deterministic(tmp_path: Path) -> None:
    ctx_a = _run_wiring("rover-v1", tmp_path / "a")
    ctx_b = _run_wiring("rover-v1", tmp_path / "b")
    for filename in ("harness.yaml", "wire_bom.csv"):
        first = (_wiring_dir(ctx_a) / filename).read_bytes()
        second = (_wiring_dir(ctx_b) / filename).read_bytes()
        assert first == second, filename
