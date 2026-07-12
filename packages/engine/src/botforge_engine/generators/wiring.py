"""Wiring generator — WireViz harness YAML/SVG/PNG + wire BOM into dist/<id>/wiring/.

Outputs (PLAN §5.6 ``wiring/``):

* ``harness.yaml`` — a WireViz 0.4 input file: one connector per connected
  module instance, one cable per (from-instance → to-instance) pair.
* ``wire_bom.csv`` — one row per manifest connection (independent of WireViz).
* ``wiring.svg`` / ``wiring.png`` — rendered by WireViz + graphviz; skipped
  with a report warning if rendering fails.
"""

from __future__ import annotations

import csv
from typing import TYPE_CHECKING

import yaml

from botforge_engine.models import ModuleCategory

if TYPE_CHECKING:
    from pathlib import Path

    from botforge_engine.generators.base import BuildContext
    from botforge_engine.loader import ResolvedConnection, ResolvedRobot

name = "wiring"

#: Registry colour names → WireViz two-letter colour codes (wv_colors).
_COLOR_CODES = {
    "red": "RD",
    "black": "BK",
    "brown": "BN",
    "orange": "OG",
    "yellow": "YE",
    "green": "GN",
    "blue": "BU",
    "white": "WH",
    "grey": "GY",
    "gray": "GY",
    "purple": "VT",
    "cyan": "TQ",
    "pink": "PK",
}

#: The only files allowed to remain in wiring/ (WireViz extras are deleted).
_KEEP = {"harness.yaml", "wiring.svg", "wiring.png", "wire_bom.csv"}


def _label(conn: ResolvedConnection) -> str:
    """Wire label ``from→to``, e.g. ``core.gpio4→mdrv.ain1``."""
    return (
        f"{conn.from_.instance}.{conn.from_.pin.name}"
        f"→{conn.to.instance}.{conn.to.pin.name}"
    )


def _wire_color(resolved: ResolvedRobot, conn: ResolvedConnection) -> str:
    """Two-letter WireViz colour for a connection.

    Primary source is the non-core module's ``wiring.wire_colors`` (the far/
    ``to`` side when ``from`` is the core, or when both sides are peripherals);
    fallback is the from-module's map, final fallback ``BK``.
    """
    from_mod = resolved.module_for(conn.from_.instance)
    to_mod = resolved.module_for(conn.to.instance)
    if from_mod.category is not ModuleCategory.core and to_mod.category is ModuleCategory.core:
        lookups = [(from_mod, conn.from_.pin.name)]
    else:
        lookups = [(to_mod, conn.to.pin.name), (from_mod, conn.from_.pin.name)]
    for module, pin_name in lookups:
        raw = module.wiring.wire_colors.get(pin_name)
        if raw:
            return _COLOR_CODES.get(raw.strip().lower(), "BK")
    return "BK"


def _build_harness(resolved: ResolvedRobot) -> dict:
    """Assemble the WireViz input document (plain dict, deterministic order)."""
    # Cable groups: one per (from-instance, to-instance) pair, wires in
    # manifest connection order within each group.
    groups: dict[tuple[str, str], list[ResolvedConnection]] = {}
    # Pin labels per instance: names actually used, in first-appearance order.
    pinlabels: dict[str, list[str]] = {}
    for conn in resolved.connections:
        groups.setdefault((conn.from_.instance, conn.to.instance), []).append(conn)
        for end in (conn.from_, conn.to):
            labels = pinlabels.setdefault(end.instance, [])
            if end.pin.name not in labels:
                labels.append(end.pin.name)

    connectors: dict[str, dict] = {}
    for entry in resolved.modules:  # manifest order
        if entry.id not in pinlabels:
            continue  # instance without connections — nothing to draw
        connectors[entry.id] = {
            "type": entry.module.wiring.connector,
            "pinlabels": pinlabels[entry.id],
        }

    cables: dict[str, dict] = {}
    connection_sets: list[list[dict]] = []
    for src, dst in sorted(groups):
        conns = groups[(src, dst)]
        cable_id = f"{src}__{dst}"
        cables[cable_id] = {
            "wirecount": len(conns),
            "colors": [_wire_color(resolved, c) for c in conns],
            "wirelabels": [_label(c) for c in conns],
            # WireViz defaults numeric lengths to metres — force millimetres.
            "length": max(c.len_mm for c in conns),
            "length_unit": "mm",
        }
        connection_sets.append(
            [
                {src: [c.from_.pin.name for c in conns]},
                {cable_id: list(range(1, len(conns) + 1))},
                {dst: [c.to.pin.name for c in conns]},
            ]
        )

    return {"connectors": connectors, "cables": cables, "connections": connection_sets}


def _write_wire_bom(resolved: ResolvedRobot, path: Path) -> None:
    """``wire_bom.csv`` — one row per connection, manifest order, \\n endings."""
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(["from", "to", "color", "length_mm", "label"])
        for conn in resolved.connections:
            writer.writerow(
                [
                    f"{conn.from_.instance}.{conn.from_.pin.name}",
                    f"{conn.to.instance}.{conn.to.pin.name}",
                    _wire_color(resolved, conn),
                    conn.len_mm,
                    _label(conn),
                ]
            )


def run(ctx: BuildContext) -> None:
    """Emit harness.yaml + wire_bom.csv, then render wiring.svg/wiring.png."""
    out_dir = ctx.ensure_dir("wiring")

    harness_path = out_dir / "harness.yaml"
    harness_path.write_text(
        yaml.safe_dump(_build_harness(ctx.resolved), sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    _write_wire_bom(ctx.resolved, out_dir / "wire_bom.csv")

    try:
        from wireviz import wireviz

        wireviz.parse(
            harness_path,
            output_formats=("png", "svg"),
            output_dir=out_dir,
            output_name="wiring",
            image_paths=[],
        )
    except Exception as exc:  # graphviz/wireviz may be broken on some machines
        ctx.report.append(f"wiring: diagram render skipped: {exc}")

    # WireViz can leave extras (gv/html/bom.tsv/tmp files) next to the yaml.
    for extra in out_dir.iterdir():
        if extra.is_file() and extra.name not in _KEEP:
            extra.unlink()
