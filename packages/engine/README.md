# botforge-engine

The BOTFORGE engine compiles robot manifests into every downstream artifact
(firmware configs, docs, simulation assets, and more). Phase 0 ships the CLI
skeleton only — `validate`, `build`, and `clean` are stubs that exit with
code 2 until Phase 1.

## Getting started

```sh
uv sync
uv run botforge --help
uv run pytest
```
