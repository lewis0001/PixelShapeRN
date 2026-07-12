"""URDF generator — robot.urdf + meshes for the simulator into dist/<id>/urdf/.

Implements PLAN Phase 1.10:

* ``urdf/robot.urdf`` — deterministic URDF (links in pose-definition order,
  joints alphabetical by child link name, ``ET.indent`` pretty-printing).
* ``urdf/meshes/<link>.stl`` — one mesh per link: printed-part STLs copied
  from ``cad/stl/`` when present (else the fallback box actually used),
  module bounding boxes and fastener primitives exported for sim visuals.

Poses are authored in mm/degrees; URDF uses meters/radians, so translations
scale by 0.001 and mm meshes are referenced with ``scale="0.001 0.001 0.001"``.
Link names are pose keys with ``@`` mapped to ``_`` (``wheel@1`` → ``wheel_1``)
so names stay ROS-safe.
"""

from __future__ import annotations

import math
import shutil
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from botforge_engine.generators.base import BuildContext
    from botforge_engine.models import Pose

name = "urdf"

MM_TO_M = 1.0e-3
MESH_SCALE = "0.001 0.001 0.001"
PLA_DENSITY_G_PER_MM3 = 1.24e-3
FASTENER_MASS_KG = 0.001
MIN_INERTIA = 1e-7
FALLBACK_BOX_MM = (20.0, 20.0, 10.0)
SERVO_EFFORT = 0.2
SERVO_VELOCITY = 6.0


@dataclass
class _Link:
    key: str  # pose key, e.g. "wheel@1"
    link_name: str  # URDF-safe name, e.g. "wheel_1"
    kind: str  # "part" | "module" | "fastener"
    base_id: str  # pose key without the @n suffix
    mesh: Any  # trimesh mesh in link-local frame (mm)
    mass_kg: float
    module: Any = None  # resolved Module for kind == "module"


def run(ctx: BuildContext) -> None:
    """Write ``urdf/robot.urdf`` and one STL per link into ``urdf/meshes/``."""
    import trimesh

    resolved = ctx.resolved
    urdf_dir = ctx.ensure_dir("urdf")
    mesh_dir = ctx.ensure_dir("urdf/meshes")

    part_ids = {part.id for part in resolved.printed_parts}
    module_by_id = {entry.id: entry.module for entry in resolved.modules}
    fastener_refs = {use.ref for use in resolved.fasteners}
    poses = resolved.assembly.poses
    stl_dir = ctx.dist_dir / "cad" / "stl"

    # ---- build links in pose-definition order --------------------------------
    part_cache: dict[str, tuple[Any, Any]] = {}  # base_id -> (mesh, source path|None)
    links: list[_Link] = []
    for key in poses:
        base_id = key.split("@", 1)[0]
        link_name = key.replace("@", "_")
        if base_id in part_ids:
            if base_id not in part_cache:
                source = stl_dir / f"{base_id}.stl"
                if source.is_file():
                    part_cache[base_id] = (trimesh.load(source, force="mesh"), source)
                else:
                    ctx.report.append(
                        f"urdf: no STL for printed part '{base_id}' "
                        "(cad output missing), using 20x20x10 mm box"
                    )
                    part_cache[base_id] = (trimesh.creation.box(extents=FALLBACK_BOX_MM), None)
            mesh, source = part_cache[base_id]
            mass_kg = _mesh_volume_mm3(mesh) * PLA_DENSITY_G_PER_MM3 * 1e-3
            links.append(_Link(key, link_name, "part", base_id, mesh, mass_kg))
            target = mesh_dir / f"{link_name}.stl"
            if source is not None:
                shutil.copyfile(source, target)
            else:
                mesh.export(target)
        elif key in module_by_id:
            module = module_by_id[key]
            mesh = trimesh.creation.box(extents=module.mech.dims_mm)
            mass_kg = module.mech.mass_g * 1e-3
            links.append(_Link(key, link_name, "module", base_id, mesh, mass_kg, module))
            mesh.export(mesh_dir / f"{link_name}.stl")
        elif base_id in fastener_refs:
            if "ball" in base_id:
                mesh = trimesh.creation.icosphere(subdivisions=2, radius=3.0)
            else:
                mesh = trimesh.creation.cylinder(radius=1.5, height=6.0, sections=24)
            links.append(_Link(key, link_name, "fastener", base_id, mesh, FASTENER_MASS_KG))
            mesh.export(mesh_dir / f"{link_name}.stl")
        else:
            ctx.report.append(f"urdf: unknown pose key '{key}', using 20x20x10 mm box")
            mesh = trimesh.creation.box(extents=FALLBACK_BOX_MM)
            mass_kg = _mesh_volume_mm3(mesh) * PLA_DENSITY_G_PER_MM3 * 1e-3
            links.append(_Link(key, link_name, "part", base_id, mesh, mass_kg))
            mesh.export(mesh_dir / f"{link_name}.stl")

    robot_el = ET.Element("robot", name=resolved.robot.id)
    if not links:
        ctx.report.append("urdf: no posed items — wrote an empty robot")
        _write(urdf_dir / "robot.urdf", robot_el)
        return

    # ---- base link: the printed part posed at [0,0,0] ------------------------
    base = next(
        (
            link
            for link in links
            if link.kind == "part" and all(v == 0 for v in poses[link.key].xyz)
        ),
        None,
    )
    if base is None:
        base = next((link for link in links if link.kind == "part"), links[0])

    for link in links:  # pose-definition order
        robot_el.append(_link_element(link))

    diff_drive = resolved.sim is not None and resolved.sim.drive == "diff"
    joints = [
        _joint_element(link, base.link_name, poses[link.key], diff_drive)
        for link in links
        if link is not base
    ]
    for joint_el in sorted(joints, key=lambda el: el.find("child").get("link")):
        robot_el.append(joint_el)

    _write(urdf_dir / "robot.urdf", robot_el)


