"""Print-plan generator — slicer estimates per part into dist/<id>/print/print_plan.json.

Stub: a Phase 1 generator agent fills in the implementation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from botforge_engine.generators.base import BuildContext

name = "print_plan"


def run(ctx: BuildContext) -> None:
    """Not implemented yet — the build CLI reports this generator as skipped."""
    raise NotImplementedError("print_plan: implemented by Phase 1 generator agents")
