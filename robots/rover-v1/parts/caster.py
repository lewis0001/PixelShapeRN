"""Rover caster mount: snap-in ball socket for a 6 mm steel ball.

A 16 x 16 x 8 block with a spherical socket opening on the top face. Printed
opening-up (support-free — the socket walls never exceed the QC overhang
threshold because the choked opening removes the steep cap), then flipped
over in use so the ball rolls on the ground. build(params) with
params {ball_d: nominal ball diameter}.
"""

import math

import cadquery as cq

from botforge_engine.cadlib import FIT, plate

DEFAULTS = {"ball_d": 6.2}

BLOCK_L = 16.0
BLOCK_W = 16.0
BLOCK_H = 8.0
OPENING_D = 5.4  # choked opening: the 6 mm ball snaps in past it and rolls
SCREW_D = 2.2  # M2 close-fit through holes
SCREW_SPACING = 11.0  # hole centers, matches the chassis front pilot pair
RIM_CHAMFER = 0.4  # lead-in on the opening rim for the snap-in


def build(params: dict) -> cq.Workplane:
    """Build the caster mount. params: {ball_d} (missing keys use DEFAULTS)."""
    p = dict(DEFAULTS)
    p.update(params or {})
    socket_r = (float(p["ball_d"]) + FIT) / 2.0

    block = plate(BLOCK_L, BLOCK_W, BLOCK_H, corner_r=2.0)

    # Spherical socket: center placed so the top-face opening is exactly OPENING_D.
    drop = math.sqrt(socket_r**2 - (OPENING_D / 2.0) ** 2)
    socket = cq.Workplane("XY").sphere(socket_r).translate((0, 0, BLOCK_H - drop))
    block = block.cut(socket)

    # Two M2 through holes for mounting to the chassis pilots.
    block = (
        block.faces(">Z")
        .workplane()
        .pushPoints([(-SCREW_SPACING / 2.0, 0), (SCREW_SPACING / 2.0, 0)])
        .hole(SCREW_D)
    )

    # Chamfer the top edges: lead-in on the socket rim, softened block edges.
    return block.faces(">Z").edges().chamfer(RIM_CHAMFER)
