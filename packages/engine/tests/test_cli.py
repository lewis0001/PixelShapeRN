"""Smoke tests for the BOTFORGE CLI stubs."""

from typer.testing import CliRunner

from botforge_engine import __version__
from botforge_engine.cli import app

runner = CliRunner()


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
