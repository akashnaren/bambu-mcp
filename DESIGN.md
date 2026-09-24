# DESIGN — Imagine Engineer × Bambu P2S LAN MCP

This server is a **local stdio MCP** that talks to one Bambu Lab printer on the LAN. It is not a cloud bridge. It adapts the community MQTT + implicit-FTPS dialect used by [`bambu-js`](https://www.npmjs.com/package/bambu-js), Home Assistant's Bambu integration, and LAN bambu-mcp servers. **Do not invent a new printer protocol.**

## Goals

1. Let an Imagine agent go from mesh → sliced artifact → attended print.
2. Make unsafe actions impossible to “accidentally” call: confirm gates + filename contract.
3. Keep secrets out of git, tool args, and transcripts.

## Imagine artifact contract

Printable job files are **named, versioned, sliced** 3MFs:

```
{part}-{variant}-{rev}.gcode.3mf
```

| Segment | Pattern | Example |
|---|---|---|
| `part` | `[A-Za-z0-9][A-Za-z0-9_]*` | `hose_clamp` |
| `variant` | same | `left`, `v2` |
| `rev` | same | `r3`, `0` |

The suffix **must** be `.gcode.3mf` (Bambu sliced project), not `.3mf` (mesh-only) and not `.stl`.

### Optional sidecar

```
{part}-{variant}-{rev}.print.json
```

Same stem, sitting next to the 3MF. Fields (all optional):

```json
{
  "part": "clip",
  "variant": "v1",
  "rev": "r1",
  "plate": 1,
  "useAms": true,
  "amsMapping": [0],
  "bedType": "textured_pei_plate",
  "timelapse": false,
  "flowCali": true,
  "bedLeveling": true,
  "vibrationCali": true,
  "layerInspect": false
}
```

`print` loads the sidecar when `file` is a local path. Tool arguments override sidecar values. Missing sidecar → plate `1`, AMS on, mapping `[0]`, community calibration defaults.

## Slice-hook

`slice_hook` is the **only** supported path from mesh to a printable artifact.

| Input | Action |
|---|---|
| `.stl` / `.step` / `.stp` / `.obj` | Slice via OrcaSlicer / Bambu Studio CLI (`SLICER_BIN`) |
| mesh-only `.3mf` | Same CLI; presets optional if the project already embeds them |
| `.gcode.3mf` | Not a slice input — already printable |

Bare STL **requires** `--load-settings` presets (semicolon-joined printer + process JSON exported from the slicer). Output filename is forced to `{part}-{variant}-{rev}.gcode.3mf`. The hook **never** uploads or starts a print.

CLI flags match the shared PrusaSlicer-fork interface (`--slice`, `--export-3mf`, `--load-settings`, `--load-filaments`, `--arrange`, `--orient`).

## Start-print refusals

`print` and `upload` call `assertPrintableArtifact` (`src/contract.ts`). They **refuse**:

1. **Bare STL** — not sliced. Use `slice_hook`.
2. **`wip-*` basename** — work-in-progress, not a released rev.
3. **`scratch/` path segment** — sandbox / throwaway directory.
4. **Mesh-only `.3mf`** — no embedded plate gcode.
5. **Any other name** that is not `{part}-{variant}-{rev}.gcode.3mf`.

These checks are string/path rules. They do not need a live printer and are unit-tested.

## Safe mode

`BAMBU_SAFE_MODE` defaults to **on** when unset (`src/safe.ts`, applied in `loadConfig`). This is independent of printer Developer Mode: LAN writes can be enabled on the machine and this server still refuses them.

| Safe mode | Tools |
|---|---|
| on (default) | `status`, `temps`, `ams`, `list_files`, `capabilities` |
| on | `upload`, `print`, `pause`, `resume`, `stop`, `slice_hook` throw. `confirm: true` does not bypass the refusal. |
| off (`BAMBU_SAFE_MODE=0`) | Write tools run, subject to the filename contract and the confirm gate below. |

The refusal tells the operator to set `BAMBU_SAFE_MODE=0` and that write tools still require `confirm: true` plus an explicit human ask. Unrecognized values stay on. The process entrypoint passes `config.safeMode` into the tool layer. `createTools` also defaults the flag to on if a caller omits it.

`status` includes `safeMode`. `capabilities` repeats the flag plus the read, write, and confirm-required lists.

## Confirm gates

`src/confirm.ts` gates `print`, `pause`, `resume`, and `stop` **after** safe mode is off. The boolean `confirm` must be `true`. The server never sets it. Agents:

- Must ask the operator before setting `confirm`.
- Must not infer confirmation from “looks good”, a previous turn, or `BAMBU_SAFE_MODE=0`.
- Must treat a missing/false `confirm` as a hard error, not a prompt to retry silently.

Read tools (`status`, `temps`, `ams`, `list_files`, `capabilities`) are not confirm-gated. `slice_hook` and `upload` are not confirm-gated either; safe mode still blocks them until `BAMBU_SAFE_MODE=0`. `upload` enforces the filename contract so the FTPS cache stays clean.

## Secrets

| Allowed | Forbidden |
|---|---|
| Process env (`BAMBU_IP`, `BAMBU_ACCESS_CODE`, `BAMBU_SERIAL`, `BAMBU_MODEL`) | Tool arguments |
| Local gitignored `.env` | Committed `.env`, README with real codes |
| Cursor MCP `env` block on the operator machine | Logging the access code |

`BAMBU_MODEL=P1S` for P2S hardware. `P2S` is accepted and normalized to `P1S`.

## LAN protocol (community)

Observed / documented by bambu-js, bambu-rs, and HA — not specified by this repo:

| Channel | Port | Auth | Use |
|---|---|---|---|
| MQTT over TLS | `8883` | user `bblp`, password = access code | reports + commands |
| Implicit FTPS | `990` | same | upload / list |

Topics: `device/{serial}/report`, `device/{serial}/request`.

Writes used here (raw JSON, P1-family):

- `{ pushing: { command: "pushall", version: 1, push_target: 1 } }`
- `{ print: { command: "pause" \| "resume" \| "stop" } }`
- `{ print: { command: "project_file", url: "ftp:///{file}", param: "Metadata/plate_N.gcode", … } }`

P2S **Developer Mode** must be on or writes are dropped while reads still succeed.

## Module map

```
src/config.ts     env → Config (no secrets in args)
src/safe.ts       BAMBU_SAFE_MODE parse + write refusal
src/contract.ts   Imagine filename + sidecar
src/confirm.ts    confirm: true gate
src/client.ts     bambu-js PrinterController + FileController
src/mock.ts       in-memory printer for tests / BAMBU_MOCK=1
src/slice.ts      Orca / Bambu Studio CLI
src/tools.ts      MCP tool handlers
src/server.ts     @modelcontextprotocol/sdk registration
src/index.ts      stdio entry
```

`PrinterPort` is injected so tests never open a socket.

## Out of scope (this scaffold)

- Multi-printer fleets
- Bambu cloud / account tokens
- Camera snapshot (P2S JPEG protocol differs from P1S)
- Raw `gcode_line` escape hatch (too easy to bypass the contract)
- Homing / temp-set / light — add later behind the same confirm + env rules if needed