# ---- geometry helpers ---------------------------------------------------------


def _mesh_volume_mm3(mesh: Any) -> float:
    """Solid volume in mm³; falls back to the bbox volume for open meshes."""
    volume = abs(float(mesh.volume)) if mesh.is_watertight else 0.0
    if volume <= 0.0:
        extents = np.asarray(mesh.extents, dtype=float)
        volume = abs(float(extents[0] * extents[1] * extents[2]))
    return max(volume, 1.0)


def _rotation(rpy_deg: list[float]) -> np.ndarray:
    """R = Rz(yaw)·Ry(pitch)·Rx(roll) from degrees (URDF fixed-axis order)."""
    roll, pitch, yaw = (math.radians(v) for v in rpy_deg)
    cr, sr = math.cos(roll), math.sin(roll)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cy, sy = math.cos(yaw), math.sin(yaw)
    return np.array(
        [
            [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
            [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
            [-sp, cp * sr, cp * cr],
        ]
    )


def _spin_axis(rpy_deg: list[float]) -> str:
    """Joint axis: local +Z rotated into the parent frame, rounded to 3 dp."""
    axis = _rotation(rpy_deg) @ np.array([0.0, 0.0, 1.0])
    axis = axis / np.linalg.norm(axis)
    parts = []
    for value in axis:
        rounded = round(float(value), 3)
        if rounded == 0.0:
            rounded = 0.0  # avoid "-0"
        parts.append(_fmt(rounded))
    return " ".join(parts)


# ---- XML helpers --------------------------------------------------------------


def _fmt(value: float) -> str:
    text = f"{value:.6g}"
    return "0" if text == "-0" else text


def _fmt_vec(values: Any) -> str:
    return " ".join(_fmt(float(v)) for v in values)


def _origin(pose: Pose) -> dict[str, str]:
    xyz = [v * MM_TO_M for v in pose.xyz]
    rpy = [math.radians(v) for v in pose.rpy]
    return {"xyz": _fmt_vec(xyz), "rpy": _fmt_vec(rpy)}


def _link_element(link: _Link) -> ET.Element:
    """<link> with inertial (box approximation of the mesh bbox) + visual + collision."""
    link_el = ET.Element("link", name=link.link_name)

    bounds = np.asarray(link.mesh.bounds, dtype=float) * MM_TO_M
    center = (bounds[0] + bounds[1]) / 2.0
    ex, ey, ez = (bounds[1] - bounds[0]).tolist()
    mass = link.mass_kg
    ixx = max(mass * (ey * ey + ez * ez) / 12.0, MIN_INERTIA)
    iyy = max(mass * (ex * ex + ez * ez) / 12.0, MIN_INERTIA)
    izz = max(mass * (ex * ex + ey * ey) / 12.0, MIN_INERTIA)

    inertial = ET.SubElement(link_el, "inertial")
    ET.SubElement(inertial, "origin", xyz=_fmt_vec(center), rpy="0 0 0")
    ET.SubElement(inertial, "mass", value=_fmt(mass))
    ET.SubElement(
        inertial,
        "inertia",
        ixx=_fmt(ixx),
        ixy="0",
        ixz="0",
        iyy=_fmt(iyy),
        iyz="0",
        izz=_fmt(izz),
    )
    for tag in ("visual", "collision"):
        section = ET.SubElement(link_el, tag)
        ET.SubElement(section, "origin", xyz="0 0 0", rpy="0 0 0")
        geometry = ET.SubElement(section, "geometry")
        ET.SubElement(
            geometry, "mesh", filename=f"meshes/{link.link_name}.stl", scale=MESH_SCALE
        )
    return link_el


def _joint_element(link: _Link, parent: str, pose: Pose, diff_drive: bool) -> ET.Element:
    """Joint from base_link to *link* at its pose (continuous/revolute/fixed)."""
    servo = (
        link.kind == "module"
        and link.module is not None
        and isinstance(link.module.sim, dict)
        and link.module.sim.get("kind") == "servo"
    )
    if diff_drive and link.kind == "part" and link.base_id == "wheel":
        joint_type = "continuous"
    elif servo:
        joint_type = "revolute"
    else:
        joint_type = "fixed"

    joint_el = ET.Element("joint", name=f"{link.link_name}_joint", type=joint_type)
    ET.SubElement(joint_el, "parent", link=parent)
    ET.SubElement(joint_el, "child", link=link.link_name)
    ET.SubElement(joint_el, "origin", **_origin(pose))
    if joint_type in ("continuous", "revolute"):
        ET.SubElement(joint_el, "axis", xyz=_spin_axis(pose.rpy))
    if joint_type == "revolute":
        params = link.module.firmware.params if link.module.firmware else {}
        lower = math.radians(float(params.get("deg_min", 0.0)))
        upper = math.radians(float(params.get("deg_max", 180.0)))
        ET.SubElement(
            joint_el,
            "limit",
            lower=_fmt(lower),
            upper=_fmt(upper),
            effort=_fmt(SERVO_EFFORT),
            velocity=_fmt(SERVO_VELOCITY),
        )
    return joint_el


def _write(path: Any, robot_el: ET.Element) -> None:
    ET.indent(robot_el, space="  ")
    text = ET.tostring(robot_el, encoding="unicode")
    path.write_text('<?xml version="1.0" ?>\n' + text + "\n", encoding="utf-8")
