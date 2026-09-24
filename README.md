# bambu-mcp

LAN MCP for one Bambu Lab printer. It uses community [`bambu-js`](https://www.npmjs.com/package/bambu-js): MQTT over TLS `:8883` and implicit FTPS `:990`. No cloud account and no private protocol.

P2S hardware uses `BAMBU_MODEL=P1S` (P1S MQTT dialect). `P2S` in the env is accepted and stored as `P1S`.

## Safe mode

`BAMBU_SAFE_MODE` defaults to **on** when unset. Only `status`, `temps`, `ams`, and `list_files` run. `status` includes `safeMode: true`.

`upload`, `slice_hook`, `print`, `pause`, `resume`, and `stop` refuse until you set `BAMBU_SAFE_MODE=0` and reload the server. The error names that variable and says write tools still need `confirm: true` plus an explicit human ask. `confirm: true` does not bypass safe mode.

Set `BAMBU_SAFE_MODE=0` yourself, in the shell or the MCP `env` block. An agent must not change it.

After that, `print`, `pause`, `resume`, and `stop` still require `confirm: true`. Ask first. The server never sets `confirm`.

Printer **Developer Mode** is a different lock. It lets the machine accept third-party writes. This server stays read-only until `BAMBU_SAFE_MODE=0`.

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
| `BAMBU_MODEL` | no | `P1S` for P2S hardware (default), or `H2D` |
| `BAMBU_SAFE_MODE` | no | Unset or `1` = read-only. `0` unlocks writes. Motion still needs `confirm: true`. |
| `SLICER_BIN` | for slice | OrcaSlicer or Bambu Studio CLI |
| `BAMBU_MOCK` | no | `1` = in-memory printer, no network |

```bash
npm install
npm test
npm run build
```

Cursor MCP (`~/.cursor/mcp.json`). `BAMBU_SAFE_MODE` is `1` so the server boots read-only. Change it to `"0"` only when you mean to unlock writes.

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

## Tools

| Tool | Safe mode on | Confirm |
|---|---|---|
| `status` `temps` `ams` `list_files` | allowed | no |
| `upload` `slice_hook` | refused | no |
| `print` `pause` `resume` `stop` | refused | **yes**, after you agree |

`print` and `upload` accept only `{part}-{variant}-{rev}.gcode.3mf`. They refuse a bare `.stl`, a mesh-only `.3mf`, a `wip-*` name, and any `scratch/` path. A sibling `{part}-{variant}-{rev}.print.json` can set plate, AMS, and calibration. Tool arguments override it.

## Harness

`harness/SKILL.md` is the shared print checklist. It ships in the repo, so a friend clones the same tree. It is not tied to one assistant.

1. Clone this repo, `npm install`, `npm test`, `npm run build`.
2. Register the MCP with `BAMBU_SAFE_MODE` at `1` (the block above). They set it to `0` only when they mean to allow writes.
3. Point the assistant at `harness/SKILL.md`. Cursor follows `AGENTS.md`, which links that file. Claude and other clients can load the same file as a project skill (`name` and `description` are in the frontmatter).

The skill will not start motion until safe mode is off and the operator agrees. Printer notes that are not the filename rule live in `harness/references/printer.md`. The filename rule is [DESIGN.md](DESIGN.md).

## Code

`config.ts` reads env. `client.ts` keeps one MQTT session and one FTPS login, and reuses the latest report for `status`, `temps`, and `ams`. `reads.ts` and `writes.ts` are the tools. `gates.ts` is safe mode, then confirm. `server.ts` registers them. `index.ts` starts stdio and does not connect until a tool asks.

`npm test` uses `MockPrinter` and does not open the network.
