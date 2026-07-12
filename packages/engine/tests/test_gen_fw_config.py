"""fw_config generator tests — the §5.5 firmware config is a frozen contract."""

import json
from pathlib import Path

from botforge_engine.generators import fw_config
from botforge_engine.generators.base import BuildContext
from botforge_engine.loader import load_registry, load_robot, resolve

REPO_ROOT = Path(__file__).resolve().parents[3]

#: The frozen §5.5 contract for rover-v1 (registry pin names, manifest order).
EXPECTED_ROVER_CONFIG = {
    "cfg": 1,
    "robot_id": "rover-v1",
    "name_default": "Rover",
    "autostart": "avoid",
    "modules": [
        {"id": "pwr", "driver": "PowerMon", "pins": {}, "params": {"vbat_adc": None}},
        {
            "id": "mdrv",
            "driver": "Motor_DRV8833",
            "pins": {"ain1": 4, "ain2": 5, "bin1": 6, "bin2": 7, "slp": 15},
            "params": {"pwm_hz": 20000, "slew_per_s": 400},
        },
        {"id": "range", "driver": "Range_VL53L0X", "pins": {"sda": 8, "scl": 9}, "params": {}},
        {"id": "line", "driver": "Line_TCRT", "pins": {"out_l": 1, "out_r": 2}, "params": {}},
        {"id": "eyes", "driver": "Pixel_WS2812", "pins": {"din": 38}, "params": {"count": 2}},
        {"id": "buzz", "driver": "Buzzer_PWM", "pins": {"sig": 16}, "params": {}},
    ],
}

EXPECTED_TEST_MIN_CONFIG = {
    "cfg": 1,
    "robot_id": "_test-min",
    "name_default": "Test Min",
    "autostart": "blink",
    "modules": [
        {"id": "eyes", "driver": "Pixel_WS2812", "pins": {"din": 38}, "params": {"count": 2}},
        {"id": "buzz", "driver": "Buzzer_PWM", "pins": {"sig": 16}, "params": {}},
    ],
}


def _ctx(robot_id: str, tmp_path: Path) -> BuildContext:
    registry = load_registry(REPO_ROOT / "registry")
    bundle = load_robot(REPO_ROOT / "robots" / robot_id)
    resolved = resolve(bundle, registry)
    dist_dir = tmp_path / "dist" / resolved.robot.id
    dist_dir.mkdir(parents=True, exist_ok=True)
    return BuildContext(
        resolved=resolved, robot_dir=bundle.robot_dir, dist_dir=dist_dir, registry=registry
    )


def _run(robot_id: str, tmp_path: Path) -> Path:
    ctx = _ctx(robot_id, tmp_path)
    fw_config.run(ctx)
    return ctx.dist_dir / "firmware" / "config.json"


def test_rover_config_matches_frozen_contract(tmp_path: Path) -> None:
    data = json.loads(_run("rover-v1", tmp_path).read_text(encoding="utf-8"))
    assert data == EXPECTED_ROVER_CONFIG


def test_rover_config_key_and_pin_ordering(tmp_path: Path) -> None:
    data = json.loads(_run("rover-v1", tmp_path).read_text(encoding="utf-8"))
    assert list(data.keys()) == ["cfg", "robot_id", "name_default", "autostart", "modules"]
    assert [module["id"] for module in data["modules"]] == [
        "pwr",
        "mdrv",
        "range",
        "line",
        "eyes",
        "buzz",
    ]
    for module in data["modules"]:
        assert list(module.keys()) == ["id", "driver", "pins", "params"]
    mdrv = data["modules"][1]
    assert list(mdrv["pins"].keys()) == ["ain1", "ain2", "bin1", "bin2", "slp"]


def test_rover_config_excludes_core_and_driverless_modules(tmp_path: Path) -> None:
    data = json.loads(_run("rover-v1", tmp_path).read_text(encoding="utf-8"))
    ids = {module["id"] for module in data["modules"]}
    # core (category core), motors and slide switch (no firmware block) never appear.
    assert ids.isdisjoint({"core", "motor_left", "motor_right", "sw"})


def test_test_min_config(tmp_path: Path) -> None:
    data = json.loads(_run("_test-min", tmp_path).read_text(encoding="utf-8"))
    assert data == EXPECTED_TEST_MIN_CONFIG


def test_config_is_deterministic_and_newline_terminated(tmp_path: Path) -> None:
    first = _run("rover-v1", tmp_path / "a").read_bytes()
    second = _run("rover-v1", tmp_path / "b").read_bytes()
    assert first == second
    assert first.endswith(b"\n")
