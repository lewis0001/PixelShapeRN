"""Model round-trip and human-friendly error tests against the fixture data."""

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from botforge_engine.loader import load_registry, load_robot, resolve
from botforge_engine.models import (
    Assembly,
    FastenersFile,
    Module,
    RobotManifest,
    SpecError,
    format_validation_error,
)

FIXTURES = Path(__file__).parent / "fixtures"
REGISTRY_DIR = FIXTURES / "registry"
GOOD_ROBOT = FIXTURES / "robots" / "good-bot"


def _read_yaml(path: Path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def test_module_yamls_round_trip() -> None:
    paths = sorted((REGISTRY_DIR / "modules").glob("*.yaml"))
    assert len(paths) == 6
    for path in paths:
        module = Module.model_validate(_read_yaml(path))
        assert module.id == path.stem
        again = Module.model_validate(module.model_dump(mode="json", by_alias=True))
        assert again == module


def test_fasteners_round_trip() -> None:
    parsed = FastenersFile.model_validate(_read_yaml(REGISTRY_DIR / "fasteners.yaml"))
    ids = [fastener.id for fastener in parsed.fasteners]
    assert ids == ["m2x6", "ball-6mm"]
    again = FastenersFile.model_validate(parsed.model_dump(mode="json", by_alias=True))
    assert again == parsed


def test_robot_manifest_round_trip_and_from_alias() -> None:
    manifest = RobotManifest.model_validate(_read_yaml(GOOD_ROBOT / "robot.yaml"))
    assert manifest.schema_version == 1
    assert manifest.connections[0].from_ == "core.5v"
    dumped = manifest.model_dump(mode="json", by_alias=True)
    assert dumped["connections"][0]["from"] == "core.5v"
    assert "from_" not in dumped["connections"][0]
    assert RobotManifest.model_validate(dumped) == manifest


def test_assembly_round_trip_with_instance_pose_keys() -> None:
    assembly = Assembly.model_validate(_read_yaml(GOOD_ROBOT / "assembly.yaml"))
    assert "wheel@1" in assembly.poses
    assert "wheel@2" in assembly.poses
    assert assembly.steps[2].fasteners == ["m2x6 x2"]
    again = Assembly.model_validate(assembly.model_dump(mode="json", by_alias=True))
    assert again == assembly


def test_bad_category_produces_human_friendly_errors() -> None:
    raw = _read_yaml(REGISTRY_DIR / "modules" / "test-driver.yaml")
    raw["category"] = "banana"
    with pytest.raises(ValidationError) as excinfo:
        Module.model_validate(raw)
    messages = format_validation_error(excinfo.value, "test-driver.yaml")
    assert len(messages) == 1
    assert messages[0].startswith("test-driver.yaml: category: ")


def test_loader_reports_broken_registry_file_with_path(tmp_path: Path) -> None:
    import shutil

    broken = tmp_path / "registry"
    shutil.copytree(REGISTRY_DIR, broken)
    path = broken / "modules" / "test-line.yaml"
    path.write_text(path.read_text().replace("category: sensor", "category: banana"))
    with pytest.raises(SpecError) as excinfo:
        load_registry(broken)
    assert any(msg.startswith("modules/test-line.yaml: category: ") for msg in excinfo.value.errors)


def test_resolved_robot_shape() -> None:
    registry = load_registry(REGISTRY_DIR)
    bundle = load_robot(GOOD_ROBOT)
    resolved = resolve(bundle, registry)

    data = resolved.model_dump(mode="json", by_alias=True)
    assert set(data) == {
        "schema_version",
        "robot",
        "modules",
        "connections",
        "printed_parts",
        "fasteners",
        "assembly",
        "behaviors",
        "firmware",
        "sim",
        "options",
    }
    assert data["schema_version"] == 1

    # module instances carry the full registry module inlined
    first = data["modules"][0]
    assert set(first) == {"id", "ref", "label", "module"}
    assert first["id"] == "core"
    assert first["module"]["category"] == "core"

    # endpoints resolve to (instance, module, pin) objects; core gpios get a number
    conn = data["connections"][2]
    assert conn["from"] == {
        "instance": "core",
        "module": "test-core",
        "pin": {"name": "gpio4", "type": "gpio", "required": False},
        "gpio": 4,
    }
    assert conn["to"]["pin"] == {"name": "in1", "type": "pwm", "required": True}
    assert conn["to"]["gpio"] is None

    # fasteners are inlined too
    assert data["fasteners"][0]["fastener"]["spec"].startswith("M2 x 6")

    # helper lookup
    assert resolved.module_for("line").firmware.driver == "Line_Test"
    with pytest.raises(KeyError):
        resolved.module_for("nope")
