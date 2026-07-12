"""CLI tests: version/help plus validate, build and clean on the fixture data."""

from pathlib import Path

from typer.testing import CliRunner

from botforge_engine import __version__
from botforge_engine.cli import app

runner = CliRunner()

FIXTURES = Path(__file__).parent / "fixtures"
GOOD_ROBOT = FIXTURES / "robots" / "good-bot"
BAD_ROBOT = FIXTURES / "robots" / "bad-ref"


def test_help_exits_zero_and_lists_commands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ("validate", "build", "clean"):
        assert command in result.output


def test_version_prints_version() -> None:
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "0.1.0" in result.output
    assert __version__ == "0.1.0"


def test_validate_good_fixture_exits_zero() -> None:
    result = runner.invoke(app, ["validate", str(GOOD_ROBOT)])
    assert result.exit_code == 0, result.output
    assert "good-bot is valid" in result.output


def test_validate_bad_fixture_exits_one() -> None:
    result = runner.invoke(app, ["validate", str(BAD_ROBOT)])
    assert result.exit_code == 1
    assert "unknown module ref 'no-such-module'" in result.output


def test_build_only_fw_config_writes_manifest_and_config(tmp_path: Path) -> None:
    result = runner.invoke(
        app,
        ["build", str(GOOD_ROBOT), "--only", "fw_config", "--dist", str(tmp_path)],
    )
    assert result.exit_code == 0, result.output
    manifest = tmp_path / "good-bot" / "manifest.resolved.json"
    assert manifest.is_file()
    assert '"from"' in manifest.read_text(encoding="utf-8")
    assert (tmp_path / "good-bot" / "firmware" / "config.json").is_file()


def test_build_aborts_on_validation_errors(tmp_path: Path) -> None:
    result = runner.invoke(app, ["build", str(BAD_ROBOT), "--dist", str(tmp_path)])
    assert result.exit_code == 1
    assert "build aborted" in result.output
    assert not (tmp_path / "bad-ref").exists()


def test_build_rejects_unknown_generator_name(tmp_path: Path) -> None:
    result = runner.invoke(
        app, ["build", str(GOOD_ROBOT), "--only", "nope", "--dist", str(tmp_path)]
    )
    assert result.exit_code == 1
    assert "unknown generator(s): nope" in result.output


def test_clean_removes_dist(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "good-bot").mkdir(parents=True)
    (dist / "good-bot" / "manifest.resolved.json").write_text("{}")
    result = runner.invoke(app, ["clean", "--dist", str(dist)])
    assert result.exit_code == 0
    assert not dist.exists()
    # cleaning again is a no-op, not an error
    result = runner.invoke(app, ["clean", "--dist", str(dist)])
    assert result.exit_code == 0
