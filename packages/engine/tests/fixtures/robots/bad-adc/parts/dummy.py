"""Fixture part script. Real part scripts expose ``build(params) -> cq.Workplane``."""


def build(params):
    """Return a stand-in object; the CAD generator is not under test here."""
    return {"kind": "dummy", "params": params}
