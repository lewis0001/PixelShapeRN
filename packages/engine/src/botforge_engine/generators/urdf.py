"""URDF generator — robot.urdf + meshes for the simulator into dist/<id>/urdf/.

Stub: a Phase 1 generator agent fills in the implementation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from botforge_engine.generators.base import BuildContext

name = "urdf"


def run(ctx: BuildContext) -> None:
    """Not implemented yet — the build CLI reports this generator as skipped."""
    raise NotImplementedError("urdf: implemented by Phase 1 generator agents")
