# bambu-mcp

Private **LAN** MCP for a **Bambu Lab P2S** (P2S hardware / **P1S MQTT dialect**) and the Imagine Engineer design→print contract.

The server wraps community [`bambu-js`](https://www.npmjs.com/package/bambu-js) — MQTT over TLS `:8883` plus implicit FTPS `:990`. Same local API family Home Assistant, OrcaSlicer, and other LAN bambu-mcp servers use. No cloud account. No invented protocol.

**Print / pause / resume / stop are confirm-gated.** An agent must ask you, then retry with `confirm: true`. Secrets live in the environment only.

## Printer setup (P2S)

P2S (and H2-series) need **both** LAN Only and Developer Mode for third-party MQTT **writes**. Telemetry can work with LAN Only alone; start-print will be silently dropped without Developer Mode. Official steps: [LAN Only](https://wiki.bambulab.com/en/knowledge-sharing/enable-lan-mode) and [Developer Mode](https://wiki.bambulab.com/en/knowledge-sharing/enable-developer-mode).

1. On the printer screen: **Settings (nut) → LAN Only**.
2. Enable **LAN Only**. Note **IP**, **Access Code**, and **Serial**.
3. Enable **Developer Mode**. Read the risk notice, confirm, wait until the toggle is ON.
4. Optional: enable LAN liveview if you want the chamber camera in Bambu Studio.
5. Keep the workstation on the same LAN. This MCP does not use Bambu cloud.

`bambu-js` ships typed schemas for `P1S` / `H2D` only. **P2S speaks the P1S-family dialect** — set `BAMBU_MODEL=P1S` even when the hardware is a P2S.

## Environment

Copy `.env.example` to `.env` (gitignored) or export the variables. Never put secrets in tool arguments, chat, or committed JSON.

| Variable | Required | Meaning |
|---|---|---|
| `BAMBU_IP` | yes | Printer LAN IPv4 |
| `BAMBU_ACCESS_CODE` | yes | 8-digit LAN access code |
| `BAMBU_SERIAL` | yes | Device serial |
| `BAMBU_MODEL` | no (default `P1S`) | `P1S` (use this for P2S) or `H2D` |
| `SLICER_BIN` | for slice-hook | OrcaSlicer / Bambu Studio CLI |
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
        "BAMBU_MODEL": "P1S"
      }
    }
  }
}
```

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
        "BAMBU_MODEL": "P1S"
      }
    }
  }
}
```

After saving, reload MCP. Tools should appear as `status`, `temps`, `ams`, `list_files`, `upload`, `print`, `pause`, `resume`, `stop`, `slice_hook`.

## Tools

| Tool | Kind | Notes |
|---|---|---|
| `status` | read | `gcode_state`, %, remaining min, layer, job |
| `temps` | read | nozzle / bed / chamber °C |
| `ams` | read | AMS slots, colors, active tray |
| `list_files` | read | FTPS cache listing |
| `upload` | write | FTPS put of a contract `.gcode.3mf` (no print) |
| `print` | gated | upload (if local) + community `project_file`; **`confirm: true` required** |
| `pause` / `resume` / `stop` | gated | MQTT print control; **`confirm: true` required** |
| `slice_hook` | local | STL / mesh 3MF → `{part}-{variant}-{rev}.gcode.3mf` |

### Confirm-gated print safety

`print`, `pause`, `resume`, and `stop` reject unless `confirm` is the boolean `true`. Agents must ask the operator first and must not invent confirmation. Read tools never need it.

### Imagine start-print rules

`print` (and `upload`) accept only `{part}-{variant}-{rev}.gcode.3mf`. They refuse:

- bare `.stl`
- mesh-only `.3mf` (not sliced)
- filenames starting with `wip-`
- any path with a `scratch/` segment

Optional sibling `{part}-{variant}-{rev}.print.json` supplies plate / AMS / calibration defaults. See [DESIGN.md](./DESIGN.md) and `examples/clip-v1-r1.print.json`.

Typical agent flow:

```
mesh / STL
  → slice_hook(part, variant, rev, settings=…)  →  clip-v1-r1.gcode.3mf
  → (operator confirms)
  → print(file=clip-v1-r1.gcode.3mf, confirm=true)
  → poll status / temps / ams
```

## Tests

`npm test` uses an in-memory mock printer and never opens MQTT/FTPS. Live hardware is not required for CI.

```bash
BAMBU_MOCK=1 node dist/index.js   # stdio MCP against the mock
```

## Caveats

- **Dialect:** P2S → `BAMBU_MODEL=P1S`. Do not expect a `P2S` schema in bambu-js.
- **Developer Mode:** required for pause/print/stop. `status` succeeding does not prove writes will land.
- **Start-print payload:** community LAN `project_file` form (FTPS URL + `Metadata/plate_N.gcode`). Confirm a first print attended.
- **LAN only.** Access code is also the MQTT/FTPS password (`bblp`). Keep it out of git.
- Unofficial community tooling. You are responsible for the machine, filament, and fire safety.

## License

MIT
