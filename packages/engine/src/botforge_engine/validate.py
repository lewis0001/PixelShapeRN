"""Cross-file validation rules for robot bundles (PLAN Phase 1, task 2).

``check(bundle, registry)`` returns a :class:`ValidationReport` with
human-friendly ``errors`` and ``warnings`` string lists. It never raises on
bad data — the CLI decides what to do with the report.
"""

import re
from dataclasses import dataclass, field

from botforge_engine.loader import GPIO_RE, RobotBundle
from botforge_engine.models import Module, ModuleCategory, PinType, Registry

#: Boost-converter rating in mA; exceeding it is a warning (rule h).
POWER_BUDGET_MA = 2000

_FASTENER_USE_RE = re.compile(r"^(\S+)\s+x(\d+)$")

#: Legal endpoint pin-type pairs, direction-agnostic (rule g). A core gpio may
#: pair with gpio/pwm/i2c_sda/i2c_scl and with adc (rule e further constrains
#: adc pairs to ADC1-capable gpios); power rails pair like-with-like; motor
#: terminals and switch terminals pair with themselves.
_LEGAL_PAIRS: set[frozenset[PinType]] = {
    frozenset({PinType.gpio}),
    frozenset({PinType.gpio, PinType.pwm}),
    frozenset({PinType.gpio, PinType.adc}),
    frozenset({PinType.gpio, PinType.i2c_sda}),
    frozenset({PinType.gpio, PinType.i2c_scl}),
    frozenset({PinType.v5}),
    frozenset({PinType.v3v3}),
    frozenset({PinType.gnd}),
    frozenset({PinType.vbat}),
    frozenset({PinType.motor_out}),
    frozenset({PinType.switch}),
}


@dataclass
class ValidationReport:
    """Outcome of ``check()``: human-friendly error and warning strings."""

    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass
class _Endpoint:
    instance: str
    pin_name: str
    pin_type: PinType
    gpio: int | None
    module: Module


def _core_params(module: Module) -> dict:
    return module.firmware.params if module.firmware else {}


