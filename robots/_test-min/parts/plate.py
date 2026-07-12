"""Fixture plate for the _test-min robot.

Exposes build(params) -> cq.Workplane: a plain rectangular plate with four
corner M2 pilot holes and chamfered top edges. Deliberately trivial — it
exists so the golden-test pipeline has one real printed part to exercise
end to end.
"""

import cadquery as cq

DEFAULTS = {"l": 60.0, "w": 40.0, "t": 3.0}

PILOT_D = 1.7  # M2 self-tap pilot hole diameter, mm
HOLE_INSET = 4.0  # hole centre inset from each edge, mm
CHAMFER = 0.5  # top edge chamfer, mm


def build(params):
    """Build the plate. params: {l, w, t} in mm (missing keys use DEFAULTS)."""
    p = dict(DEFAULTS)
    p.update(params or {})
    length = float(p["l"])
    width = float(p["w"])
    thick = float(p["t"])

    plate = cq.Workplane("XY").box(length, width, thick, centered=(True, True, False))

    # Four corner M2 pilot holes, inset from the edges.
    hx = length / 2.0 - HOLE_INSET
    hy = width / 2.0 - HOLE_INSET
    plate = (
        plate.faces(">Z")
        .workplane()
        .pushPoints([(hx, hy), (-hx, hy), (hx, -hy), (-hx, -hy)])
        .hole(PILOT_D)
    )

    # Soften the top edges (also breaks the hole rims, which helps screws start).
    plate = plate.faces(">Z").edges().chamfer(CHAMFER)

    return plate
