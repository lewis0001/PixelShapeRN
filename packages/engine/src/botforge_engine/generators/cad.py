"""CAD generator — exports STL/STEP/3MF per printed part into dist/<id>/cad/.

For each printed part the robot's ``parts/<script>.py`` is imported, its
``build(params) -> cq.Workplane`` called, and the solid exported once per
part id (qty is handled downstream). Every STL is then QC'd with trimesh:
watertight, positive volume, bbox within the printer envelope, and a
support-needing-overhang report per CAD_GUIDE.md. Results land in
``cad/qc_report.json`` (deterministic: rounded floats, no timestamps/paths).

cadquery/trimesh are imported lazily so the engine core works without the
``cad`` extra installed.
"""

from __future__ import annotations

import importlib.util
import json
import math
import re
import sys
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

    from botforge_engine.generators.base import BuildContext

name = "cad"

#: STL/3MF linear deflection tolerance (mm).
STL_TOLERANCE = 0.05
#: Print envelope each part must fit inside (mm per axis).
MAX_EXTENT = 200.0
#: Downward-face threshold: normal z below -cos(40 deg) = steeper than 50 deg facing down.
OVERHANG_NZ = -math.cos(math.radians(40.0))
#: Triangles entirely below this height are bed contact, not overhang (mm).
BED_Z = 0.5
#: Warn above this share of surface area needing support (%).
OVERHANG_WARN_PCT = 2.0


def _load_build(script_path: Path, module_name: str):
    """Import a part script under a unique module name and return its build()."""
    if not script_path.is_file():
        raise RuntimeError(f"cad: part script not found: parts/{script_path.name}")
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cad: cannot import part script parts/{script_path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    build = getattr(module, "build", None)
    if not callable(build):
        raise RuntimeError(f"cad: parts/{script_path.name} does not define build(params)")
    return build


def _qc(part_id: str, stl_path: Path, report: list[str]) -> dict[str, Any]:
    """Trimesh QC for one exported STL; hard errors raise, overhangs warn."""
    import trimesh

    # validate=True drops zero-area degenerate triangles (an OCC tessellation
    # artifact at sphere poles) and welds duplicate vertices before checking —
    # the same cleanup every slicer applies when reading STL.
    mesh = trimesh.load_mesh(str(stl_path), validate=True)
    if not mesh.is_watertight:
        raise RuntimeError(f"cad: part '{part_id}' mesh is not watertight")
    volume = float(mesh.volume)
    if volume <= 0:
        raise RuntimeError(f"cad: part '{part_id}' has non-positive volume ({volume:.2f} mm3)")
    extents = [float(e) for e in mesh.extents]
    if any(e > MAX_EXTENT for e in extents):
        raise RuntimeError(
            f"cad: part '{part_id}' bbox {[round(e, 1) for e in extents]} exceeds "
            f"{MAX_EXTENT:.0f}x{MAX_EXTENT:.0f}x{MAX_EXTENT:.0f} mm"
        )

    # Overhang report: % of face area steeper than 50 deg facing down,
    # excluding faces entirely within the bed-contact zone (z < 0.5).
    areas = mesh.area_faces
    downward = mesh.face_normals[:, 2] < OVERHANG_NZ
    on_bed = mesh.triangles[:, :, 2].max(axis=1) < BED_Z
    total = float(areas.sum())
    overhang_pct = 100.0 * float(areas[downward & ~on_bed].sum()) / total if total > 0 else 0.0
    if overhang_pct > OVERHANG_WARN_PCT:
        report.append(f"part {part_id}: {overhang_pct:.1f}% support-needing overhangs")

    return {
        "watertight": True,
        "volume_mm3": round(volume, 2),
        "bbox": [round(e, 2) for e in extents],
        "overhang_pct": round(overhang_pct, 2),
    }


def run(ctx: BuildContext) -> None:
    """Export cad/stl|step|3mf per printed part, then QC and write qc_report.json."""
    from cadquery import exporters

    stl_dir = ctx.ensure_dir("cad/stl")
    step_dir = ctx.ensure_dir("cad/step")
    threemf_dir = ctx.ensure_dir("cad/3mf")

    qc_report: dict[str, dict[str, Any]] = {}
    for part in ctx.resolved.printed_parts:
        script_path = ctx.robot_dir / "parts" / part.script
        module_name = "botforge_part_" + re.sub(
            r"\W", "_", f"{ctx.resolved.robot.id}_{part.id}"
        )
        build = _load_build(script_path, module_name)
        try:
            solid = build(dict(part.params))
        except Exception as exc:
            raise RuntimeError(f"cad: part '{part.id}' build() failed: {exc}") from exc

        stl_path = stl_dir / f"{part.id}.stl"
        exporters.export(solid, str(stl_path), tolerance=STL_TOLERANCE)
        exporters.export(solid, str(step_dir / f"{part.id}.step"))
        exporters.export(solid, str(threemf_dir / f"{part.id}.3mf"), tolerance=STL_TOLERANCE)

        qc_report[part.id] = _qc(part.id, stl_path, ctx.report)

    qc_path = ctx.dist_dir / "cad" / "qc_report.json"
    qc_path.write_text(json.dumps(qc_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
