"""Wiring generator — WireViz harness YAML/SVG/PNG + wire BOM into dist/<id>/wiring/.

Stub: a Phase 1 generator agent fills in the implementation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from botforge_engine.generators.base import BuildContext

name = "wiring"


def run(ctx: BuildContext) -> None:
    """Not implemented yet — the build CLI reports this generator as skipped."""
    raise NotImplementedError("wiring: implemented by Phase 1 generator agents")
