"""Docs generator — MDX bundle for apps/docs into dist/<id>/docs/ (PLAN Phase 1.12).

Renders ten Starlight MDX pages from Jinja2 templates in
``botforge_engine/templates/docs/`` and copies referenced images
(``wiring.svg``, ``step-NN.png``) into ``docs/images/``. Upstream artifacts
(BOM, wiring, print plan, assembly renders) are consumed when present; when
missing the page is still emitted with a "generated before X was available"
note plus a warning on the build report — the generator never crashes on an
incomplete dist. Output is deterministic (no timestamps).
"""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Any

from jinja2 import Environment, FileSystemLoader

if TYPE_CHECKING:
    from botforge_engine.generators.base import BuildContext

name = "docs"

# Templates live inside the package source tree; resolving relative to
# __file__ works for editable installs, CI checkouts and built wheels alike
# (hatchling ships everything under src/botforge_engine as package data).
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "docs"

_MDX_ESCAPES = {"<": "\\<", "{": "\\{", "}": "\\}"}


def _mdx(text: str) -> str:
    """Escape characters that MDX would parse as JSX in free-form prose."""
    for char, escaped in _MDX_ESCAPES.items():
        text = text.replace(char, escaped)
    return text


def _environment() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )


def _load_json(path: Path) -> Any:
    """Parse a JSON artifact, returning ``None`` when missing or unreadable."""
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _first(entry: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = entry.get(key)
        if value is not None:
            return value
    return None


def _extract_electronics(bom: Any) -> list[dict[str, Any]]:
    """Pull (name, qty, price, url) rows out of bom.json, tolerating key variants."""
    if not isinstance(bom, dict):
        return []
    entries = bom.get("electronics") or bom.get("modules") or []
    if not isinstance(entries, list):
        return []
    rows: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        entry_name = _first(entry, ("name", "label", "module", "ref")) or "?"
        qty = _first(entry, ("qty", "quantity")) or 1
        price = _first(entry, ("unit_price_usd", "price_usd", "unit_price", "price"))
        url = _first(entry, ("buy_url", "url", "link"))
        primary = entry.get("primary") or entry.get("sourcing")
        if isinstance(primary, list) and primary:
            primary = primary[0]
        if isinstance(primary, dict):
            if url is None:
                url = _first(primary, ("buy_url", "url", "link"))
            if price is None:
                price = _first(primary, ("price_usd", "unit_price_usd", "price"))
        rows.append(
            {
                "name": _mdx(str(entry_name)),
                "qty": qty,
                "price": f"{price:.2f}" if isinstance(price, int | float) else "—",
                "url": url if isinstance(url, str) and url else None,
            }
        )
    return rows


def _read_wire_rows(path: Path) -> list[dict[str, str]] | None:
    """Read wiring/wire_bom.csv into from/to/color/length rows (None if absent)."""
    if not path.is_file():
        return None
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            raw = list(csv.reader(handle))
    except OSError:
        return None
    if not raw:
        return None
    header = [cell.strip().lower() for cell in raw[0]]

    def column(*needles: str) -> int | None:
        for needle in needles:
            if needle in header:
                return header.index(needle)
        for i, cell in enumerate(header):
            if any(needle in cell for needle in needles):
                return i
        return None

    indexes = {
        "src": column("from"),
        "dst": column("to"),
        "color": column("color", "colour"),
        "length": column("length", "len_mm", "len"),
    }
    rows: list[dict[str, str]] = []
    for line in raw[1:]:
        if not any(cell.strip() for cell in line):
            continue
        row = {}
        for key, index in indexes.items():
            row[key] = line[index].strip() if index is not None and index < len(line) else ""
        rows.append(row)
    return rows


def _fastener_label(ctx: BuildContext, raw: str) -> str:
    """Expand an assembly ``"<ref> xN"`` entry using the fastener registry."""
    ref, _, qty = raw.partition(" ")
    fastener = ctx.registry.fasteners.get(ref)
    if fastener is None:
        return _mdx(raw)
    suffix = f" {qty.strip()}" if qty.strip() else ""
    return f"{_mdx(fastener.name)}{suffix} — {_mdx(fastener.spec)}"


def _collect_steps(ctx: BuildContext, images_dir: Path) -> tuple[list[dict[str, Any]], bool]:
    """Build template rows for assembly steps, copying step renders when present."""
    steps: list[dict[str, Any]] = []
    missing = 0
    copied_any = False
    for n, step in enumerate(ctx.resolved.assembly.steps, start=1):
        image_name = f"step-{n:02d}.png"
        source = ctx.dist_dir / "assembly" / image_name
        image: str | None = None
        if source.is_file():
            images_dir.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, images_dir / image_name)
            image = f"./images/{image_name}"
            copied_any = True
        else:
            missing += 1
        steps.append(
            {
                "n": n,
                "title": _mdx(step.title),
                "note": _mdx(step.note) if step.note else None,
                "image": image,
                "fasteners": [_fastener_label(ctx, item) for item in step.fasteners or []],
            }
        )
    if steps and missing:
        ctx.report.append(
            f"docs: {missing} assembly step render(s) not available — images omitted"
        )
    return steps, copied_any or not missing


def _collect_behaviors(ctx: BuildContext) -> list[dict[str, Any]]:
    """List shipped behaviors, pulling display names from the BSJ files."""
    behaviors: list[dict[str, Any]] = []
    for ref in ctx.resolved.behaviors:
        display = ref.id
        raw = _load_json(ctx.robot_dir / ref.file)
        if isinstance(raw, dict) and isinstance(raw.get("name"), str):
            display = raw["name"]
        else:
            ctx.report.append(f"docs: behavior '{ref.id}' has no readable BSJ name — using id")
        behaviors.append({"id": ref.id, "name": _mdx(display), "default": ref.default})
    return behaviors


