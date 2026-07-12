"""Firmware-config generator — dist/<id>/firmware/config.json derived from connections.

Implements PLAN §5.5: the config is a pure function of the manifest connections
plus the registry driver params. Every module instance that carries a firmware
block (except the core itself) becomes one ``modules[]`` entry, in manifest
order. Pin assignments come from connections whose other endpoint is a core
``gpioN`` pin; power/ground/motor/switch wiring contributes nothing.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from botforge_engine.models import ModuleCategory

if TYPE_CHECKING:
    from botforge_engine.generators.base import BuildContext

name = "fw_config"

#: Core capability-map keys (GPIO maps on core modules) — never driver params.
_CORE_CAPABILITY_KEYS = frozenset({"available_gpios", "adc1_gpios", "reserved_gpios"})


def run(ctx: BuildContext) -> None:
    """Write ``firmware/config.json`` for the resolved robot."""
    resolved = ctx.resolved

    modules: list[dict[str, Any]] = []
    for entry in resolved.modules:
        module = entry.module
        if module.firmware is None or module.category is ModuleCategory.core:
            continue

        # pins: this instance's pin name -> core GPIO number, in connection order.
        pins: dict[str, int] = {}
        for conn in resolved.connections:
            for this, other in ((conn.from_, conn.to), (conn.to, conn.from_)):
                if this.instance == entry.id and other.gpio is not None:
                    pins[this.pin.name] = other.gpio

        params = {
            key: value
            for key, value in module.firmware.params.items()
            if key not in _CORE_CAPABILITY_KEYS
        }
        modules.append(
            {"id": entry.id, "driver": module.firmware.driver, "pins": pins, "params": params}
        )

    config: dict[str, Any] = {
        "cfg": 1,
        "robot_id": resolved.robot.id,
        "name_default": resolved.robot.name,
        "autostart": resolved.firmware.autostart_behavior,
        "modules": modules,
    }
    out_path = ctx.ensure_dir("firmware") / "config.json"
    out_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
