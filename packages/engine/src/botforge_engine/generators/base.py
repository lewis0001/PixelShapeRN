"""Generator scaffolding: BuildContext, the Generator protocol and the ordered registry."""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from botforge_engine.generators import (
    assembly,
    bom,
    cad,
    catalog,
    docs,
    fw_config,
    print_plan,
    urdf,
    wiring,
)
from botforge_engine.loader import ResolvedRobot
from botforge_engine.models import Registry


@dataclass
class BuildContext:
    """Everything a generator needs to produce its slice of ``dist/<robot_id>/``."""

    resolved: ResolvedRobot
    robot_dir: Path
    dist_dir: Path
    registry: Registry
    report: list[str] = field(default_factory=list)

    def ensure_dir(self, sub: str) -> Path:
        """Create (if needed) and return ``dist_dir/<sub>``."""
        path = self.dist_dir / sub
        path.mkdir(parents=True, exist_ok=True)
        return path


class Generator(Protocol):
    """Structural type every generator module satisfies (``name`` + ``run``)."""

    name: str

    def run(self, ctx: BuildContext) -> None: ...


#: Ordered generator registry — build runs these top to bottom (PLAN §3.3).
GENERATORS: list[tuple[str, Callable[[BuildContext], None]]] = [
    ("cad", cad.run),
    ("print_plan", print_plan.run),
    ("wiring", wiring.run),
    ("bom", bom.run),
    ("assembly", assembly.run),
    ("urdf", urdf.run),
    ("fw_config", fw_config.run),
    ("docs", docs.run),
    ("catalog", catalog.run),
]
