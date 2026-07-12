"""Docs generator tests: full fake dist, empty dist, and the sync script."""

import json
import subprocess
import sys
from pathlib import Path

import yaml
from PIL import Image

from botforge_engine.generators import docs
from botforge_engine.generators.base import BuildContext
from botforge_engine.loader import load_registry, load_robot, resolve

REPO_ROOT = Path(__file__).resolve().parents[3]
REGISTRY_DIR = REPO_ROOT / "registry"
TEST_MIN = REPO_ROOT / "robots" / "_test-min"
SYNC_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sync_docs.py"

PAGES = [
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

BUY_URL = "https://example.com/buy/esp32-s3"


def _make_ctx(dist_root: Path) -> BuildContext:
    registry = load_registry(REGISTRY_DIR)
    bundle = load_robot(TEST_MIN)
    resolved = resolve(bundle, registry)
    dist_dir = dist_root / resolved.robot.id
    dist_dir.mkdir(parents=True, exist_ok=True)
    return BuildContext(
        resolved=resolved, robot_dir=TEST_MIN, dist_dir=dist_dir, registry=registry
    )


def _prepare_fake_dist(dist_dir: Path) -> None:
    """Lay down the upstream artifacts docs consumes, with known contents."""
    (dist_dir / "bom").mkdir(parents=True)
    (dist_dir / "bom" / "bom.json").write_text(
        json.dumps(
            {
                "electronics": [
                    {"name": "ESP32-S3 DevKit", "qty": 1, "unit_price_usd": 8.0, "buy_url": BUY_URL}
                ],
                "totals": {"usd": 8.0},
            }
        ),
        encoding="utf-8",
    )

    (dist_dir / "wiring").mkdir()
    (dist_dir / "wiring" / "wiring.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
        encoding="utf-8",
    )
    (dist_dir / "wiring" / "wire_bom.csv").write_text(
        "from,to,color,length_mm\ncore.5v,eyes.vcc,red,40\ncore.gnd,eyes.gnd,black,40\n",
        encoding="utf-8",
    )

    (dist_dir / "assembly").mkdir()
    for n in (1, 2):
        Image.new("RGB", (1, 1), (255, 0, 0)).save(dist_dir / "assembly" / f"step-{n:02d}.png")
    (dist_dir / "assembly" / "steps.json").write_text(
        json.dumps({"steps": [{"id": 1}, {"id": 2}]}), encoding="utf-8"
    )

    (dist_dir / "print").mkdir()
    (dist_dir / "print" / "print_plan.json").write_text(
        json.dumps(
            {
                "profile": "pla-0.20",
                "estimated": True,
                "parts": [
                    {
                        "part_id": "plate",
                        "qty": 1,
                        "grams": 10.5,
                        "minutes": 34,
                        "plate_hints": {
                            "orientation": "flat",
                            "material": "PLA",
                            "color_role": "body",
                        },
                    }
                ],
                "totals": {"grams": 10.5, "minutes": 34},
            }
        ),
        encoding="utf-8",
    )


def _frontmatter(text: str) -> dict:
    assert text.startswith("---\n"), "page must start with frontmatter"
    block = text.split("---\n")[1]
    data = yaml.safe_load(block)
    assert isinstance(data, dict)
    return data


def test_docs_with_full_dist(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path)
    _prepare_fake_dist(ctx.dist_dir)

    docs.run(ctx)

    docs_dir = ctx.dist_dir / "docs"
    for page in PAGES:
        assert (docs_dir / page).is_file(), f"missing page {page}"

    # Frontmatter parses on every page and carries the required keys.
    for order, page in enumerate(PAGES, start=1):
        meta = _frontmatter((docs_dir / page).read_text(encoding="utf-8"))
        assert meta["title"]
        assert meta["description"]
        assert meta["sidebar"] == {"order": order}

    source_parts = (docs_dir / "source-parts.mdx").read_text(encoding="utf-8")
    assert BUY_URL in source_parts
    assert "ESP32-S3 DevKit" in source_parts
    assert "M2×6 self-tapping screw" in source_parts  # fasteners table from resolved manifest

    print_guide = (docs_dir / "print-guide.mdx").read_text(encoding="utf-8")
    assert "10.50 g" in print_guide
    assert "34 min" in print_guide
    assert "estimate pending" not in print_guide

    wiring = (docs_dir / "wiring.mdx").read_text(encoding="utf-8")
    assert "./images/wiring.svg" in wiring
    assert "core.5v" in wiring and "eyes.vcc" in wiring

    assemble = (docs_dir / "assemble.mdx").read_text(encoding="utf-8")
    assert "## Step 1" in assemble
    assert "Mount the brain" in assemble
    assert "./images/step-01.png" in assemble

    # Images copied into docs/images/.
    assert (docs_dir / "images" / "wiring.svg").is_file()
    assert (docs_dir / "images" / "step-01.png").is_file()
    assert (docs_dir / "images" / "step-02.png").is_file()

    play = (docs_dir / "play.mdx").read_text(encoding="utf-8")
    assert "blink" in play  # BSJ name from behaviors/blink.json

    troubleshooting = (docs_dir / "troubleshooting.mdx").read_text(encoding="utf-8")
    assert "### Eyes stay dark" in troubleshooting  # from led-ws2812-2 registry docs
    assert "## General" in troubleshooting


def test_docs_with_empty_dist_still_emits_all_pages(tmp_path: Path) -> None:
    ctx = _make_ctx(tmp_path)

    docs.run(ctx)

    docs_dir = ctx.dist_dir / "docs"
    for page in PAGES:
        text = (docs_dir / page).read_text(encoding="utf-8")
        _frontmatter(text)

    # Degraded pages carry the "generated before" note, and warnings were reported.
    assert "generated before" in (docs_dir / "source-parts.mdx").read_text(encoding="utf-8")
    assert "generated before" in (docs_dir / "wiring.mdx").read_text(encoding="utf-8")
    assert "estimate pending" in (docs_dir / "print-guide.mdx").read_text(encoding="utf-8")
    assert any(msg.startswith("docs:") for msg in ctx.report)
    assert any("bom" in msg for msg in ctx.report)
    assert any("wiring" in msg for msg in ctx.report)


def test_sync_script_copies_bundle_into_docs_app(tmp_path: Path) -> None:
    dist_root = tmp_path / "dist"
    ctx = _make_ctx(dist_root)
    _prepare_fake_dist(ctx.dist_dir)
    docs.run(ctx)

    docs_app = tmp_path / "apps" / "docs"
    result = subprocess.run(
        [
            sys.executable,
            str(SYNC_SCRIPT),
            "_test-min",
            "--dist",
            str(dist_root),
            "--docs-app",
            str(docs_app),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    dest = docs_app / "src" / "content" / "docs" / "robots" / "_test-min"
    for page in PAGES:
        assert (dest / page).is_file()
    assert (dest / "images" / "wiring.svg").is_file()
    assert "index.mdx" in result.stdout

    # Idempotent: delete-then-copy removes stale files on re-sync.
    stale = dest / "stale.mdx"
    stale.write_text("old", encoding="utf-8")
    rerun = subprocess.run(
        [
            sys.executable,
            str(SYNC_SCRIPT),
            "_test-min",
            "--dist",
            str(dist_root),
            "--docs-app",
            str(docs_app),
        ],
        capture_output=True,
        text=True,
    )
    assert rerun.returncode == 0, rerun.stderr
    assert not stale.exists()
    assert (dest / "index.mdx").is_file()


def test_sync_script_fails_cleanly_without_bundle(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(SYNC_SCRIPT),
            "no-such-robot",
            "--dist",
            str(tmp_path / "dist"),
            "--docs-app",
            str(tmp_path / "apps" / "docs"),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "no docs bundle" in result.stderr
