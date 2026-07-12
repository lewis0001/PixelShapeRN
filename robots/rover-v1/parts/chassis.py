"""Rover chassis: open tray with motor cradles, PCB mounts, head platform.

Prints flat, support-free: every feature is a vertical-walled union on the
2.4 mm floor or a shallow cut. Layout (origin center-bottom, +X = front):
N20 cradles at x=-28 flush to the side walls with a coaxial shaft hole;
corner-boss standoffs for the core (left rail) and power (right rail)
boards; a walled DRV8833 bay at the rear with a USB cutout in the rear
wall; a front head-mount platform with two bosses and the caster pilot
pair; rear lid bosses; shallow wire channels in the floor.
build(params) with params {l, w, wall}.
"""

import cadquery as cq

from botforge_engine.cadlib import boss_m2_selftap, clamp_n20, plate, pocket_pcb, wire_channel

DEFAULTS = {"l": 96.0, "w": 74.0, "wall": 2.0}

FLOOR_T = 2.4
HEIGHT = 16.0  # wall top (walls ~13.6 above the floor)
BOSS_TOP = 13.0  # lid rests on this plane (plate 3 thick -> flush at 16)
MOTOR_X = -28.0
AXLE_Z = FLOOR_T + 5.0  # N20 shaft height (body 10 tall on the floor)
SHAFT_HOLE_D = 4.4
CORE = ((-6.0, -19.0), (69.0, 25.5))  # ESP32 devkit, left rail (bosses only)
PWR = ((-6.0, 21.0), (70.0, 20.0))  # power board, right rail (bosses only)
MDRV = ((-33.0, 2.0), (20.0, 15.0))  # DRV8833, rear (full walled bay)
USB_W, USB_H, USB_Z = 14.0, 8.0, 5.0  # rear-wall cutout at driver height
LID_BOSS = ((-41.5, 26.0), (-41.5, -26.0))
HEAD_BOSS = ((41.0, 10.0), (41.0, -10.0))  # matches head.py floor holes
PAD_CENTER, PAD_L, PAD_W, PAD_TOP = 38.0, 16.0, 30.0, 8.0  # head platform
CASTER_PILOT = ((32.5, 0.0), (43.5, 0.0))  # matches caster.py screw pair
PILOT_D = 1.7


def _corner_bosses(tray: cq.Workplane, spot, h: float = 3.0, inset: float = 3.5):
    """Four M2 standoff bosses at the corners of a PCB footprint."""
    (cx, cy), (l, w) = spot  # noqa: E741
    for sx in (1.0, -1.0):
        for sy in (1.0, -1.0):
            pos = (cx + sx * (l / 2 - inset), cy + sy * (w / 2 - inset), FLOOR_T)
            tray = tray.union(boss_m2_selftap(h).translate(pos))
    return tray


def build(params: dict) -> cq.Workplane:
    """Build the chassis tray. params: {l, w, wall} (missing keys use DEFAULTS)."""
    p = dict(DEFAULTS)
    p.update(params or {})
    l, w, wall = float(p["l"]), float(p["w"]), float(p["wall"])  # noqa: E741
    inner_w = w - 2 * wall

    tray = plate(l, w, HEIGHT, corner_r=3)
    cavity = (
        cq.Workplane("XY")
        .box(l - 2 * wall, inner_w, HEIGHT, centered=(True, True, False))
        .translate((0, 0, FLOOR_T))
    )
    tray = tray.cut(cavity)

    # N20 motor cradles (axis along Y) flush against each side wall, plus a
    # single coaxial shaft hole through both walls.
    clamp = clamp_n20().rotate((0, 0, 0), (0, 0, 1), 90)
    for sy in (1.0, -1.0):
        tray = tray.union(clamp.translate((MOTOR_X, sy * (inner_w / 2 - 5.0), FLOOR_T)))
    axle = (
        cq.Workplane("XY")
        .circle(SHAFT_HOLE_D / 2)
        .extrude(w + 4)
        .rotate((0, 0, 0), (1, 0, 0), -90)
        .translate((MOTOR_X, -(w + 4) / 2, AXLE_Z))
    )
    tray = tray.cut(axle)

    # PCB mounts: corner standoffs for the two long rail boards, a full
    # locating bay for the small motor driver at the rear.
    tray = _corner_bosses(tray, CORE)
    tray = _corner_bosses(tray, PWR)
    tray = tray.union(pocket_pcb(MDRV[1]).translate((*MDRV[0], FLOOR_T)))

    # Rear-wall USB cutout at motor-driver height.
    usb = (
        cq.Workplane("XY")
        .box(wall + 2, USB_W, USB_H, centered=(True, True, False))
        .translate((-l / 2 + wall / 2, 0, USB_Z))
    )
    tray = tray.cut(usb)

    # Front head-mount platform with two bosses; caster pilots drill down
    # through the pad and floor on the front centerline.
    pad = (
        cq.Workplane("XY")
        .box(PAD_L, PAD_W, PAD_TOP - FLOOR_T, centered=(True, True, False))
        .translate((PAD_CENTER, 0, FLOOR_T))
    )
    tray = tray.union(pad)
    for pos in HEAD_BOSS:
        tray = tray.union(boss_m2_selftap(BOSS_TOP - PAD_TOP).translate((*pos, PAD_TOP)))
    for pos in CASTER_PILOT:
        pilot = cq.Workplane("XY").circle(PILOT_D / 2).extrude(PAD_TOP + 2).translate((*pos, -1.0))
        tray = tray.cut(pilot)

    # Rear lid bosses (lid screws down onto these; head bosses carry the front).
    for pos in LID_BOSS:
        tray = tray.union(boss_m2_selftap(BOSS_TOP - FLOOR_T).translate((*pos, FLOOR_T)))

    # Shallow open wire channels in the floor top (1.2 deep of 2.4).
    channels = (
        wire_channel(44, depth=1.2).rotate((0, 0, 0), (0, 0, 1), 90).translate((18, 1, FLOOR_T - 1.2)),
        wire_channel(51, depth=1.2).translate((-7.5, 0, FLOOR_T - 1.2)),
        wire_channel(24, depth=1.2).rotate((0, 0, 0), (0, 0, 1), 90).translate((33, 0, FLOOR_T - 1.2)),
    )
    for ch in channels:
        tray = tray.cut(ch)
    return tray
