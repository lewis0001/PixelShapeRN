"""Pydantic models mirroring the frozen robot-manifest contract (PLAN §5.2).

A robot lives in ``robots/<id>/`` as ``robot.yaml`` plus ``assembly.yaml``,
``parts/*.py`` and ``behaviors/*.json``.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class RobotInfo(BaseModel):
    """The ``robot:`` header block of a manifest."""

    id: str
    name: str
    tagline: str
    version: str
    size_class: str
    difficulty: str
    est_build_minutes: int
    hero_color: str


class ModuleInstance(BaseModel):
    """A module instance: ``id`` is the instance id, ``ref`` the registry module id."""

    id: str
    ref: str
    label: str


class Connection(BaseModel):
    """An electrical edge between two ``<instance>.<pin>`` endpoints.

    The YAML key ``from`` is a Python keyword, so the field is ``from_``
    with alias ``"from"`` (``populate_by_name`` enabled).
    """

    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    len_mm: int
    note: str | None = None


class PrintedPart(BaseModel):
    """A printed part: ``script`` is a file in ``parts/`` exposing ``build(params)``."""

    id: str
    script: str
    params: dict[str, Any] = Field(default_factory=dict)
    qty: int = 1
    material: str
    color_role: str


class FastenerUse(BaseModel):
    """A fastener line item: ``ref`` points at ``registry/fasteners.yaml``."""

    ref: str
    qty: int


class BehaviorRef(BaseModel):
    """A behavior entry: ``file`` is relative to the robot directory."""

    id: str
    file: str
    default: bool = False


class FirmwareCfg(BaseModel):
    """Robot-level firmware settings."""

    autostart_behavior: str


class SimCfg(BaseModel):
    """Kinematics hints for the simulator. Optional on the manifest."""

    drive: str
    wheel_radius_mm: float
    track_mm: float
    arena_default: str


class RobotManifest(BaseModel):
    """The full ``robots/<id>/robot.yaml`` document."""

    schema_version: Literal[1]
    robot: RobotInfo
    modules: list[ModuleInstance]
    connections: list[Connection]
    printed_parts: list[PrintedPart] = Field(default_factory=list)
    fasteners: list[FastenerUse] = Field(default_factory=list)
    assembly: str = "assembly.yaml"
    behaviors: list[BehaviorRef] = Field(default_factory=list)
    firmware: FirmwareCfg
    sim: SimCfg | None = None
    # Phase 6 configurator slots — parsed as raw dicts, semantics ignored for now.
    options: list[dict[str, Any]] | None = None


class Pose(BaseModel):
    """Final pose of a part/module in the chassis frame (mm + deg).

    Pose keys may use an ``@n`` suffix for instances of qty>1 printed parts
    (e.g. ``wheel@1``).
    """

    xyz: list[float] = Field(min_length=3, max_length=3)
    rpy: list[float] = Field(min_length=3, max_length=3)
    explode: list[float] | None = Field(default=None, min_length=3, max_length=3)


class AssemblyStep(BaseModel):
    """One LEGO-style assembly step. ``fasteners`` entries use the ``"<ref> xN"`` format."""

    id: int | str
    title: str
    adds: list[str] = Field(default_factory=list)
    fasteners: list[str] | None = None
    note: str | None = None


class Assembly(BaseModel):
    """The full ``robots/<id>/assembly.yaml`` document."""

    poses: dict[str, Pose]
    steps: list[AssemblyStep]
