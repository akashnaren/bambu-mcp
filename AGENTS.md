# Agent notes — bambu-mcp

You are talking to a **real 3D printer** when `BAMBU_MOCK` is unset. Treat motion tools as dangerous.

## Before any print

1. Read [DESIGN.md](./DESIGN.md). The only printable name is `{part}-{variant}-{rev}.gcode.3mf`.
2. Safe mode is **on** unless the operator set `BAMBU_SAFE_MODE=0`. Call `status` or `capabilities` and read `safeMode`. While it is true, only call `status`, `temps`, `ams`, `list_files`, and `capabilities`. Do not call `upload`, `print`, `pause`, `resume`, `stop`, or `slice_hook`. Tell the operator the write was refused and that they must set `BAMBU_SAFE_MODE=0` themselves.
3. Call `status`, `temps`, and `ams`. If the printer is already `RUNNING`, do not start another job.
4. If the user has an STL or mesh 3MF, call `slice_hook` first (only after safe mode is off). **Never** pass a `.stl` to `print`.
5. Refuse `wip-*` names and anything under `scratch/` — even if the user asks to “just try it”.
6. Ask the operator to confirm. Only then call `print` / `pause` / `resume` / `stop` with `confirm: true`. `BAMBU_SAFE_MODE=0` is not that confirmation.
7. Do not set `confirm: true` yourself. Do not retry a gated tool in a loop hoping it works. Do not flip `BAMBU_SAFE_MODE`.

## Secrets

- Credentials are env-only: `BAMBU_IP`, `BAMBU_ACCESS_CODE`, `BAMBU_SERIAL`, `BAMBU_MODEL`.
- Never echo the access code. Never put it in a commit, issue, or tool argument.
- P2S hardware uses `BAMBU_MODEL=P1S` (P1S MQTT dialect).

## Tools you have

| Tool | Safe mode on | Confirm? | Use |
|---|---|---|---|
| `status` `temps` `ams` `list_files` `capabilities` | allowed | no | Observe. `status` and `capabilities` include `safeMode`. |
| `slice_hook` | refused | no | Mesh → contract `.gcode.3mf` after `BAMBU_SAFE_MODE=0` |
| `upload` | refused | no | FTPS only; still requires the contract name |
| `print` `pause` `resume` `stop` | refused | **yes** | Machine motion. Confirm stays required after safe mode is off. |

## Typical sequence

```
status / capabilities → if safeMode, stop and ask the operator to set BAMBU_SAFE_MODE=0
slice_hook → show the operator the artifact name + optional .print.json
           → wait for explicit go-ahead
           → print(file, confirm=true)
           → poll status
```

If a write errors with “blocked by safe mode”, stop. The operator sets `BAMBU_SAFE_MODE=0`; you do not. If `print` errors with “confirm-gated”, ask the human. If it errors with “Refuse start-print”, fix the filename — do not bypass.

## Tests

`npm test` must stay green without a printer. Prefer extending `MockPrinter` over hitting the network.
