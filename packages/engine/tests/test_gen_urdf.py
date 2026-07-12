"""URDF generator tests against the real registry + robots (PLAN Phase 1.10).

Fake ``cad/stl/<part>.stl`` files are synthesized up front so these tests do
not depend on the cad generator being implemented.
"""

import xml.etree.ElementTree as ET
from pathlib import Path

import trimesh

from botforge_engine.generators import urdf
from botforge_engine.generators.base import BuildContext
from botforge_engine.loader import load_registry, load_robot, resolve

REPO_ROOT = Path(__file__).resolve().parents[3]


def _make_ctx(robot_id: str, tmp_path: Path, with_stls: bool = True) -> BuildContext:
    registry = load_registry(REPO_ROOT / "registry")
    bundle = load_robot(REPO_ROOT / "robots" / robot_id)
    resolved = resolve(bundle, registry)
    dist_dir = tmp_path / robot_id
    dist_dir.mkdir(parents=True, exist_ok=True)
    if with_stls:
        stl_dir = dist_dir / "cad" / "stl"
        stl_dir.mkdir(parents=True, exist_ok=True)
        for part in resolved.printed_parts:
            trimesh.creation.box(extents=[30.0, 24.0, 8.0]).export(stl_dir / f"{part.id}.stl")
    return BuildContext(
        resolved=resolved, robot_dir=bundle.robot_dir, dist_dir=dist_dir, registry=registry
    )


def _build(robot_id: str, tmp_path: Path, with_stls: bool = True) -> tuple[BuildContext, ET.Element]:
    ctx = _make_ctx(robot_id, tmp_path, with_stls=with_stls)
    urdf.run(ctx)
    root = ET.parse(ctx.dist_dir / "urdf" / "robot.urdf").getroot()
    return ctx, root


def test_rover_links_joints_and_wheel_axes(tmp_path: Path) -> None:
    ctx, root = _build("rover-v1", tmp_path)
    assert root.tag == "robot"
    assert root.get("name") == "rover-v1"

    links = root.findall("link")
    joints = root.findall("joint")
    # 17 posed items -> 17 links; everything but the chassis gets a joint
    assert len(links) == 17
    assert len(joints) == 16

    continuous = [j for j in joints if j.get("type") == "continuous"]
    fixed = [j for j in joints if j.get("type") == "fixed"]
    revolute = [j for j in joints if j.get("type") == "revolute"]
    assert len(continuous) == 2
    assert len(fixed) == 14
    assert revolute == []

    # base_link is the chassis: parent of every joint, child of none
    assert {j.find("parent").get("link") for j in joints} == {"chassis"}
    assert "chassis" not in {j.find("child").get("link") for j in joints}

    # wheel joints spin about the pose-rotated local Z: rpy [+-90,0,0] -> [0,-+1,0]
    assert sorted(j.find("child").get("link") for j in continuous) == ["wheel_1", "wheel_2"]
    assert sorted(j.find("axis").get("xyz") for j in continuous) == ["0 -1 0", "0 1 0"]

    # joints are ordered alphabetically by child link name
    children = [j.find("child").get("link") for j in joints]
    assert children == sorted(children)

    # every link carries a positive mass and a full inertial/visual/collision set
    for link in links:
        assert float(link.find("inertial/mass").get("value")) > 0.0
        inertia = link.find("inertial/inertia")
        for attr in ("ixx", "iyy", "izz"):
            assert float(inertia.get(attr)) >= 1e-7
        assert link.find("visual/geometry/mesh") is not None
        assert link.find("collision/geometry/mesh") is not None

    # all referenced meshes exist under urdf/meshes/ and use the mm->m scale
    mesh_refs = {el.get("filename") for el in root.iter("mesh")}
    assert len(mesh_refs) == 17
    for el in root.iter("mesh"):
        assert el.get("scale") == "0.001 0.001 0.001"
    for ref in mesh_refs:
        assert ref.startswith("meshes/")
        assert (ctx.dist_dir / "urdf" / ref).is_file()


def test_test_min_all_fixed_and_base_plate(tmp_path: Path) -> None:
    ctx, root = _build("_test-min", tmp_path)
    links = root.findall("link")
    joints = root.findall("joint")
    assert [link.get("name") for link in links] == ["plate", "core", "eyes", "buzz"]
    assert len(joints) == 3
    # no sim block -> no continuous joints, everything bolts to the base plate
    assert {j.get("type") for j in joints} == {"fixed"}
    assert {j.find("parent").get("link") for j in joints} == {"plate"}
    for ref in {el.get("filename") for el in root.iter("mesh")}:
        assert (ctx.dist_dir / "urdf" / ref).is_file()


def test_urdf_deterministic_across_runs(tmp_path: Path) -> None:
    ctx_a, _ = _build("rover-v1", tmp_path / "a")
    ctx_b, _ = _build("rover-v1", tmp_path / "b")
    bytes_a = (ctx_a.dist_dir / "urdf" / "robot.urdf").read_bytes()
    bytes_b = (ctx_b.dist_dir / "urdf" / "robot.urdf").read_bytes()
    assert bytes_a == bytes_b
    assert bytes_a.endswith(b"\n")


def test_missing_stls_fall_back_to_box_with_warning(tmp_path: Path) -> None:
    ctx, root = _build("_test-min", tmp_path, with_stls=False)
    assert any("no STL for printed part 'plate'" in msg for msg in ctx.report), ctx.report
    # the fallback box is exported so every referenced mesh still exists
    assert (ctx.dist_dir / "urdf" / "meshes" / "plate.stl").is_file()
    plate = next(link for link in root.findall("link") if link.get("name") == "plate")
    assert float(plate.find("inertial/mass").get("value")) > 0.0
