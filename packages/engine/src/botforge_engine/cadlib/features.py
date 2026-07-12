"""Shared CadQuery feature helpers (PLAN Phase 1.3).

Every helper returns a ``cq.Workplane`` solid built with the repo conventions
(units mm, Z-up, z=0 = print bed / attachment plane, XY-centered on the
feature's own origin). *Positive* features (bosses, clamps, PCB bays, lips)
are unioned onto a body; *cutters* (pockets, channels) are translated into
place and cut. See ``packages/engine/CAD_GUIDE.md``.
"""

import cadquery as cq

from botforge_engine.cadlib.constants import FIT, WALL_MIN

#: N20 gear-motor body cross-section (mm): 12 wide x 10 tall.
N20_BODY_W = 12.0
N20_BODY_H = 10.0
#: SG90 servo drop-in body opening (mm), clearance already included.
SG90_BODY_L = 23.2
SG90_BODY_W = 12.6
#: M2 self-tap pilot hole diameter (mm).
M2_PILOT_D = 1.7


def plate(l: float, w: float, t: float, corner_r: float = 3.0) -> cq.Workplane:  # noqa: E741
    """Rounded-corner base plate: l x w x t, centered in XY, z from 0 to t."""
    wp = cq.Workplane("XY").box(l, w, t, centered=(True, True, False))
    if corner_r > 0:
        wp = wp.edges("|Z").fillet(corner_r)
    return wp


def boss_m2_selftap(h: float, outer_d: float = 5.0) -> cq.Workplane:
    """Cylindrical screw boss, outer diameter 5, with an M2 self-tap pilot (1.7).

    Sits on z=0, pilot drilled through the full height (the body it is unioned
    onto closes the bottom).
    """
    return (
        cq.Workplane("XY")
        .circle(outer_d / 2.0)
        .extrude(h)
        .faces(">Z")
        .workplane()
        .hole(M2_PILOT_D)
    )


def pocket_sg90(depth: float = 16.0, tab_recess: float = 2.7) -> cq.Workplane:
    """SG90 servo pocket cutter: 23.2 x 12.6 drop-in body + flush tab slots.

    The body opening runs z 0..depth (cut through a deck of thickness
    ``depth``); tab slots (5.0 long each side, ``tab_recess`` deep) let the
    mounting flange sit flush with the deck top; two M2 pilot columns under
    the tab screw positions are included in the cutter.
    """
    cutter = cq.Workplane("XY").box(SG90_BODY_L, SG90_BODY_W, depth, centered=(True, True, False))
    tab_x = SG90_BODY_L / 2.0 + 2.5
    for sx in (1.0, -1.0):
        slot = (
            cq.Workplane("XY")
            .box(5.0 + FIT, SG90_BODY_W, tab_recess, centered=(True, True, False))
            .translate((sx * tab_x, 0.0, depth - tab_recess))
        )
        pilot = (
            cq.Workplane("XY")
            .circle(M2_PILOT_D / 2.0)
            .extrude(depth - tab_recess)
            .translate((sx * tab_x, 0.0, 0.0))
        )
        cutter = cutter.union(slot).union(pilot)
    return cutter


def clamp_n20(clamp_l: float = 10.0, wall_t: float = 2.4, grip_h: float = 8.0) -> cq.Workplane:
    """N20 motor cradle: two friction walls gripping the 12 x 10 mm motor body.

    Motor axis runs along X; the slot across Y is 12 + FIT wide. Walls are
    ``clamp_l`` (10 mm) long, sit on z=0 and rise ``grip_h`` with a small
    lead-in chamfer on top. Union onto a floor, drop the motor in from above.
    """
    slot_w = N20_BODY_W + FIT
    feature = None
    for sy in (1.0, -1.0):
        wall = (
            cq.Workplane("XY")
            .box(clamp_l, wall_t, grip_h, centered=(True, True, False))
            .translate((0.0, sy * (slot_w + wall_t) / 2.0, 0.0))
        )
        feature = wall if feature is None else feature.union(wall)
    return feature.edges("|X and >Z").chamfer(0.6)


def pocket_pcb(
    dims: tuple[float, float],
    standoff: float = 3.0,
    wall_t: float = WALL_MIN,
    wall_h: float | None = None,
    hole_inset: float = 3.5,
) -> cq.Workplane:
    """PCB bay: perimeter locating wall + four corner standoff bosses.

    ``dims`` is the (l, w) PCB footprint. The opening is l+2*FIT x w+2*FIT;
    the board rests on ``standoff``-tall corner bosses with M2 pilots at
    ``hole_inset`` from each board corner. Positive feature — union onto a
    floor (never cut a pocket into a thin floor).
    """
    l, w = float(dims[0]), float(dims[1])  # noqa: E741
    if wall_h is None:
        wall_h = standoff + 3.0
    il, iw = l + 2 * FIT, w + 2 * FIT
    feature = (
        cq.Workplane("XY").rect(il + 2 * wall_t, iw + 2 * wall_t).rect(il, iw).extrude(wall_h)
    )
    bx, by = l / 2.0 - hole_inset, w / 2.0 - hole_inset
    for sx in (1.0, -1.0):
        for sy in (1.0, -1.0):
            feature = feature.union(boss_m2_selftap(standoff).translate((sx * bx, sy * by, 0.0)))
    return feature


def wire_channel(l: float, path_w: float = 4.0, depth: float = 3.0) -> cq.Workplane:  # noqa: E741
    """Open wire-channel cutter: straight bar, length l along X, z 0..depth.

    Translate so z=0 sits ``depth`` below the surface to groove, then cut.
    """
    return cq.Workplane("XY").box(l, path_w, depth, centered=(True, True, False))


def snapless_lip(
    l: float, w: float, h: float = 2.0, wall_t: float = WALL_MIN  # noqa: E741
) -> cq.Workplane:
    """Friction lip ring for lids: outer (l - FIT) x (w - FIT), z 0..h.

    Pass the tray's inner-opening dims; FIT is subtracted here. The top edges
    (insertion side in print orientation) get a lead-in chamfer. Union onto
    the underside-up lid plate.
    """
    ol, ow = l - FIT, w - FIT
    ring = cq.Workplane("XY").rect(ol, ow).rect(ol - 2 * wall_t, ow - 2 * wall_t).extrude(h)
    return ring.faces(">Z").edges().chamfer(0.5)
