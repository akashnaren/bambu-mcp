# bambu-mcp

LAN MCP for one Bambu Lab printer. One process talks to one printer. It uses community [`bambu-js`](https://www.npmjs.com/package/bambu-js): MQTT over TLS `:8883` and implicit FTPS `:990`. No cloud account and no private protocol.

`BAMBU_MODEL` is the hardware name. bambu-js 3.0.1 only has `P1S` and `H2D` dialects, so the server maps hardware onto those and keeps both. P2S has no active chamber heater.

| `BAMBU_MODEL` | Hardware | bambu-js dialect |
|---|---|---|
| `P1P`, `P1S`, `P2S` | as set | `P1S` |
| `X1`, `X1C`, `X1E` | as set | `P1S` |
| `A1` | `A1` | `P1S` |
| `A1MINI`, `A1_MINI`, `A1-MINI` | `A1MINI` | `P1S` |
| `H2D`, `H2S` | as set | `H2D` |

Anything else fails at startup and lists those names. The P2S on this LAN stays at `BAMBU_IP=10.0.0.183`.

## Safe mode

`BAMBU_SAFE_MODE` defaults to **on** when unset. The host keeps about 10 tools in the live catalog, so while safe mode is on the server registers only the tools that are allowed to run:

| Tool | What it does |
|---|---|
| `status` `temps` `ams` `list_files` `get_version` | reads |
| `set_light` | chamber light, or `work_light` when the printer has one |
| `set_camera` | recording and timelapse on or off. No live stream and no snapshot |
| `set_sound` | `sound_enable` only |

`status` includes `safeMode: true`. When the report already has them, it also includes `chamberLight`, `wifiSignal`, `printError`, `errorCode`, an AMS humidity summary, `ipcam` record/timelapse flags, and a `lights` array when more than one light node is present.

`set_light` takes `{ on: true }` or `{ on: false }`. Optional `node` is `chamber_light` (the default) or `work_light`. A missing node on this hardware returns `{ supported: false }`. These low-risk tools work with safe mode on. They do not need `confirm`. They do not unlock `print`, `pause`, `resume`, or `stop`.

`upload`, `slice_hook`, `print`, `pause`, `resume`, and `stop` are left out of the safe-mode catalog. They come back when you set `BAMBU_SAFE_MODE=0` and reload the server. The gate still names that variable and says motion tools need `confirm: true` plus an explicit human ask. `confirm: true` does not bypass safe mode.

Set `BAMBU_SAFE_MODE=0` yourself, in the shell or the MCP `env` block. An agent must not change it.

After that, `print`, `pause`, `resume`, and `stop` still require `confirm: true`. Ask first. The server never sets `confirm`.

Printer **Developer Mode** is a different lock. It lets the machine accept third-party writes. Uploads and motion stay locked until `BAMBU_SAFE_MODE=0`. Light, camera settings, and sound do not.

## Printer

P2S needs both LAN Only and Developer Mode before a third-party client can print. Telemetry can work with LAN Only alone. Steps: [LAN Only](https://wiki.bambulab.com/en/knowledge-sharing/enable-lan-mode), [Developer Mode](https://wiki.bambulab.com/en/knowledge-sharing/enable-developer-mode).

1. Printer screen: **Settings → LAN Only**. Note IP, access code, and serial.
2. Turn on **Developer Mode** and wait until the toggle stays on.
3. Keep this computer on the same LAN.
4. Leave `BAMBU_SAFE_MODE` unset (or `1`) until you want uploads or motion. Then set it to `0` and reload MCP.

## Environment

Copy `.env.example` to `.env` (gitignored) or export the variables. Never put the access code in tool arguments, chat, or git.

| Variable | Required | Meaning |
|---|---|---|
| `BAMBU_IP` | yes | Printer LAN address |
| `BAMBU_ACCESS_CODE` | yes | LAN access code (also the MQTT/FTPS password) |
| `BAMBU_SERIAL` | yes | Device serial |
| `BAMBU_MODEL` | no | Hardware name. Default `P1S`. See the dialect table above. Unknown names fail closed. |
| `BAMBU_SAFE_MODE` | no | Unset or `1` = reads, light, camera settings, and sound. `0` also registers uploads and motion. Motion still needs `confirm: true`. |
| `SLICER_BIN` | for slice | OrcaSlicer or Bambu Studio CLI |
| `BAMBU_MOCK` | no | `1` = in-memory printer, no network |

```bash
npm install
npm test
npm run build
```

Cursor MCP (`~/.cursor/mcp.json`). `BAMBU_SAFE_MODE` is `1` so uploads and motion stay unregistered. Light, camera settings, and sound still work. Change it to `"0"` only when you mean to unlock writes. The sample below is a template. This P2S stays on `10.0.0.183`.

```json
{
  "mcpServers": {
    "bambu": {
      "command": "node",
      "args": ["/ABS/PATH/TO/bambu-mcp/dist/index.js"],
      "env": {
        "BAMBU_IP": "10.0.0.183",
        "BAMBU_ACCESS_CODE": "xxxxxxxx",
        "BAMBU_SERIAL": "01P00A000000000",
        "BAMBU_MODEL": "P2S",
        "BAMBU_SAFE_MODE": "1"
      }
    }
  }
}
```

## Tools

| Tool | Safe mode on | Confirm |
|---|---|---|
| `status` `temps` `ams` `list_files` `get_version` | allowed | no |
| `set_light` `set_camera` `set_sound` | allowed | no |
| `upload` `slice_hook` | not registered; gate still refuses | no |
| `print` `pause` `resume` `stop` | not registered; gate still refuses | **yes**, after you agree |

There is no raw gcode tool, no nozzle or bed temperature setter, no camera stream, and no control for more than one printer.

`print` and `upload` accept only `{part}-{variant}-{rev}.gcode.3mf`. They refuse a bare `.stl`, a mesh-only `.3mf`, a `wip-*` name, and any `scratch/` path. A sibling `{part}-{variant}-{rev}.print.json` can set plate, AMS, and calibration. Tool arguments override it.

## Harness

`harness/SKILL.md` is the shared print checklist. It ships in the repo, so a friend clones the same tree. It is not tied to one assistant.

1. Clone this repo, `npm install`, `npm test`, `npm run build`.
2. Register the MCP with `BAMBU_SAFE_MODE` at `1` (the block above). They set it to `0` only when they mean to allow writes.
3. Point the assistant at `harness/SKILL.md`. Cursor follows `AGENTS.md`, which links that file. Claude and other clients can load the same file as a project skill (`name` and `description` are in the frontmatter).

The skill will not start motion until safe mode is off and the operator agrees. Printer notes that are not the filename rule live in `harness/references/printer.md`. The filename rule is [DESIGN.md](DESIGN.md).

## Code

`config.ts` reads env. `models.ts` maps `BAMBU_MODEL` to a bambu-js dialect and a capability table. `client.ts` keeps one MQTT session and one FTPS login, and reuses the latest report for `status`, `temps`, and `ams`. `get_version` sends MQTT `info.get_version` and returns module hw/sw. `set_light` sends MQTT `system.ledctrl` (`chamber_light` or `work_light`), including `led_on_time`, `led_off_time`, `loop_times`, and `interval_time`. `set_camera` sends `camera.ipcam_record_set` and `camera.ipcam_timelapse` with `control` `enable` or `disable`. `set_sound` sends `print.print_option` with `sound_enable` only. `reads.ts` and `writes.ts` are the tools. `gates.ts` classifies light, camera, and sound as `safe_write_low_risk` (allowed in safe mode, no confirm). They are not in the write set that safe mode blocks, and not in the motion set (`print`, `pause`, `resume`, `stop`). While safe mode is on, `createTools` omits the refused tools so the ~10-name host catalog can list the new ones. `server.ts` registers them. `index.ts` starts stdio and does not connect until a tool asks.

`npm test` uses `MockPrinter` and does not open the network.
