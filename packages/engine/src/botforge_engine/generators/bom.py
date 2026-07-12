"""BOM generator — electronics + fasteners + printed parts into dist/<id>/bom/.

Implements PLAN Phase 1.8: ``bom.json``, ``bom.csv`` and ``bom.md``.

* electronics — one line per distinct module ref (identical refs aggregated,
  e.g. 2× motor-n20 → one line, qty 2), cheapest sourcing row as ``primary``,
  remaining rows as ``alternates`` sorted by price.
* fasteners — from the resolved fastener uses, same sourcing shape.
* printed — from ``printed_parts``; per-part grams are read from
  ``print/print_plan.json`` when that upstream artifact exists (grams × qty),
  otherwise ``null``.

Sourcing URLs pass through the affiliate redirect scheme
``{SITE}/out/{affiliate_key}/{ref}`` (SITE from ``$BOTFORGE_SITE``); the raw
vendor URL is kept alongside as ``vendor_url``.
"""

from __future__ import annotations

import csv
import io
import json
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from botforge_engine.generators.base import BuildContext
    from botforge_engine.models import Sourcing

name = "bom"

_DEFAULT_SITE = "https://botforge.example"

_CSV_HEADER = ["section", "ref", "name", "qty", "unit_price_usd", "line_total_usd", "vendor", "url"]


def _site() -> str:
    return os.environ.get("BOTFORGE_SITE", _DEFAULT_SITE).rstrip("/")


def _sourcing_row(entry: Sourcing, ref: str, site: str) -> dict[str, Any]:
    return {
        "vendor": entry.vendor,
        "label": entry.label,
        "price_usd": round(entry.price_usd, 2),
        "url": f"{site}/out/{entry.affiliate_key}/{ref}",
        "vendor_url": entry.url,
    }


def _sourced_line(
    ref: str, name_: str, qty: int, sourcing: list[Sourcing], site: str
) -> dict[str, Any]:
    """A BOM line for anything bought from a vendor (electronics, fasteners)."""
    rows = sorted(
        (_sourcing_row(entry, ref, site) for entry in sourcing),
        key=lambda row: (row["price_usd"], row["vendor"]),
    )
    primary = rows[0] if rows else None
    unit = primary["price_usd"] if primary is not None else None
    return {
        "ref": ref,
        "name": name_,
        "qty": qty,
        "primary": primary,
        "alternates": rows[1:],
        "unit_price_usd": unit,
        "line_total_usd": round(unit * qty, 2) if unit is not None else None,
    }


def _load_part_grams(ctx: BuildContext) -> dict[str, float] | None:
    """Per-part grams from ``print/print_plan.json``, or ``None`` if absent/unreadable."""
    plan_path = ctx.dist_dir / "print" / "print_plan.json"
    if not plan_path.is_file():
        ctx.report.append("bom: print/print_plan.json not found — filament grams are null")
        return None
    try:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        ctx.report.append(f"bom: could not read print/print_plan.json ({exc}) — grams are null")
        return None
    grams: dict[str, float] = {}
    for part in plan.get("parts", []) if isinstance(plan, dict) else []:
        part_id = part.get("id")
        value = part.get("grams")
        if isinstance(part_id, str) and isinstance(value, (int, float)):
            grams[part_id] = float(value)
    return grams


def _money(value: float | None) -> str:
    return "" if value is None else f"{value:.2f}"


