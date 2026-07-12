"""Registry/robot loading and manifest resolution.

* :func:`load_registry` — parse ``registry/modules/*.yaml`` + ``registry/fasteners.yaml``.
* :func:`load_robot` — parse ``robots/<id>/robot.yaml``, its assembly file and
  behavior JSON files (behaviors are kept as raw dicts; load problems are
  recorded on the bundle so the validator can report them).
* :func:`resolve` — inline registry data into the manifest, producing the
  :class:`ResolvedRobot` that generators consume and that serializes to
  ``dist/<id>/manifest.resolved.json`` via ``.model_dump(mode="json", by_alias=True)``.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from botforge_engine.models import (
    Assembly,
    BehaviorRef,
    Fastener,
    FastenersFile,
    FirmwareCfg,
    Module,
    ModuleCategory,
    ModuleInstance,
    Pin,
    PinType,
    PrintedPart,
    Registry,
    RobotInfo,
    RobotManifest,
    SimCfg,
    SpecError,
    format_validation_error,
)

GPIO_RE = re.compile(r"^gpio(\d+)$")


def _read_yaml(path: Path, label: str) -> Any:
    if not path.is_file():
        raise SpecError([f"{label}: file not found: {path}"])
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise SpecError([f"{label}: invalid YAML: {exc}"]) from exc


def load_registry(registry_dir: Path) -> Registry:
    """Load every ``modules/*.yaml`` plus ``fasteners.yaml`` from *registry_dir*."""
    errors: list[str] = []
    modules: dict[str, Module] = {}

    modules_dir = registry_dir / "modules"
    if not modules_dir.is_dir():
        raise SpecError([f"registry: no modules/ directory in {registry_dir}"])
    for path in sorted(modules_dir.glob("*.yaml")):
        label = f"modules/{path.name}"
        try:
            module = Module.model_validate(_read_yaml(path, label))
        except SpecError as exc:
            errors.extend(exc.errors)
            continue
        except ValidationError as exc:
            errors.extend(format_validation_error(exc, label))
            continue
        if module.id in modules:
            errors.append(f"{label}: duplicate module id '{module.id}'")
            continue
        modules[module.id] = module

    fasteners: dict[str, Fastener] = {}
    try:
        raw_fasteners = _read_yaml(registry_dir / "fasteners.yaml", "fasteners.yaml")
        parsed = FastenersFile.model_validate(raw_fasteners)
        for fastener in parsed.fasteners:
            if fastener.id in fasteners:
                errors.append(f"fasteners.yaml: duplicate fastener id '{fastener.id}'")
                continue
            fasteners[fastener.id] = fastener
    except SpecError as exc:
        errors.extend(exc.errors)
    except ValidationError as exc:
        errors.extend(format_validation_error(exc, "fasteners.yaml"))

    if errors:
        raise SpecError(errors)
    return Registry(modules=modules, fasteners=fasteners)


@dataclass
class RobotBundle:
    """Everything loaded from a ``robots/<id>/`` directory.

    ``behaviors`` maps behavior id → raw parsed JSON dict. Behavior files
    that were missing or unparseable are reported in ``behavior_errors``
    (folded into the validation report by ``validate.check``).
    """

    robot_dir: Path
    manifest: RobotManifest
    assembly: Assembly
    behaviors: dict[str, Any] = field(default_factory=dict)
    behavior_errors: list[str] = field(default_factory=list)


def load_robot(robot_dir: Path) -> RobotBundle:
    """Load ``robot.yaml``, the assembly file and behavior JSONs from *robot_dir*."""
    try:
        manifest = RobotManifest.model_validate(_read_yaml(robot_dir / "robot.yaml", "robot.yaml"))
    except ValidationError as exc:
        raise SpecError(format_validation_error(exc, "robot.yaml")) from exc

    try:
        raw_assembly = _read_yaml(robot_dir / manifest.assembly, manifest.assembly)
        assembly = Assembly.model_validate(raw_assembly)
    except ValidationError as exc:
        raise SpecError(format_validation_error(exc, manifest.assembly)) from exc

    behaviors: dict[str, Any] = {}
    behavior_errors: list[str] = []
    for ref in manifest.behaviors:
        path = robot_dir / ref.file
        if not path.is_file():
            behavior_errors.append(f"{ref.file}: file not found (behavior '{ref.id}')")
            continue
        try:
            behaviors[ref.id] = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            behavior_errors.append(f"{ref.file}: invalid JSON: {exc} (behavior '{ref.id}')")

    return RobotBundle(
        robot_dir=robot_dir,
        manifest=manifest,
        assembly=assembly,
        behaviors=behaviors,
        behavior_errors=behavior_errors,
    )


class ResolvedModule(BaseModel):
    """A module instance with its registry definition inlined."""

    id: str
    ref: str
    label: str
    module: Module


class ResolvedEndpoint(BaseModel):
    """One side of a connection: instance id, registry module id and pin object.

    ``gpio`` carries the parsed pin number for core ``gpioN`` endpoints
    (``None`` for named pins), so generators never re-parse pin names.
    """

    instance: str
    module: str
    pin: Pin
    gpio: int | None = None


class ResolvedConnection(BaseModel):
    """A connection with both endpoints resolved. Serializes ``from_`` as ``from``."""

    model_config = ConfigDict(populate_by_name=True)

    from_: ResolvedEndpoint = Field(alias="from")
    to: ResolvedEndpoint
    len_mm: int
    note: str | None = None


class ResolvedFastenerUse(BaseModel):
    """A fastener line item with its registry definition inlined."""

    ref: str
    qty: int
    fastener: Fastener


class ResolvedRobot(BaseModel):
    """The fully resolved manifest that all generators consume (PLAN §5.6).

    Serialize with ``.model_dump(mode="json", by_alias=True)`` to produce
    ``dist/<id>/manifest.resolved.json``.
    """

    schema_version: Literal[1] = 1
    robot: RobotInfo
    modules: list[ResolvedModule]
    connections: list[ResolvedConnection]
    printed_parts: list[PrintedPart]
    fasteners: list[ResolvedFastenerUse]
    assembly: Assembly
    behaviors: list[BehaviorRef]
    firmware: FirmwareCfg
    sim: SimCfg | None = None
    options: list[dict[str, Any]] | None = None

    def module_for(self, instance_id: str) -> Module:
        """Return the registry module inlined for a given instance id."""
        for entry in self.modules:
            if entry.id == instance_id:
                return entry.module
        raise KeyError(instance_id)


def resolve(bundle: RobotBundle, registry: Registry) -> ResolvedRobot:
    """Inline registry data into the manifest and resolve connection endpoints.

    Expects a bundle that passed ``validate.check``; unresolvable refs or
    endpoints raise :class:`SpecError`.
    """
    manifest = bundle.manifest
    errors: list[str] = []

    instances: dict[str, ModuleInstance] = {}
    modules: list[ResolvedModule] = []
    for inst in manifest.modules:
        module = registry.modules.get(inst.ref)
        if module is None:
            errors.append(f"unknown module ref '{inst.ref}' (instance '{inst.id}')")
            continue
        instances[inst.id] = inst
        modules.append(ResolvedModule(id=inst.id, ref=inst.ref, label=inst.label, module=module))

    def endpoint(raw: str, where: str) -> ResolvedEndpoint | None:
        inst_id, sep, pin_name = raw.partition(".")
        inst = instances.get(inst_id) if sep else None
        if inst is None:
            errors.append(f"{where}: cannot resolve endpoint '{raw}'")
            return None
        module = registry.modules[inst.ref]
        for pin in module.electrical.pins:
            if pin.name == pin_name:
                return ResolvedEndpoint(instance=inst_id, module=module.id, pin=pin)
        if module.category is ModuleCategory.core:
            match = GPIO_RE.match(pin_name)
            if match:
                synthetic = Pin(name=pin_name, type=PinType.gpio, required=False)
                return ResolvedEndpoint(
                    instance=inst_id, module=module.id, pin=synthetic, gpio=int(match.group(1))
                )
        errors.append(f"{where}: cannot resolve endpoint '{raw}'")
        return None

    connections: list[ResolvedConnection] = []
    for i, conn in enumerate(manifest.connections):
        src = endpoint(conn.from_, f"connections[{i}].from")
        dst = endpoint(conn.to, f"connections[{i}].to")
        if src is None or dst is None:
            continue
        connections.append(
            ResolvedConnection(from_=src, to=dst, len_mm=conn.len_mm, note=conn.note)
        )

    fasteners: list[ResolvedFastenerUse] = []
    for use in manifest.fasteners:
        fastener = registry.fasteners.get(use.ref)
        if fastener is None:
            errors.append(f"unknown fastener ref '{use.ref}'")
            continue
        fasteners.append(ResolvedFastenerUse(ref=use.ref, qty=use.qty, fastener=fastener))

    if errors:
        raise SpecError(errors)

    return ResolvedRobot(
        schema_version=manifest.schema_version,
        robot=manifest.robot,
        modules=modules,
        connections=connections,
        printed_parts=manifest.printed_parts,
        fasteners=fasteners,
        assembly=bundle.assembly,
        behaviors=manifest.behaviors,
        firmware=manifest.firmware,
        sim=manifest.sim,
        options=manifest.options,
    )
