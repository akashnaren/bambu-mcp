# Agent notes — bambu-mcp

You are talking to a **real 3D printer** when `BAMBU_MOCK` is unset. Treat motion tools as dangerous.

## Before any print

1. Read [DESIGN.md](./DESIGN.md). The only printable name is `{part}-{variant}-{rev}.gcode.3mf`.
2. Call `status`, `temps`, and `ams`. If the printer is already `RUNNING`, do not start another job.
3. If the user has an STL or mesh 3MF, call `slice_hook` first. **Never** pass a `.stl` to `print`.
4. Refuse `wip-*` names and anything under `scratch/` — even if the user asks to “just try it”.
5. Ask the operator to confirm. Only then call `print` / `pause` / `resume` / `stop` with `confirm: true`.
6. Do not set `confirm: true` yourself. Do not retry a gated tool in a loop hoping it works.

## Secrets

- Credentials are env-only: `BAMBU_IP`, `BAMBU_ACCESS_CODE`, `BAMBU_SERIAL`, `BAMBU_MODEL`.
- Never echo the access code. Never put it in a commit, issue, or tool argument.
- P2S hardware uses `BAMBU_MODEL=P1S` (P1S MQTT dialect).

## Tools you have

| Tool | Confirm? | Use |
|---|---|---|
| `status` `temps` `ams` `list_files` | no | Observe |
| `slice_hook` | no | Mesh → contract `.gcode.3mf` |
| `upload` | no | FTPS only; still requires the contract name |
| `print` `pause` `resume` `stop` | **yes** | Machine motion |

## Typical sequence

```
slice_hook → show the operator the artifact name + optional .print.json
           → wait for explicit go-ahead
           → print(file, confirm=true)
           → poll status
```

If `print` errors with “confirm-gated”, ask the human. If it errors with “Refuse start-print”, fix the filename — do not bypass.

## Tests

`npm test` must stay green without a printer. Prefer extending `MockPrinter` over hitting the network.