def _csv_text(sections: dict[str, list[dict[str, Any]]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(_CSV_HEADER)
    for section in ("electronics", "fasteners"):
        for line in sections[section]:
            primary = line["primary"] or {}
            writer.writerow(
                [
                    section,
                    line["ref"],
                    line["name"],
                    line["qty"],
                    _money(line["unit_price_usd"]),
                    _money(line["line_total_usd"]),
                    primary.get("vendor", ""),
                    primary.get("url", ""),
                ]
            )
    for line in sections["printed"]:
        writer.writerow(["printed", line["ref"], line["name"], line["qty"], "", "", "", ""])
    return buffer.getvalue()


def _buy_links(line: dict[str, Any]) -> str:
    rows = ([line["primary"]] if line["primary"] else []) + line["alternates"]
    return " · ".join(f"[{row['vendor']}]({row['url']})" for row in rows) or "—"


def _md_text(
    robot_name: str, sections: dict[str, list[dict[str, Any]]], totals: dict[str, Any]
) -> str:
    out: list[str] = [f"# Bill of materials — {robot_name}", ""]

    for section, title in (("electronics", "Electronics"), ("fasteners", "Fasteners")):
        out += [f"## {title}", ""]
        out += [
            "| Ref | Part | Qty | Unit (USD) | Total (USD) | Buy |",
            "| --- | --- | ---: | ---: | ---: | --- |",
        ]
        for line in sections[section]:
            out.append(
                f"| `{line['ref']}` | {line['name']} | {line['qty']} "
                f"| {_money(line['unit_price_usd']) or '—'} "
                f"| {_money(line['line_total_usd']) or '—'} | {_buy_links(line)} |"
            )
        out.append("")

    out += ["## Printed parts", ""]
    out += ["| Part | Qty | Material | Color role | Grams |", "| --- | ---: | --- | --- | ---: |"]
    for line in sections["printed"]:
        grams = "—" if line["grams"] is None else f"{line['grams']:.2f}"
        out.append(
            f"| `{line['ref']}` | {line['qty']} | {line['material']} "
            f"| {line['color_role']} | {grams} |"
        )
    out.append("")

    filament = "—" if totals["filament_g"] is None else f"{totals['filament_g']:.2f} g"
    out += [
        "## Totals",
        "",
        "| | |",
        "| --- | ---: |",
        f"| Electronics | ${_money(totals['electronics_usd'])} |",
        f"| Fasteners | ${_money(totals['fasteners_usd'])} |",
        f"| Filament | {filament} |",
        f"| **Estimated total** (filament excluded) | **${_money(totals['estimated_total_usd'])}** |",
    ]
    return "\n".join(out) + "\n"


def run(ctx: BuildContext) -> None:
    """Write ``bom/bom.json``, ``bom/bom.csv`` and ``bom/bom.md``."""
    resolved = ctx.resolved
    site = _site()

    # Electronics: aggregate identical refs, first-appearance (manifest) order.
    ref_order: list[str] = []
    ref_qty: dict[str, int] = {}
    ref_module = {}
    for entry in resolved.modules:
        if entry.ref not in ref_qty:
            ref_order.append(entry.ref)
            ref_qty[entry.ref] = 0
            ref_module[entry.ref] = entry.module
        ref_qty[entry.ref] += 1
    electronics = [
        _sourced_line(ref, ref_module[ref].name, ref_qty[ref], ref_module[ref].sourcing, site)
        for ref in ref_order
    ]

    fasteners = [
        _sourced_line(use.ref, use.fastener.name, use.qty, use.fastener.sourcing, site)
        for use in resolved.fasteners
    ]

    part_grams = _load_part_grams(ctx)
    printed: list[dict[str, Any]] = []
    for part in resolved.printed_parts:
        grams: float | None = None
        if part_grams is not None:
            unit_grams = part_grams.get(part.id)
            if unit_grams is None:
                ctx.report.append(
                    f"bom: print_plan.json has no entry for part '{part.id}' — grams are null"
                )
            else:
                grams = round(unit_grams * part.qty, 2)
        printed.append(
            {
                "ref": part.id,
                "name": part.id,
                "qty": part.qty,
                "material": part.material,
                "color_role": part.color_role,
                "grams": grams,
            }
        )

    electronics_usd = round(sum(line["line_total_usd"] or 0.0 for line in electronics), 2)
    fasteners_usd = round(sum(line["line_total_usd"] or 0.0 for line in fasteners), 2)
    known_grams = [line["grams"] for line in printed if line["grams"] is not None]
    filament_g = round(sum(known_grams), 2) if known_grams else None
    totals: dict[str, Any] = {
        "electronics_usd": electronics_usd,
        "fasteners_usd": fasteners_usd,
        "filament_g": filament_g,
        # Filament has no registry price — the estimate covers purchased parts only.
        "estimated_total_usd": round(electronics_usd + fasteners_usd, 2),
    }

    sections = {"electronics": electronics, "fasteners": fasteners, "printed": printed}
    document: dict[str, Any] = {
        "robot_id": resolved.robot.id,
        "robot_name": resolved.robot.name,
        **sections,
        "totals": totals,
    }

    out_dir = ctx.ensure_dir("bom")
    (out_dir / "bom.json").write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    (out_dir / "bom.csv").write_text(_csv_text(sections), encoding="utf-8")
    (out_dir / "bom.md").write_text(_md_text(resolved.robot.name, sections, totals), "utf-8")
