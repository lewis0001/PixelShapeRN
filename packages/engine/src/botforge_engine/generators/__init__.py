"""BOTFORGE artifact generators.

Each sibling module exposes ``name`` and ``run(ctx: BuildContext) -> None``.
The ordered generator registry lives in :mod:`botforge_engine.generators.base`
as ``GENERATORS`` (do not import ``base`` from here — it imports the siblings).
"""
