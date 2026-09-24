# bambu-mcp

Private **LAN** MCP for a **Bambu Lab P2S** (P2S hardware / **P1S MQTT dialect**) and the Imagine Engineer design→print contract.

The server wraps community [`bambu-js`](https://www.npmjs.com/package/bambu-js) — MQTT over TLS `:8883` plus implicit FTPS `:990`. Same local API family Home Assistant, OrcaSlicer, and other LAN bambu-mcp servers use. No cloud account. No invented protocol.

**Safe mode is on by default.** With `BAMBU_SAFE_MODE` unset, only read tools run. **Print / pause / resume / stop stay confirm-gated** after you unlock writes: an agent must ask you, then retry with `confirm: true`. Secrets live in the environment only.

## Safe mode (default on)

`BAMBU_SAFE_MODE` defaults to **on** (`1` / true) when it is unset. That is the approval-first Developer Mode default for Grok Bot and Cursor: the printer can be observed, and this server will not upload, slice, or command a print until you opt in.

| `BAMBU_SAFE_MODE` | Behavior |
|---|---|
| unset, blank, `1`, `true`, `on`, `yes`, or any other value | **Safe mode on.** Only `status`, `temps`, `ams`, `list_files`, and `capabilities` run. |
| `0`, `false`, `off`, or `no` | Write tools unlocked. Motion tools are still confirm-gated. |

While safe mode is on, `upload`, `print`, `pause`, `resume`, `stop`, and `slice_hook` refuse. The error tells the operator to set `BAMBU_SAFE_MODE=0` and says that write tools still require `confirm: true` plus an explicit human ask. Passing `confirm: true` does not bypass safe mode.

**Unlock writes only on purpose.** Set `BAMBU_SAFE_MODE=0` in the shell or in the MCP `env` block, then reload the server. An agent must not change this variable. A chat message is not that setting.

After `BAMBU_SAFE_MODE=0`, `print`, `pause`, `resume`, and `stop` still require `confirm: true` following an explicit human ask. The agent must not invent `confirm`, and this server never auto-confirms.

`status` includes a `safeMode` boolean. `capabilities` lists read tools, write tools, and which motion tools still need confirmation, so an agent can see the mode without guessing.

## Printer setup (P2S)

P2S (and H2-series) need **both** LAN Only and Developer Mode for third-party MQTT **writes**. Telemetry can work with LAN Only alone; start-print will be silently dropped without Developer Mode. Official steps: [LAN Only](https://wiki.bambulab.com/en/knowledge-sharing/enable-lan-mode) and [Developer Mode](https://wiki.bambulab.com/en/knowledge-sharing/enable-developer-mode).

Printer Developer Mode and `BAMBU_SAFE_MODE` are separate locks. Turning Developer Mode on does not turn safe mode off.

1. On the printer screen: **Settings (nut) → LAN Only**.
2. Enable **LAN Only**. Note **IP**, **Access Code**, and **Serial**.
3. Enable **Developer Mode**. Read the risk notice, confirm, wait until the toggle is ON.
4. Optional: enable LAN liveview if you want the chamber camera in Bambu Studio.
5. Keep the workstation on the same LAN. This MCP does not use Bambu cloud.
6. Leave `BAMBU_SAFE_MODE` unset (or `1`) until you intentionally want upload, slice, or motion tools. Then set `BAMBU_SAFE_MODE=0` and reload MCP.

`bambu-js` ships typed schemas for `P1S` / `H2D` only. **P2S hardware uses `BAMBU_MODEL=P1S`** (P1S MQTT dialect). A value of `P2S` is accepted and normalized to `P1S`.

## Environment

Copy `.env.example` to `.env` (gitignored) or export the variables. Never put secrets in tool arguments, chat, or committed JSON.

| Variable | Required | Meaning |
|---|---|---|
| `BAMBU_IP` | yes | Printer LAN IPv4 |
| `BAMBU_ACCESS_CODE` | yes | 8-digit LAN access code |
| `BAMBU_SERIAL` | yes | Device serial |
| `BAMBU_MODEL` | no (default `P1S`) | `P1S` (use this for P2S hardware) or `H2D` |
| `BAMBU_SAFE_MODE` | no (default **on**) | Unset or `1` = read-only. `0` unlocks writes. Motion tools still need `confirm: true`. |
| `SLICER_BIN` | for slice-hook | OrcaSlicer / Bambu Studio CLI. `slice_hook` also requires `BAMBU_SAFE_MODE=0`. |
| `BAMBU_MOCK` | no | `1` = in-memory printer, no network |

## Install

```bash
git clone https://github.com/akashnaren/bambu-mcp.git
cd bambu-mcp
npm install
npm test          # mocked — no live printer
npm run build
```

## Register with Cursor

Add a server in **Cursor Settings → MCP** or in `~/.cursor/mcp.json` / project `.cursor/mcp.json`. Point `args` at your clone. Put real values in the `env` block (or a secrets manager) — do not commit them.

```json
{
  "mcpServers": {
    "bambu": {
      "command": "node",
      "args": ["/ABS/PATH/TO/bambu-mcp/dist/index.js"],
      "env": {
        "BAMBU_IP": "192.168.1.50",
        "BAMBU_ACCESS_CODE": "xxxxxxxx",
        "BAMBU_SERIAL": "01P00A000000000",
        "BAMBU_MODEL": "P1S",
        "BAMBU_SAFE_MODE": "1"
      }
    }
  }
}
```

`BAMBU_MODEL` stays `P1S` on a P2S. `BAMBU_SAFE_MODE` is `1` here so the server boots read-only. To unlock writes, change that value to `"0"` on purpose and reload MCP. Motion tools still wait for `confirm: true` after you agree.

Dev without a build step:

```json
{
  "mcpServers": {
    "bambu": {
      "command": "npx",
      "args": ["tsx", "/ABS/PATH/TO/bambu-mcp/src/index.ts"],
      "env": {
        "BAMBU_IP": "192.168.1.50",
        "BAMBU_ACCESS_CODE": "xxxxxxxx",
        "BAMBU_SERIAL": "01P00A000000000",
        "BAMBU_MODEL": "P1S",
        "BAMBU_SAFE_MODE": "1"
      }
    }
  }
}
```

After saving, reload MCP. Tools should appear as `status`, `temps`, `ams`, `list_files`, `capabilities`, `upload`, `print`, `pause`, `resume`, `stop`, `slice_hook`. With safe mode on, the write tools are registered and refuse until `BAMBU_SAFE_MODE=0`.

## Tools

| Tool | Kind | Safe mode on | Notes |
|---|---|---|---|
| `status` | read | allowed | `gcode_state`, %, remaining min, layer, job, plus `safeMode` |
| `temps` | read | allowed | nozzle / bed / chamber °C |
| `ams` | read | allowed | AMS slots, colors, active tray |
| `list_files` | read | allowed | FTPS cache listing |
| `capabilities` | read | allowed | `safeMode`, read/write lists, confirm-required tools |
| `upload` | write | refused | FTPS put of a contract `.gcode.3mf` (no print) |
| `print` | gated write | refused | upload (if local) + community `project_file`; **`confirm: true` required** once unlocked |
| `pause` / `resume` / `stop` | gated write | refused | MQTT print control; **`confirm: true` required** once unlocked |
| `slice_hook` | local write | refused | STL / mesh 3MF → `{part}-{variant}-{rev}.gcode.3mf` |

### Confirm-gated print safety

Safe mode and the confirm gate stack. Safe mode (default on) blocks every write. After you set `BAMBU_SAFE_MODE=0`, `print`, `pause`, `resume`, and `stop` still reject unless `confirm` is the boolean `true`. Agents must ask the operator first and must not invent confirmation. Read tools never need it. This server never sets `confirm` for you.

### Imagine start-print rules

`print` (and `upload`) accept only `{part}-{variant}-{rev}.gcode.3mf`. They refuse:

- bare `.stl`
- mesh-only `.3mf` (not sliced)
- filenames starting with `wip-`
- any path with a `scratch/` segment

Optional sibling `{part}-{variant}-{rev}.print.json` supplies plate / AMS / calibration defaults. See [DESIGN.md](./DESIGN.md) and `examples/clip-v1-r1.print.json`.

Typical agent flow, after the operator has set `BAMBU_SAFE_MODE=0`:

```
status / capabilities          →  safeMode is false
mesh / STL
  → slice_hook(part, variant, rev, settings=…)  →  clip-v1-r1.gcode.3mf
  → (operator confirms out loud)
  → print(file=clip-v1-r1.gcode.3mf, confirm=true)
  → poll status / temps / ams
```

With the default (`BAMBU_SAFE_MODE` unset), stop after `status`, `temps`, `ams`, `list_files`, and `capabilities`.

## Tests

`npm test` uses an in-memory mock printer and never opens MQTT/FTPS. Live hardware is not required for CI.

```bash
BAMBU_MOCK=1 node dist/index.js   # stdio MCP against the mock
```

## Caveats

- **Dialect:** P2S hardware → `BAMBU_MODEL=P1S`. Do not expect a `P2S` schema in bambu-js.
- **Safe mode:** default on. Developer Mode on the printer does not clear it. Set `BAMBU_SAFE_MODE=0` yourself, then still confirm each motion command.
- **Developer Mode:** required on the printer for pause/print/stop to be accepted. `status` succeeding does not prove writes will land.
- **Start-print payload:** community LAN `project_file` form (FTPS URL + `Metadata/plate_N.gcode`). Confirm a first print attended.
- **LAN only.** Access code is also the MQTT/FTPS password (`bblp`). Keep it out of git.
- Unofficial community tooling. You are responsible for the machine, filament, and fire safety.

## License

MIT
