"""Rover wheel: disc with N20 D-shaft press-fit hub and V-grooved tire surface.

Prints flat on the disc face, hub up — no supports. build(params) with
params {d: wheel diameter, tire_grooves: number of V-grooves}.
"""

import cadquery as cq

from botforge_engine.cadlib import FIT

DEFAULTS = {"d": 42.0, "tire_grooves": 8}

TREAD_W = 8.0  # disc width (mm)
HUB_D = 10.0  # hub outer diameter
HUB_PROUD = 6.0  # hub length beyond the disc face
SHAFT_D = 3.0  # N20 shaft diameter
SHAFT_FLAT = 2.5  # N20 shaft across-the-flat dimension
GROOVE_DEPTH = 1.2
GROOVE_HALF_W = 1.4


def _d_bore(height: float) -> cq.Workplane:
    """D-shaped bore cutter for the N20 shaft: Ø(3 + FIT) with the flat kept."""
    bore_r = (SHAFT_D + FIT) / 2.0
    flat_y = (SHAFT_FLAT - SHAFT_D / 2.0) + FIT / 2.0  # flat plane offset from axis
    bore = cq.Workplane("XY").circle(bore_r).extrude(height).translate((0, 0, -1.0))
    flat_cut = (
        cq.Workplane("XY")
        .box(2 * SHAFT_D, 2 * SHAFT_D, height + 2, centered=(True, False, False))
        .translate((0, flat_y, -1.0))
    )
    return bore.cut(flat_cut)


def build(params: dict) -> cq.Workplane:
    """Build the wheel. params: {d, tire_grooves} (missing keys use DEFAULTS)."""
    p = dict(DEFAULTS)
    p.update(params or {})
    d = float(p["d"])
    grooves = int(p["tire_grooves"])
    r = d / 2.0
    total_h = TREAD_W + HUB_PROUD

    wheel = cq.Workplane("XY").circle(r).extrude(TREAD_W)
    hub = cq.Workplane("XY").circle(HUB_D / 2.0).extrude(total_h)
    wheel = wheel.union(hub)

    # Tire surface: shallow V-grooves across the tread, polar array around the rim.
    # Extruded vertically, so every groove face is a printable vertical wall.
    if grooves > 0:
        prism = (
            cq.Workplane("XY")
            .polyline([(r + 1.0, -GROOVE_HALF_W), (r + 1.0, GROOVE_HALF_W), (r - GROOVE_DEPTH, 0)])
            .close()
            .extrude(TREAD_W + 2)
            .translate((0, 0, -1.0))
        )
        cutter = prism
        for i in range(1, grooves):
            cutter = cutter.union(prism.rotate((0, 0, 0), (0, 0, 1), 360.0 * i / grooves))
        wheel = wheel.cut(cutter)

    # Press-fit D-bore through disc and hub.
    wheel = wheel.cut(_d_bore(total_h + 2))
    return wheel