def _collect_troubleshooting(ctx: BuildContext) -> list[dict[str, Any]]:
    """Group registry troubleshooting entries under module display names.

    Modules used by several instances (e.g. two N20 motors) appear once,
    in first-use order.
    """
    groups: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in ctx.resolved.modules:
        if entry.ref in seen:
            continue
        seen.add(entry.ref)
        items = entry.module.docs.troubleshooting
        if not items:
            continue
        groups.append(
            {
                "name": _mdx(entry.module.name),
                "entries": [
                    {"symptom": _mdx(item.symptom), "fix": _mdx(item.fix)} for item in items
                ],
            }
        )
    return groups


def run(ctx: BuildContext) -> None:
    """Render the ten-page MDX bundle into ``dist/<id>/docs/``."""
    docs_dir = ctx.ensure_dir("docs")
    images_dir = docs_dir / "images"
    env = _environment()
    robot = ctx.resolved.robot

    # --- upstream artifacts (all optional; degrade with a note + warning) ---
    bom = _load_json(ctx.dist_dir / "bom" / "bom.json")
    electronics = _extract_electronics(bom)
    if not electronics:
        ctx.report.append("docs: bom/bom.json not available — source-parts table is a placeholder")

    plan = _load_json(ctx.dist_dir / "print" / "print_plan.json")
    plan_parts: dict[str, dict[str, Any]] = {}
    profile = "pla-0.20"
    if isinstance(plan, dict):
        profile = plan.get("profile") or profile
        for part in plan.get("parts") or []:
            if isinstance(part, dict) and isinstance(part.get("part_id"), str):
                plan_parts[part["part_id"]] = part
    else:
        ctx.report.append("docs: print/print_plan.json not available — estimates pending")
    def _num(value: Any) -> float | int | None:
        return value if isinstance(value, int | float) else None

    parts = [
        {
            "id": part.id,
            "qty": part.qty,
            "material": part.material,
            "color_role": part.color_role,
            "grams": _num(plan_parts.get(part.id, {}).get("grams")),
            "minutes": _num(plan_parts.get(part.id, {}).get("minutes")),
        }
        for part in ctx.resolved.printed_parts
    ]
    totals = plan.get("totals") if isinstance(plan, dict) else None
    totals = totals if isinstance(totals, dict) else {}

    wiring_svg_src = ctx.dist_dir / "wiring" / "wiring.svg"
    wiring_svg = wiring_svg_src.is_file()
    if wiring_svg:
        images_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(wiring_svg_src, images_dir / "wiring.svg")
    else:
        ctx.report.append("docs: wiring/wiring.svg not available — diagram omitted")

    wire_rows = _read_wire_rows(ctx.dist_dir / "wiring" / "wire_bom.csv")
    if wire_rows is None:
        ctx.report.append("docs: wiring/wire_bom.csv not available — wire table omitted")

    steps, images_available = _collect_steps(ctx, images_dir)

    fasteners = [
        {"name": _mdx(use.fastener.name), "spec": _mdx(use.fastener.spec), "qty": use.qty}
        for use in ctx.resolved.fasteners
    ]

    # --- pages, in sidebar order ---
    pages: list[tuple[str, str, str, dict[str, Any]]] = [
        (
            "index.mdx",
            f"Build the {robot.name}",
            robot.tagline,
            {},
        ),
        (
            "safety.mdx",
            "Safety first",
            f"Read this before building {robot.name} — batteries, small parts and USB power.",
            {},
        ),
        (
            "source-parts.mdx",
            "Source the parts",
            f"Every part {robot.name} needs, with quantities, prices and buy links.",
            {"electronics": electronics, "fasteners": fasteners},
        ),
        (
            "print-guide.mdx",
            "Print the parts",
            f"Print settings and filament/time estimates for {robot.name}'s printed parts.",
            {
                "profile": profile,
                "plan_available": bool(plan_parts),
                "parts": parts,
                "totals_grams": _num(totals.get("grams")),
                "totals_minutes": _num(totals.get("minutes")),
            },
        ),
        (
            "wiring.mdx",
            "Wire it up",
            f"The wiring diagram and wire list for {robot.name}.",
            {"wiring_svg": wiring_svg, "wire_rows": wire_rows},
        ),
        (
            "assemble.mdx",
            "Assemble",
            f"Step-by-step assembly guide for {robot.name}.",
            {"steps": steps, "images_available": images_available},
        ),
        (
            "flash.mdx",
            "Flash the firmware",
            f"Put the universal BOTFORGE firmware on {robot.name} from your browser.",
            {},
        ),
        (
            "first-run.mdx",
            "First run",
            f"Get {robot.name} onto your Wi-Fi and take it for its first drive.",
            {},
        ),
        (
            "play.mdx",
            "Play and program",
            f"Drive {robot.name} and build new behaviors with blocks.",
            {"behaviors": _collect_behaviors(ctx)},
        ),
        (
            "troubleshooting.mdx",
            "Troubleshooting",
            f"Symptoms and fixes for every module in {robot.name}.",
            {"groups": _collect_troubleshooting(ctx)},
        ),
    ]

    for order, (filename, title, description, extra) in enumerate(pages, start=1):
        template = env.get_template(f"{filename}.j2")
        text = template.render(
            title=title, description=description, order=order, robot=robot, **extra
        )
        if not text.endswith("\n"):
            text += "\n"
        (docs_dir / filename).write_text(text, encoding="utf-8")
