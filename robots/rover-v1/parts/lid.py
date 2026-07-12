"""Rover lid: 92 x 70 x 3 plate with a friction lip and ventilation slots.

Printed outer-face-down: the plate spans z 0..3 and the snapless lip rises
from the plate top (z 3..5). Flipped over in use, the lip drops into the
chassis inner opening (92 x 70 minus FIT) and the plate rests on the four
chassis bosses; two M2 screws at the rear boss positions hold it down.
build(params) with params {} (fixed geometry).
"""

import cadquery as cq

from botforge_engine.cadlib import plate, snapless_lip

DEFAULTS: dict = {}

PLATE_L = 92.0
PLATE_W = 70.0
PLATE_T = 3.0
LIP_H = 2.0
SCREW_D = 2.4  # M2 clearance holes
SCREW_POSITIONS = [(-41.5, 26.0), (-41.5, -26.0)]  # matches chassis rear lid bosses
VENT_L = 8.0  # slot length
VENT_W = 3.0  # slot width
VENT_XS = (-18.0, -6.0, 6.0, 18.0)
VENT_YS = (-12.0, 0.0, 12.0)


def build(params: dict) -> cq.Workplane:
    """Build the lid. params: {} (geometry is fixed to the chassis)."""
    lid = plate(PLATE_L, PLATE_W, PLATE_T, corner_r=0)

    # Lead-in chamfer on the outer bottom edge (bed side) for easy seating,
    # applied while the bottom face still has only its four outline edges.
    lid = lid.faces("<Z").edges().chamfer(0.4)

    # Friction lip on the (printed) top = underside in use.
    lid = lid.union(snapless_lip(PLATE_L, PLATE_W, h=LIP_H).translate((0, 0, PLATE_T)))

    # 8 x 3 mm ventilation slot grid + M2 clearance holes matching the chassis
    # rear bosses (positions are symmetric about X, so the flip into use
    # orientation preserves them). Cut downward from the lip-top plane.
    vents = [(x, y) for x in VENT_XS for y in VENT_YS]
    top = lid.faces(">Z").workplane()
    lid = top.pushPoints(vents).slot2D(VENT_L, VENT_W).cutThruAll()
    return lid.faces(">Z").workplane().pushPoints(SCREW_POSITIONS).hole(SCREW_D)
