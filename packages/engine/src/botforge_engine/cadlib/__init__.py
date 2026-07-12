"""botforge_engine.cadlib — shared CadQuery helpers for printed-part scripts.

Conventions (documented in full in ``packages/engine/CAD_GUIDE.md``): units mm,
Z-up, origin at part center bottom (z=0 = print bed), all parts print
support-free. Part scripts import from here; the engine core never does
(cadquery stays an optional extra).
"""

from botforge_engine.cadlib.constants import FIT, WALL_MIN
from botforge_engine.cadlib.features import (
    boss_m2_selftap,
    clamp_n20,
    plate,
    pocket_pcb,
    pocket_sg90,
    snapless_lip,
    wire_channel,
)

__all__ = [
    "FIT",
    "WALL_MIN",
    "boss_m2_selftap",
    "clamp_n20",
    "plate",
    "pocket_pcb",
    "pocket_sg90",
    "snapless_lip",
    "wire_channel",
]
