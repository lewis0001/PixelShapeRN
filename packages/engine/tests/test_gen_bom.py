"""BOM generator tests — aggregation, sourcing selection, affiliate URLs, totals."""

import csv
import json
from pathlib import Path

import pytest

from botforge_engine.generators import bom
from botforge_engine.generators.base import BuildContext
from botforge_engine.loader import load_registry, load_robot, resolve

REPO_ROOT = Path(__file__).resolve().parents[3]

FAKE_PRINT_PLAN = {
    "parts": [
        {"id": "chassis", "grams": 30.0, "minutes": 120},
        {"id": "wheel", "grams": 8.25, "minutes": 30},
        {"id": "caster_mount", "grams": 4.0, "minutes": 15},
        {"id": "head", "grams": 10.0, "minutes": 40},
        {"id": "lid", "grams": 12.5, "minutes": 45},
    ],
    "totals": {"grams": 73.0, "minutes": 280},
}


@pytest.fixture(autouse=True)
def _default_site(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BOTFORGE_SITE", raising=False)


def _ctx(robot_id: str, tmp_path: Path) -> BuildContext:
    registry = load_registry(REPO_ROOT / "registry")
    bundle = load_robot(REPO_ROOT / "robots" / robot_id)
    resolved = resolve(bundle, registry)
    dist_dir = tmp_path / "dist" / resolved.robot.id
    dist_dir.mkdir(parents=True, exist_ok=True)
    return BuildContext(
        resolved=resolved, robot_dir=bundle.robot_dir, dist_dir=dist_dir, registry=registry
    )


def _build_rover(tmp_path: Path, with_print_plan: bool = False) -> tuple[BuildContext, dict]:
    ctx = _ctx("rover-v1", tmp_path)
    if with_print_plan:
        plan_dir = ctx.dist_dir / "print"
        plan_dir.mkdir(parents=True, exist_ok=True)
        (plan_dir / "print_plan.json").write_text(
            json.dumps(FAKE_PRINT_PLAN, indent=2) + "\n", encoding="utf-8"
        )
    bom.run(ctx)
    data = json.loads((ctx.dist_dir / "bom" / "bom.json").read_text(encoding="utf-8"))
    return ctx, data


def _line(data: dict, section: str, ref: str) -> dict:
    matches = [line for line in data[section] if line["ref"] == ref]
    assert len(matches) == 1, f"expected exactly one {section} line for {ref}"
    return matches[0]


def test_identical_refs_are_aggregated(tmp_path: Path) -> None:
    _, data = _build_rover(tmp_path)
    motor = _line(data, "electronics", "motor-n20")
    assert motor["qty"] == 2
    assert motor["unit_price_usd"] == 3.0
    assert motor["line_total_usd"] == 6.0
    # 10 instances collapse into 9 distinct refs, in manifest order.
    assert [line["ref"] for line in data["electronics"]] == [
        "core-esp32s3-devkit",
        "pwr-1s-boost",
        "drv-8833",
        "motor-n20",
        "sens-vl53l0x",
        "sens-line-2ch",
        "led-ws2812-2",
        "buzzer-passive",
        "sw-slide",
    ]


def test_cheapest_vendor_is_primary_with_alternates_by_price(tmp_path: Path) -> None:
    _, data = _build_rover(tmp_path)
    mdrv = _line(data, "electronics", "drv-8833")
    assert mdrv["primary"]["vendor"] == "aliexpress"
    assert mdrv["primary"]["price_usd"] == 1.5
    assert mdrv["primary"]["url"] == "https://botforge.example/out/ali/drv-8833"
    assert mdrv["primary"]["vendor_url"].startswith("https://www.aliexpress.com/")
    assert [alt["vendor"] for alt in mdrv["alternates"]] == ["amazon"]
    assert mdrv["alternates"][0]["price_usd"] == 7.99
    assert mdrv["alternates"][0]["url"] == "https://botforge.example/out/amz/drv-8833"
    assert mdrv["unit_price_usd"] == 1.5


def test_every_sourcing_url_uses_the_affiliate_scheme(tmp_path: Path) -> None:
    _, data = _build_rover(tmp_path)
    for section in ("electronics", "fasteners"):
        for line in data[section]:
            rows = [line["primary"], *line["alternates"]]
            assert rows, line["ref"]
            for row in rows:
                assert row["url"].startswith("https://botforge.example/out/"), row
                assert row["vendor_url"].startswith("https://"), row


def test_site_env_var_overrides_affiliate_host(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BOTFORGE_SITE", "https://shop.example/")
    _, data = _build_rover(tmp_path)
    core = _line(data, "electronics", "core-esp32s3-devkit")
    assert core["primary"]["url"] == "https://shop.example/out/ali/core-esp32s3-devkit"


def test_fastener_lines_come_from_manifest_and_registry(tmp_path: Path) -> None:
    _, data = _build_rover(tmp_path)
    assert [line["ref"] for line in data["fasteners"]] == [
        "m2x6_selftap",
        "m2x8_selftap",
        "m3_ball_6mm",
    ]
    m2x6 = _line(data, "fasteners", "m2x6_selftap")
    assert m2x6["qty"] == 8
    assert m2x6["unit_price_usd"] == 0.02
    assert m2x6["line_total_usd"] == 0.16
    assert m2x6["primary"]["url"] == "https://botforge.example/out/ali/m2x6_selftap"


def test_grams_null_without_print_plan(tmp_path: Path) -> None:
    ctx, data = _build_rover(tmp_path)
    assert [line["ref"] for line in data["printed"]] == [
        "chassis",
        "wheel",
        "caster_mount",
        "head",
        "lid",
    ]
    assert all(line["grams"] is None for line in data["printed"])
    assert data["totals"]["filament_g"] is None
    assert any("print_plan.json" in msg for msg in ctx.report)


def test_grams_read_from_print_plan_times_qty(tmp_path: Path) -> None:
    _, data = _build_rover(tmp_path, with_print_plan=True)
    assert _line(data, "printed", "chassis")["grams"] == 30.0
    assert _line(data, "printed", "wheel")["grams"] == 16.5  # 8.25 g × qty 2
    assert data["totals"]["filament_g"] == 73.0


def test_totals_arithmetic(tmp_path: Path) -> None:
    _, data = _build_rover(tmp_path)
    totals = data["totals"]
    electronics_sum = round(sum(line["line_total_usd"] for line in data["electronics"]), 2)
    fasteners_sum = round(sum(line["line_total_usd"] for line in data["fasteners"]), 2)
    assert totals["electronics_usd"] == electronics_sum
    assert totals["fasteners_usd"] == fasteners_sum
    assert totals["estimated_total_usd"] == round(electronics_sum + fasteners_sum, 2)
    for line in data["electronics"] + data["fasteners"]:
        assert line["line_total_usd"] == round(line["unit_price_usd"] * line["qty"], 2)


def test_csv_has_header_plus_one_row_per_line(tmp_path: Path) -> None:
    ctx, data = _build_rover(tmp_path)
    csv_text = (ctx.dist_dir / "bom" / "bom.csv").read_text(encoding="utf-8")
    rows = list(csv.reader(csv_text.splitlines()))
    assert rows[0] == [
        "section",
        "ref",
        "name",
        "qty",
        "unit_price_usd",
        "line_total_usd",
        "vendor",
        "url",
    ]
    expected = len(data["electronics"]) + len(data["fasteners"]) + len(data["printed"])
    assert len(rows) == 1 + expected
    assert sum(1 for row in rows[1:] if row[0] == "printed") == len(data["printed"])


def test_markdown_heading_names_the_robot(tmp_path: Path) -> None:
    ctx, _ = _build_rover(tmp_path)
    md = (ctx.dist_dir / "bom" / "bom.md").read_text(encoding="utf-8")
    assert md.startswith("# Bill of materials — Rover\n")
    assert "https://botforge.example/out/ali/drv-8833" in md
    assert md.endswith("\n")


def test_outputs_are_deterministic(tmp_path: Path) -> None:
    ctx_a, _ = _build_rover(tmp_path / "a", with_print_plan=True)
    ctx_b, _ = _build_rover(tmp_path / "b", with_print_plan=True)
    for name in ("bom.json", "bom.csv", "bom.md"):
        first = (ctx_a.dist_dir / "bom" / name).read_bytes()
        second = (ctx_b.dist_dir / "bom" / name).read_bytes()
        assert first == second, name
        assert first.endswith(b"\n"), name