def check(bundle: RobotBundle, registry: Registry) -> ValidationReport:
    """Run all validation rules (a–j) against a loaded robot bundle."""
    report = ValidationReport()
    errors = report.errors
    manifest = bundle.manifest

    # --- rule a: refs exist ------------------------------------------------
    declared: set[str] = set()
    known: dict[str, Module] = {}
    for inst in manifest.modules:
        if inst.id in declared:
            errors.append(f"duplicate module instance id '{inst.id}'")
        declared.add(inst.id)
        module = registry.modules.get(inst.ref)
        if module is None:
            errors.append(f"unknown module ref '{inst.ref}' (instance '{inst.id}')")
        else:
            known[inst.id] = module

    for use in manifest.fasteners:
        if use.ref not in registry.fasteners:
            errors.append(f"unknown fastener ref '{use.ref}'")

    # --- rule b: endpoints reference declared instances + real pins --------
    def resolve_endpoint(raw: str, where: str) -> _Endpoint | None:
        if "." not in raw:
            errors.append(f"{where}: malformed endpoint '{raw}' (expected '<instance>.<pin>')")
            return None
        inst_id, pin_name = raw.split(".", 1)
        if inst_id not in declared:
            errors.append(f"{where}: unknown instance '{inst_id}'")
            return None
        module = known.get(inst_id)
        if module is None:  # unknown ref — already reported by rule a
            return None
        for pin in module.electrical.pins:
            if pin.name == pin_name:
                return _Endpoint(inst_id, pin_name, pin.type, None, module)
        if module.category is ModuleCategory.core:
            match = GPIO_RE.match(pin_name)
            if match:
                n = int(match.group(1))
                if n not in _core_params(module).get("available_gpios", []):
                    errors.append(f"{where}: gpio{n} is not an available gpio on core '{inst_id}'")
                    return None
                return _Endpoint(inst_id, pin_name, PinType.gpio, n, module)
        errors.append(
            f"{where}: module '{module.id}' has no pin '{pin_name}' (instance '{inst_id}')"
        )
        return None

    pairs: list[tuple[int, _Endpoint | None, _Endpoint | None]] = []
    connected: set[tuple[str, str]] = set()
    for i, conn in enumerate(manifest.connections):
        src = resolve_endpoint(conn.from_, f"connections[{i}].from")
        dst = resolve_endpoint(conn.to, f"connections[{i}].to")
        for ep in (src, dst):
            if ep is not None:
                connected.add((ep.instance, ep.pin_name))
        pairs.append((i, src, dst))

    # --- rule c: required pins connected (non-core instances) --------------
    for inst in manifest.modules:
        module = known.get(inst.id)
        if module is None or module.category is ModuleCategory.core:
            continue
        for pin in module.electrical.pins:
            if pin.required and (inst.id, pin.name) not in connected:
                errors.append(f"required pin '{inst.id}.{pin.name}' is not connected")

    # --- rules d/e/f/g over resolved connections ---------------------------
    gpio_peers: dict[tuple[str, int], list[PinType | None]] = {}
    for i, src, dst in pairs:
        for ep, peer in ((src, dst), (dst, src)):
            if ep is None or ep.gpio is None:
                continue
            # rule f: reserved core gpios
            if ep.gpio in _core_params(ep.module).get("reserved_gpios", []):
                errors.append(
                    f"connections[{i}]: gpio{ep.gpio} is reserved on core '{ep.instance}'"
                )
            gpio_peers.setdefault((ep.instance, ep.gpio), []).append(
                peer.pin_type if peer is not None else None
            )
        if src is None or dst is None:
            continue
        # rule g: endpoint type legality
        if frozenset({src.pin_type, dst.pin_type}) not in _LEGAL_PAIRS:
            errors.append(
                f"connections[{i}]: incompatible pin types "
                f"{src.pin_type.value}↔{dst.pin_type.value}"
            )
            continue
        # rule e: adc module pins must land on ADC1-capable core gpios
        for ep, other in ((src, dst), (dst, src)):
            if ep.pin_type is PinType.adc and other.gpio is not None:
                if other.gpio not in _core_params(other.module).get("adc1_gpios", []):
                    errors.append(
                        f"connections[{i}]: adc pin '{ep.instance}.{ep.pin_name}' must connect "
                        f"to an ADC1 gpio (gpio{other.gpio} is not in adc1_gpios)"
                    )

    # --- rule d: GPIO double-booking (shared I2C buses excepted) -----------
    for (inst_id, n), peers in gpio_peers.items():
        if len(peers) < 2:
            continue
        peer_types = set(peers)
        if peer_types == {PinType.i2c_sda} or peer_types == {PinType.i2c_scl}:
            continue
        errors.append(f"gpio{n} on '{inst_id}' is double-booked by {len(peers)} connections")

    # --- rule h: power budget ----------------------------------------------
    total_ma = sum(
        known[inst.id].electrical.current_ma.max for inst in manifest.modules if inst.id in known
    )
    if total_ma > POWER_BUDGET_MA:
        report.warnings.append(
            f"power budget: total max current {total_ma} mA exceeds the "
            f"{POWER_BUDGET_MA} mA budget"
        )

    # --- rule i: behaviors ---------------------------------------------------
    errors.extend(bundle.behavior_errors)
    behavior_ids = [b.id for b in manifest.behaviors]
    defaults = [b.id for b in manifest.behaviors if b.default]
    for ref in manifest.behaviors:
        raw = bundle.behaviors.get(ref.id)
        if raw is None:
            continue  # load failure already reported via behavior_errors
        if not isinstance(raw, dict):
            errors.append(f"{ref.file}: behavior must be a JSON object (behavior '{ref.id}')")
            continue
        if raw.get("bsj") != 1:
            errors.append(f"{ref.file}: top-level 'bsj' must be 1 (behavior '{ref.id}')")
        if not raw.get("name"):
            errors.append(f"{ref.file}: missing top-level 'name' (behavior '{ref.id}')")
    autostart = manifest.firmware.autostart_behavior
    if autostart not in behavior_ids:
        errors.append(
            f"firmware.autostart_behavior '{autostart}' does not match any behaviors[].id"
        )
    if len(defaults) > 1:
        errors.append(
            f"behaviors: at most one behavior may set default: true (got {', '.join(defaults)})"
        )

    # --- rule j: printed parts + assembly -----------------------------------
    parts_dir = bundle.robot_dir / "parts"
    parts = {part.id: part for part in manifest.printed_parts}
    for part in manifest.printed_parts:
        if not (parts_dir / part.script).is_file():
            errors.append(
                f"printed_parts: script '{part.script}' not found in parts/ (part '{part.id}')"
            )

    fastener_refs = {use.ref for use in manifest.fasteners}
    addable = set(parts) | declared | fastener_refs
    referenced_parts: set[str] = set()
    assembly = bundle.assembly
    for k, step in enumerate(assembly.steps):
        for entry in step.adds:
            base = entry.split("@", 1)[0]
            if base not in addable:
                errors.append(f"assembly: steps[{k}].adds: unknown id '{entry}'")
                continue
            if base in parts:
                referenced_parts.add(base)
            if entry not in assembly.poses:
                errors.append(f"assembly: no pose for '{entry}' (added in step {step.id})")
        for spec in step.fasteners or []:
            match = _FASTENER_USE_RE.match(spec)
            if match is None:
                errors.append(
                    f"assembly: steps[{k}].fasteners: malformed '{spec}' (expected '<ref> xN')"
                )
            elif match.group(1) not in fastener_refs:
                errors.append(
                    f"assembly: steps[{k}].fasteners: unknown fastener ref '{match.group(1)}'"
                )
    for part_id in sorted(referenced_parts):
        part = parts[part_id]
        if part.qty > 1:
            for n in range(1, part.qty + 1):
                if f"{part_id}@{n}" not in assembly.poses:
                    errors.append(
                        f"assembly: printed part '{part_id}' (qty {part.qty}) is missing "
                        f"pose '{part_id}@{n}'"
                    )

    return report
