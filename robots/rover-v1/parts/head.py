"""Rover sensor head: angled face with ToF window, LED eye holes, board pocket.

A 34 x 20 x 24 block whose front face leans back 10 degrees (only 10 degrees
off vertical, so it prints flat with no supports). A rectangular 13 x 7
VL53L0X window and two 5.2 mm WS2812 eye holes pass through the tilted face
into a back-side pocket whose ceiling is a 45-degree ramp (printable) and
whose rear/top are open for board insertion. Two M2 holes in the floor mount
it to the chassis front bosses. build(params) with params {} (fixed geometry).
"""

import math

import cadquery as cq

DEFAULTS: dict = {}

W = 34.0  # width (X)
D = 20.0  # depth (Y); front face at y = -10
H = 24.0  # height (Z)
TILT_DEG = 10.0  # front face lean-back angle from vertical
FRONT_WALL = 2.4  # wall behind the tilted face
CAVITY_W = 27.0  # pocket width (X)
CAVITY_FLOOR = 3.0  # pocket floor height
CEIL_START_Z = 17.0  # where the 45-degree pocket ceiling leaves the front wall
WINDOW_W, WINDOW_H, WINDOW_Z = 13.0, 7.0, 12.0  # VL53L0X window (through face)
EYE_D, EYE_X, EYE_Z = 5.2, 8.0, 19.0  # WS2812 eye holes
SCREW_D = 2.4  # M2 clearance holes in the floor
SCREW_X = 10.0  # hole centers at (+-10, 0), matching the chassis head bosses


def _front_y(z: float, offset: float = 0.0) -> float:
    """Y of the tilted front plane at height z, shifted back by ``offset``."""
    return -D / 2.0 + offset / math.cos(math.radians(TILT_DEG)) + z * math.tan(
        math.radians(TILT_DEG)
    )


def build(params: dict) -> cq.Workplane:
    """Build the head. params: {} (geometry is fixed)."""
    # Body: YZ profile (rectangle with a 10-degree slanted front) swept across X.
    outline = [(D / 2, 0.0), (D / 2, H), (_front_y(H), H), (_front_y(0.0), 0.0)]
    body = cq.Workplane("YZ").polyline(outline).close().extrude(W).translate((-W / 2, 0, 0))

    # Back-side pocket: floor at z=3, front boundary parallel to the tilted
    # face (FRONT_WALL behind it), 45-degree ceiling from the front wall up
    # and back through the top — open at the rear and top-rear.
    yf = _front_y(CEIL_START_Z, FRONT_WALL)
    pocket_profile = [
        (_front_y(CAVITY_FLOOR, FRONT_WALL), CAVITY_FLOOR),
        (D / 2 + 2, CAVITY_FLOOR),
        (D / 2 + 2, H + 2),
        (yf + (H + 2 - CEIL_START_Z), H + 2),
        (yf, CEIL_START_Z),
    ]
    pocket = (
        cq.Workplane("YZ")
        .polyline(pocket_profile)
        .close()
        .extrude(CAVITY_W)
        .translate((-CAVITY_W / 2, 0, 0))
    )
    body = body.cut(pocket)

    # ToF window: rectangular through-cut in the tilted face into the pocket.
    window = (
        cq.Workplane("XY")
        .box(WINDOW_W, D, WINDOW_H, centered=(True, True, True))
        .translate((0, -D / 2 + 4.0, WINDOW_Z))
    )
    body = body.cut(window)

    # Eye holes: horizontal 5.2 mm bores above the window into the pocket.
    eye = cq.Workplane("XY").circle(EYE_D / 2.0).extrude(D).rotate((0, 0, 0), (1, 0, 0), -90)
    for sx in (1.0, -1.0):
        body = body.cut(eye.translate((sx * EYE_X, -D / 2 - 2.0, EYE_Z)))

    # M2 mounting holes through the pocket floor.
    for sx in (1.0, -1.0):
        bolt = (
            cq.Workplane("XY")
            .circle(SCREW_D / 2.0)
            .extrude(CAVITY_FLOOR + 2)
            .translate((sx * SCREW_X, 0, -1.0))
        )
        body = body.cut(bolt)
    return body
