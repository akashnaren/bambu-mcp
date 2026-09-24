# Print name

The only file `upload` and `print` will accept:

```
{part}-{variant}-{rev}.gcode.3mf
```

| Segment | Pattern | Example |
|---|---|---|
| `part` | `[A-Za-z0-9][A-Za-z0-9_]*` | `hose_clamp` |
| `variant` | same | `left` |
| `rev` | same | `r3` |

The suffix is `.gcode.3mf` (a sliced plate), not `.3mf` and not `.stl`.

Refused even when `confirm` is true:

- a bare `.stl`
- a mesh-only `.3mf`
- a basename starting with `wip-`
- any path with a `scratch/` segment

Optional sibling, same stem: `{part}-{variant}-{rev}.print.json`. Fields are optional. Tool arguments override the file.

```json
{
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

Missing sidecar means plate `1`, AMS on, mapping `[0]`.

Agents follow [harness/SKILL.md](harness/SKILL.md). The server enforces this name in `src/contract.ts`.
