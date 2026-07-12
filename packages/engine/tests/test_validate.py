"""Validator rule tests against the fixture registry and robot variants."""

from pathlib import Path

from botforge_engine.loader import load_registry, load_robot
from botforge_engine.validate import ValidationReport, check

FIXTURES = Path(__file__).parent / "fixtures"
ROBOTS = FIXTURES / "robots"

REGISTRY = load_registry(FIXTURES / "registry")


def report_for(robot: str) -> ValidationReport:
    return check(load_robot(ROBOTS / robot), REGISTRY)


def test_good_robot_has_no_errors_or_warnings() -> None:
    report = report_for("good-bot")
    assert report.errors == []
    assert report.warnings == []
    assert report.ok


def test_unknown_module_ref_is_an_error() -> None:
    report = report_for("bad-ref")
    assert report.errors == ["unknown module ref 'no-such-module' (instance 'mdrv')"]


def test_missing_required_pin_is_an_error() -> None:
    report = report_for("missing-pin")
    assert report.errors == ["required pin 'mdrv.in2' is not connected"]


def test_double_booked_gpio_is_an_error() -> None:
    report = report_for("double-gpio")
    assert len(report.errors) == 1
    assert "double-booked" in report.errors[0]
    assert "gpio4" in report.errors[0]


def test_adc_pin_on_non_adc1_gpio_is_an_error() -> None:
    report = report_for("bad-adc")
    assert len(report.errors) == 1
    assert "adc1_gpios" in report.errors[0]
    assert "gpio15" in report.errors[0]
    assert "line.out" in report.errors[0]


def test_reserved_gpio_is_an_error() -> None:
    report = report_for("reserved-pin")
    assert len(report.errors) == 1
    assert "reserved" in report.errors[0]
    assert "gpio3" in report.errors[0]


def test_power_budget_overrun_is_a_warning_not_an_error() -> None:
    report = report_for("power-hog")
    assert report.errors == []
    assert len(report.warnings) == 1
    assert "2360 mA" in report.warnings[0]
    assert "2000 mA" in report.warnings[0]
    assert report.ok


def test_autostart_behavior_mismatch_is_an_error() -> None:
    report = report_for("bad-autostart")
    assert len(report.errors) == 1
    assert "autostart_behavior 'ghost'" in report.errors[0]
