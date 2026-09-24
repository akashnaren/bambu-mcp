# Agent notes — bambu-mcp

A real printer when `BAMBU_MOCK` is unset. Motion tools can wreck a print.

## Before any print

1. Read [README.md](./README.md). The only printable name is `{part}-{variant}-{rev}.gcode.3mf`.
2. Safe mode is on unless the operator set `BAMBU_SAFE_MODE=0`. Call `status` and read `safeMode`. While it is true, only call `status`, `temps`, `ams`, and `list_files`.
3. If the printer is `RUNNING`, do not start another job.
4. Mesh files go through `slice_hook` after safe mode is off. Never pass a `.stl` to `print`.
5. Refuse `wip-*` names and anything under `scratch/`.
6. Ask the operator. Only then call `print`, `pause`, `resume`, or `stop` with `confirm: true`. `BAMBU_SAFE_MODE=0` is not that yes.
7. Do not set `confirm` yourself. Do not flip `BAMBU_SAFE_MODE`. Do not retry a gated tool in a loop.

If a write says "blocked by safe mode", stop. The operator sets `BAMBU_SAFE_MODE=0`. If it says "confirm-gated", ask the human. If it says "Refuse start-print", fix the filename.

## Secrets

`BAMBU_IP`, `BAMBU_ACCESS_CODE`, `BAMBU_SERIAL`, `BAMBU_MODEL` stay in the environment. Never echo the access code. P2S hardware uses `BAMBU_MODEL=P1S`.

## Code

`config.ts` → `client.ts` (MQTT :8883, FTPS :990) → `tools.ts` → `gates.ts` (safe mode, then confirm).

## Tests

`npm test` must pass with no printer. Extend `MockPrinter` instead of opening the network.
