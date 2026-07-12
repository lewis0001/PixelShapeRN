"""BOTFORGE data models (frozen contracts, PLAN §5.1/§5.2).

Also provides the human-friendly validation-error plumbing: pydantic
``ValidationError``s are re-emitted as flat ``"<file>: <path>: <message>"``
strings carried by :class:`SpecError`.
"""

from pydantic import ValidationError

from botforge_engine.models.registry import (
    CurrentMa,
    Docs,
    Electrical,
    Fastener,
    FastenersFile,
    Firmware,
    Mech,
    Module,
    ModuleCategory,
    Mount,
    Pin,
    PinType,
    Registry,
    Sourcing,
    Troubleshooting,
    Wiring,
)
from botforge_engine.models.robot import (
    Assembly,
    AssemblyStep,
    BehaviorRef,
    Connection,
    FastenerUse,
    FirmwareCfg,
    ModuleInstance,
    Pose,
    PrintedPart,
    RobotInfo,
    RobotManifest,
    SimCfg,
)

__all__ = [
    "Assembly",
    "AssemblyStep",
    "BehaviorRef",
    "Connection",
    "CurrentMa",
    "Docs",
    "Electrical",
    "Fastener",
    "FastenersFile",
    "FastenerUse",
    "Firmware",
    "FirmwareCfg",
    "Mech",
    "Module",
    "ModuleCategory",
    "ModuleInstance",
    "Mount",
    "Pin",
    "PinType",
    "Pose",
    "PrintedPart",
    "Registry",
    "RobotInfo",
    "RobotManifest",
    "SimCfg",
    "Sourcing",
    "SpecError",
    "Troubleshooting",
    "Wiring",
    "format_validation_error",
]


class SpecError(Exception):
    """A spec file failed to load or validate.

    Carries a list of human-friendly ``"path: message"`` strings in
    :attr:`errors` — robot authors are the customer of these messages.
    """

    def __init__(self, errors: list[str]) -> None:
        super().__init__("\n".join(errors))
        self.errors = errors


def _format_loc(loc: tuple) -> str:
    parts: list[str] = []
    for item in loc:
        if isinstance(item, int):
            parts.append(f"[{item}]")
        elif parts:
            parts.append(f".{item}")
        else:
            parts.append(str(item))
    return "".join(parts)


def format_validation_error(exc: ValidationError, prefix: str) -> list[str]:
    """Flatten a pydantic ``ValidationError`` into human-friendly strings.

    Each entry looks like ``"robot.yaml: connections[3].from: Field required"``.
    """
    messages: list[str] = []
    for err in exc.errors():
        loc = _format_loc(err["loc"])
        if loc:
            messages.append(f"{prefix}: {loc}: {err['msg']}")
        else:
            messages.append(f"{prefix}: {err['msg']}")
    return messages
