"""Assembly generator — steps.json + per-step renders into dist/<id>/assembly/.

Implements PLAN Phase 1.9 / renderer contract §5.2:

* ``assembly/steps.json`` — deterministic step metadata (2-space indent,
  trailing newline, no timestamps).
* ``assembly/step-01.png`` … ``step-NN.png`` — 1600x1200 renders. Parts added
  in earlier steps draw ghost grey, the current step's parts draw in the
  robot's hero colour at their exploded positions, and an arrow points from
  each exploded part back toward its final pose.

Rendering is wrapped in try/except: on machines without a working EGL/GL
stack the images are skipped with a ``ctx.report`` warning while
``steps.json`` is still written.
"""

from __future__ import annotations

import json
import math
import os
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from pathlib import Path

    from botforge_engine.generators.base import BuildContext
    from botforge_engine.models import Pose

name = "assembly"

RENDER_WIDTH = 1600
RENDER_HEIGHT = 1200
YFOV_RAD = math.radians(40.0)
CAMERA_AZIMUTH_DEG = 45.0
CAMERA_ELEVATION_DEG = 30.0
FRAME_MARGIN = 1.25
GHOST_RGB = (0.78, 0.78, 0.80)
ARROW_RGB = (0.35, 0.35, 0.38)
FALLBACK_BOX_MM = (20.0, 20.0, 10.0)
ARROW_SHAFT_RADIUS = 1.2
ARROW_HEAD_RADIUS = 3.0


def run(ctx: BuildContext) -> None:
    """Write ``assembly/steps.json`` and render one PNG per assembly step."""
    out_dir = ctx.ensure_dir("assembly")
    payload = {
        "robot_id": ctx.resolved.robot.id,
        "steps": [
            {
                "id": step.id,
                "title": step.title,
                "note": step.note,
                "adds": list(step.adds),
                "fasteners": list(step.fasteners or []),
                "image": _image_name(index),
            }
            for index, step in enumerate(ctx.resolved.assembly.steps, start=1)
        ],
    }
    steps_path = out_dir / "steps.json"
    steps_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    try:
        _render_steps(ctx, out_dir)
    except Exception as exc:  # e.g. no EGL — steps.json alone is acceptable
        ctx.report.append(f"assembly: renders skipped: {exc}")


def _image_name(index: int) -> str:
    return f"step-{index:02d}.png"


