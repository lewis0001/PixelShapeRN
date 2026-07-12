"""BOTFORGE command-line interface (Phase 0 stubs)."""

from pathlib import Path

import typer

from botforge_engine import __version__

app = typer.Typer(
    name="botforge",
    help="BOTFORGE engine — compiles robot manifests into every artifact.",
    no_args_is_help=True,
)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(__version__)
        raise typer.Exit()


@app.callback()
def main(
    version: bool = typer.Option(
        False,
        "--version",
        callback=_version_callback,
        is_eager=True,
        help="Show the engine version and exit.",
    ),
) -> None:
    """BOTFORGE engine — compiles robot manifests into every artifact."""


@app.command()
def validate(robot_path: Path) -> None:
    """Validate a robot manifest."""
    typer.echo("validate: not implemented yet (Phase 1)")
    raise typer.Exit(code=2)


@app.command()
def build(
    robot_path: Path,
    only: str = typer.Option(None, "--only", help="comma-separated generator subset"),
) -> None:
    """Build all artifacts from a robot manifest."""
    typer.echo("build: not implemented yet (Phase 1)")
    raise typer.Exit(code=2)


@app.command()
def clean() -> None:
    """Remove generated build artifacts."""
    typer.echo("clean: not implemented yet (Phase 1)")
    raise typer.Exit(code=2)


def app_main() -> None:
    """Console-script entry point that invokes the Typer app."""
    app()
