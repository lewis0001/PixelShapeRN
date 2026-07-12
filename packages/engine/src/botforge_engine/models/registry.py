"""Pydantic models mirroring the frozen module-registry contract (PLAN §5.1).

One YAML file per electronic module lives in ``registry/modules/<id>.yaml``;
fastener definitions live in ``registry/fasteners.yaml``.
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

KEBAB_CASE = r"^[a-z0-9]+(-[a-z0-9]+)*$"


class ModuleCategory(str, Enum):
    """Module category enum (PLAN §5.1)."""

    core = "core"
    power = "power"
    actuator = "actuator"
    sensor = "sensor"
    output = "output"
    input = "input"
    passive = "passive"


class PinType(str, Enum):
    """Electrical pin type.

    ``motor_out`` and ``switch`` are logged extensions to the §5.1 enum:
    H-bridge outputs / motor terminals and mechanical switch (power-rail
    switch) terminals, as referenced by the §5.2 rover manifest.
    """

    gpio = "gpio"
    pwm = "pwm"
    adc = "adc"
    i2c_sda = "i2c_sda"
    i2c_scl = "i2c_scl"
    v5 = "5v"
    v3v3 = "3v3"
    gnd = "gnd"
    vbat = "vbat"
    motor_out = "motor_out"
    switch = "switch"


class Pin(BaseModel):
    """A single electrical pin on a module."""

    name: str
    type: PinType
    required: bool


class CurrentMa(BaseModel):
    """Typical / max current draw in milliamps (feeds the power-budget check)."""

    typ: int
    max: int


class Electrical(BaseModel):
    """Electrical block of a module definition."""

    vcc: str
    logic_v: float
    current_ma: CurrentMa
    pins: list[Pin]


class Firmware(BaseModel):
    """Firmware driver block. Optional on the module: passive modules have none."""

    driver: str
    params: dict[str, Any] = Field(default_factory=dict)


class Mount(BaseModel):
    """Named cadlib mounting pattern plus screw spec."""

    pattern: str
    screws: str


class Mech(BaseModel):
    """Mechanical block: bounding dims, mass and mount."""

    dims_mm: list[float] = Field(min_length=3, max_length=3)
    mass_g: float
    mount: Mount


class Wiring(BaseModel):
    """Wiring block — feeds WireViz."""

    connector: str
    pinout: list[Any] | None = None
    wire_colors: dict[str, str] = Field(default_factory=dict)


class Sourcing(BaseModel):
    """A single vendor sourcing entry."""

    vendor: str
    label: str
    url: str
    price_usd: float
    affiliate_key: str


class Troubleshooting(BaseModel):
    """A symptom/fix pair compiled into robot docs."""

    symptom: str
    fix: str


class Docs(BaseModel):
    """Docs block of a module definition."""

    blurb: str
    datasheet_url: str = ""
    troubleshooting: list[Troubleshooting] = Field(default_factory=list)


class Module(BaseModel):
    """A module registry entry — ``registry/modules/<id>.yaml``."""

    id: str = Field(pattern=KEBAB_CASE)
    name: str
    category: ModuleCategory
    electrical: Electrical
    firmware: Firmware | None = None
    mech: Mech
    wiring: Wiring
    sourcing: list[Sourcing] = Field(default_factory=list)
    docs: Docs
    sim: dict[str, Any] | None = None


class Fastener(BaseModel):
    """A fastener registry entry from ``registry/fasteners.yaml``."""

    id: str
    name: str
    spec: str
    sourcing: list[Sourcing] = Field(default_factory=list)


class FastenersFile(BaseModel):
    """Shape of ``registry/fasteners.yaml`` (top-level key ``fasteners``)."""

    fasteners: list[Fastener]


class Registry(BaseModel):
    """The whole loaded registry: modules and fasteners keyed by id."""

    modules: dict[str, Module]
    fasteners: dict[str, Fastener]