def _hero_rgb(value: str) -> tuple[float, float, float]:
    """Parse a ``#rrggbb`` (or ``#rgb``) hero colour into 0..1 floats."""
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    try:
        r, g, b = (int(text[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except (ValueError, IndexError):
        r, g, b = (1.0, 0.42, 0.21)
    return (r, g, b)


def _pose_matrix(pose: Pose, exploded: bool) -> np.ndarray:
    """4x4 transform for a pose: R = Rz(yaw)·Ry(pitch)·Rx(roll), mm translation.

    With ``exploded=True`` the explode vector (default ``[0,0,0]``) is added
    to the translation.
    """
    roll, pitch, yaw = (math.radians(v) for v in pose.rpy)
    cr, sr = math.cos(roll), math.sin(roll)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cy, sy = math.cos(yaw), math.sin(yaw)
    mat = np.eye(4)
    mat[:3, :3] = [
        [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
        [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
        [-sp, cp * sr, cp * cr],
    ]
    xyz = np.asarray(pose.xyz, dtype=float)
    if exploded and pose.explode is not None:
        xyz = xyz + np.asarray(pose.explode, dtype=float)
    mat[:3, 3] = xyz
    return mat


def _resolve_meshes(ctx: BuildContext) -> dict[str, Any]:
    """Map every pose key to an untransformed trimesh mesh in its local frame.

    Printed parts use ``dist/cad/stl/<part_id>.stl`` when the cad generator
    already produced it, else a fallback 20x20x10 mm box (with a warning).
    Modules become boxes from ``mech.dims_mm``; fasteners become a small
    cylinder (or a sphere for ball refs).
    """
    import trimesh

    resolved = ctx.resolved
    part_ids = {part.id for part in resolved.printed_parts}
    module_by_id = {entry.id: entry.module for entry in resolved.modules}
    fastener_refs = {use.ref for use in resolved.fasteners}
    stl_dir = ctx.dist_dir / "cad" / "stl"

    part_cache: dict[str, Any] = {}
    meshes: dict[str, Any] = {}
    for key in resolved.assembly.poses:
        base_id = key.split("@", 1)[0]
        if base_id in part_ids:
            if base_id not in part_cache:
                stl_path = stl_dir / f"{base_id}.stl"
                if stl_path.is_file():
                    part_cache[base_id] = trimesh.load(stl_path, force="mesh")
                else:
                    ctx.report.append(
                        f"assembly: no STL for printed part '{base_id}' "
                        "(cad output missing), using 20x20x10 mm box"
                    )
                    part_cache[base_id] = trimesh.creation.box(extents=FALLBACK_BOX_MM)
            meshes[key] = part_cache[base_id]
        elif key in module_by_id:
            module = module_by_id[key]
            mesh = trimesh.creation.box(extents=module.mech.dims_mm)
            if module.sim is not None and module.sim.get("kind") == "motor_dc":
                # Gearmotors get a visible output shaft along local +X so press-fit
                # wheels read correctly in the step renders (nothing looks "missing").
                shaft_len = 9.0
                shaft = trimesh.creation.cylinder(radius=1.5, height=shaft_len, sections=16)
                shaft.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
                shaft.apply_translation([module.mech.dims_mm[0] / 2 + shaft_len / 2, 0, 0])
                mesh = trimesh.util.concatenate([mesh, shaft])
            meshes[key] = mesh
        elif base_id in fastener_refs:
            if "ball" in base_id:
                meshes[key] = trimesh.creation.icosphere(subdivisions=2, radius=3.0)
            else:
                meshes[key] = trimesh.creation.cylinder(radius=1.5, height=6.0, sections=24)
        else:
            ctx.report.append(f"assembly: unknown pose key '{key}', using 20x20x10 mm box")
            meshes[key] = trimesh.creation.box(extents=FALLBACK_BOX_MM)
    return meshes


def _base_key(ctx: BuildContext) -> str | None:
    """The base printed part: pose ``[0,0,0]`` (fallback: first posed part)."""
    part_ids = {part.id for part in ctx.resolved.printed_parts}
    part_keys = [
        key for key in ctx.resolved.assembly.poses if key.split("@", 1)[0] in part_ids
    ]
    for key in part_keys:
        if all(v == 0 for v in ctx.resolved.assembly.poses[key].xyz):
            return key
    return part_keys[0] if part_keys else None


def _direction(azimuth_deg: float, elevation_deg: float) -> np.ndarray:
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    return np.array(
        [math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)]
    )


def _look_at(eye: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Camera/light pose looking from *eye* at *target*, +Z-up world."""
    forward = target - eye
    forward = forward / np.linalg.norm(forward)
    up = np.array([0.0, 0.0, 1.0])
    if abs(float(np.dot(forward, up))) > 0.999:
        up = np.array([0.0, 1.0, 0.0])
    right = np.cross(forward, up)
    right = right / np.linalg.norm(right)
    true_up = np.cross(right, forward)
    mat = np.eye(4)
    mat[:3, 0] = right
    mat[:3, 1] = true_up
    mat[:3, 2] = -forward  # camera looks down its -Z axis
    mat[:3, 3] = eye
    return mat


def _arrow_mesh(pose: Pose) -> Any | None:
    """Arrow along the explode vector: exploded position → final position."""
    import trimesh

    if pose.explode is None:
        return None
    explode = np.asarray(pose.explode, dtype=float)
    length = float(np.linalg.norm(explode))
    if length < 1e-6:
        return None
    start = np.asarray(pose.xyz, dtype=float) + explode
    direction = -explode / length
    head_len = min(8.0, 0.4 * length)
    shaft_len = max(length - head_len, 1e-3)
    align = trimesh.geometry.align_vectors([0.0, 0.0, 1.0], direction)

    shaft = trimesh.creation.cylinder(radius=ARROW_SHAFT_RADIUS, height=shaft_len, sections=24)
    shaft.apply_transform(align)
    shaft.apply_translation(start + direction * (shaft_len / 2.0))
    head = trimesh.creation.cone(radius=ARROW_HEAD_RADIUS, height=head_len, sections=24)
    head.apply_transform(align)
    head.apply_translation(start + direction * shaft_len)
    return trimesh.util.concatenate([shaft, head])


def _render_steps(ctx: BuildContext, out_dir: Path) -> None:
    """Render one 1600x1200 PNG per step via pyrender's offscreen renderer."""
    os.environ.setdefault("PYOPENGL_PLATFORM", "egl")
    import pyrender
    import trimesh
    from PIL import Image

    resolved = ctx.resolved
    poses = resolved.assembly.poses
    meshes = _resolve_meshes(ctx)
    hero = _hero_rgb(resolved.robot.hero_color)
    base_key = _base_key(ctx)

    # One camera for every step, framed on the bbox of ALL final poses + 25%.
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for key, mesh in meshes.items():
        corners = trimesh.bounds.corners(mesh.bounds)
        world = trimesh.transform_points(corners, _pose_matrix(poses[key], exploded=False))
        lo = np.minimum(lo, world.min(axis=0))
        hi = np.maximum(hi, world.max(axis=0))
    center = (lo + hi) / 2.0
    radius = max(float(np.linalg.norm(hi - lo)) / 2.0, 1.0) * FRAME_MARGIN
    distance = radius / math.sin(YFOV_RAD / 2.0)
    camera_pose = _look_at(
        center + distance * _direction(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG), center
    )
    fill_pose = _look_at(center + distance * _direction(-120.0, 55.0), center)

    renderer = pyrender.OffscreenRenderer(RENDER_WIDTH, RENDER_HEIGHT)
    try:
        placed: list[str] = [base_key] if base_key is not None else []
        for index, step in enumerate(resolved.assembly.steps, start=1):
            adds = [key for key in step.adds if key in meshes]
            for key in step.adds:
                if key not in meshes:
                    ctx.report.append(
                        f"assembly: step {step.id} adds '{key}' which has no pose"
                    )

            scene = pyrender.Scene(
                bg_color=[1.0, 1.0, 1.0, 1.0], ambient_light=[0.45, 0.45, 0.45]
            )
            ghost_mat = pyrender.MetallicRoughnessMaterial(
                baseColorFactor=[*GHOST_RGB, 1.0], metallicFactor=0.05, roughnessFactor=0.9
            )
            hero_mat = pyrender.MetallicRoughnessMaterial(
                baseColorFactor=[*hero, 1.0], metallicFactor=0.1, roughnessFactor=0.6
            )
            arrow_mat = pyrender.MetallicRoughnessMaterial(
                baseColorFactor=[*ARROW_RGB, 1.0], metallicFactor=0.05, roughnessFactor=0.8
            )

            for key in placed:
                if key in adds:
                    continue  # highlighted this step instead
                scene.add(
                    pyrender.Mesh.from_trimesh(meshes[key], material=ghost_mat, smooth=False),
                    pose=_pose_matrix(poses[key], exploded=False),
                )
            for key in adds:
                scene.add(
                    pyrender.Mesh.from_trimesh(meshes[key], material=hero_mat, smooth=False),
                    pose=_pose_matrix(poses[key], exploded=True),
                )
                arrow = _arrow_mesh(poses[key])
                if arrow is not None:
                    scene.add(
                        pyrender.Mesh.from_trimesh(arrow, material=arrow_mat, smooth=False)
                    )

            scene.add(pyrender.PerspectiveCamera(yfov=YFOV_RAD), pose=camera_pose)
            scene.add(
                pyrender.DirectionalLight(color=np.ones(3), intensity=3.0), pose=camera_pose
            )
            scene.add(
                pyrender.DirectionalLight(color=np.ones(3), intensity=1.5), pose=fill_pose
            )

            color, _ = renderer.render(scene)
            Image.fromarray(color).save(out_dir / _image_name(index))

            placed.extend(key for key in adds if key not in placed)
    finally:
        renderer.delete()
