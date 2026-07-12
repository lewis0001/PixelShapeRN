"""BOTFORGE command-line interface: validate, build, clean."""

import json
import shutil
import time
from pathlib import Path

import typer

from botforge_engine import __version__
from botforge_engine.generators.base import GENERATORS, BuildContext
from botforge_engine.loader import RobotBundle, load_registry, load_robot, resolve
from botforge_engine.models import Registry, SpecError
from botforge_engine.validate import ValidationReport, check

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


def _error(msg: str) -> None:
    typer.secho(f"✗ {msg}", fg=typer.colors.RED)


def _warn(msg: str) -> None:
    typer.secho(f"⚠ {msg}", fg=typer.colors.YELLOW)


def _find_repo_root(start: Path) -> Path | None:
    """Walk up from *start* until a directory containing ``registry/`` is found."""
    for candidate in (start, *start.parents):
        if (candidate / "registry").is_dir():
            return candidate
    return None


def _load(robot_path: Path) -> tuple[Path, Registry, RobotBundle, ValidationReport]:
    """Locate the repo root, load registry + robot and run validation.

    Raises ``typer.Exit(1)`` (after printing) on any load error.
    """
    robot_dir = robot_path.resolve()
    if not (robot_dir / "robot.yaml").is_file():
        _error(f"no robot.yaml in {robot_dir}")
        raise typer.Exit(code=1)
    repo_root = _find_repo_root(robot_dir)
    if repo_root is None:
        _error(f"could not locate repo root: no 'registry' directory above {robot_dir}")
        raise typer.Exit(code=1)
    try:
        registry = load_registry(repo_root / "registry")
        bundle = load_robot(robot_dir)
    except SpecError as exc:
        for msg in exc.errors:
            _error(msg)
        raise typer.Exit(code=1) from exc
    return repo_root, registry, bundle, check(bundle, registry)


def _print_report(report: ValidationReport) -> None:
    for msg in report.warnings:
        _warn(msg)
    for msg in report.errors:
        _error(msg)


@app.command()
def validate(robot_path: Path) -> None:
    """Validate a robot manifest against the module registry."""
    _, _, bundle, report = _load(robot_path)
    _print_report(report)
    if report.errors:
        typer.secho(f"{len(report.errors)} error(s) found.", fg=typer.colors.RED)
        raise typer.Exit(code=1)
    suffix = f" ({len(report.warnings)} warning(s))" if report.warnings else ""
    typer.secho(f"✓ {bundle.manifest.robot.id} is valid{suffix}", fg=typer.colors.GREEN)


@app.command()
def build(
    robot_path: Path,
    only: str | None = typer.Option(
        None, "--only", help="Comma-separated generator subset (e.g. cad,wiring)."
    ),
    dist: Path | None = typer.Option(
        None, "--dist", help="Output root directory (default: <repo-root>/dist)."
    ),
) -> None:
    """Build all artifacts from a robot manifest into dist/<robot_id>/."""
    repo_root, registry, bundle, report = _load(robot_path)
    _print_report(report)
    if report.errors:
        _error("build aborted: validation failed")
        raise typer.Exit(code=1)

    names = [name for name, _ in GENERATORS]
    if only is not None:
        requested = [item.strip() for item in only.split(",") if item.strip()]
        unknown = [item for item in requested if item not in names]
        if unknown:
            _error(f"unknown generator(s): {', '.join(unknown)} (available: {', '.join(names)})")
            raise typer.Exit(code=1)
        selected = [(name, fn) for name, fn in GENERATORS if name in requested]
    else:
        selected = list(GENERATORS)

    resolved = resolve(bundle, registry)
    dist_root = dist if dist is not None else repo_root / "dist"
    dist_dir = dist_root / resolved.robot.id
    dist_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = dist_dir / "manifest.resolved.json"
    payload = resolved.model_dump(mode="json", by_alias=True)
    manifest_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    typer.echo(f"wrote {manifest_path}")

    ctx = BuildContext(
        resolved=resolved, robot_dir=bundle.robot_dir, dist_dir=dist_dir, registry=registry
    )
    rows: list[tuple[str, str, float]] = []
    failed = False
    for gen_name, run in selected:
        started = time.perf_counter()
        try:
            run(ctx)
            status = "ok"
        except NotImplementedError:
            status = "skipped (not implemented)"
            _warn(f"{gen_name}: skipped (not implemented)")
        except Exception as exc:  # a generator crash must not kill the summary table
            status = "failed"
            failed = True
            _error(f"{gen_name}: {exc}")
        rows.append((gen_name, status, (time.perf_counter() - started) * 1000.0))
    for msg in ctx.report:
        _warn(msg)

    width = max(len(name) for name, _, _ in rows) if rows else 9
    width = max(width, len("generator"))
    typer.echo("")
    typer.echo(f"{'generator':<{width}}  {'status':<26}  {'time':>10}")
    for gen_name, status, ms in rows:
        typer.echo(f"{gen_name:<{width}}  {status:<26}  {ms:7.1f} ms")
    if failed:
        raise typer.Exit(code=1)


@app.command()
def clean(
    dist: Path | None = typer.Option(
        None, "--dist", help="Dist directory to remove (default: <repo-root>/dist)."
    ),
) -> None:
    """Remove the generated build artifacts directory."""
    if dist is None:
        repo_root = _find_repo_root(Path.cwd())
        dist = (repo_root or Path.cwd()) / "dist"
    if dist.exists():
        shutil.rmtree(dist)
        typer.echo(f"removed {dist}")
    else:
        typer.echo(f"nothing to clean at {dist}")


def app_main() -> None:
    """Console-script entry point that invokes the Typer app."""
    app()
