# Printer notes

Read this when the job depends on the machine, not for every chat.

## One printer

This process owns one printer. There is no fleet tool and no second IP. The P2S on this LAN stays at `BAMBU_IP=10.0.0.183`.

## Models and dialects

`BAMBU_MODEL` is the hardware name. bambu-js 3.0.1 can open only a `P1S` or `H2D` client, so the server maps onto those dialects and remembers the hardware name separately. Startup prints both. An unknown name fails and lists the accepted names.

| `BAMBU_MODEL` | Dialect |
|---|---|
| `P1P`, `P1S`, `P2S` | `P1S` |
| `X1`, `X1C`, `X1E` | `P1S` |
| `A1` | `P1S` |
| `A1MINI`, `A1_MINI`, `A1-MINI` | `P1S` |
| `H2D`, `H2S` | `H2D` |

Missing hardware returns `{ supported: false }` from the tool. It does not throw. Open-bed models (`A1`, `A1MINI`, `P1P`) have no chamber light and no chamber temperature sensor. `P1P` has no built-in camera. X1 and H2 can have a `work_light`. P2S does not.

## P2S speaks P1S

`BAMBU_MODEL=P2S` is stored as hardware `P2S` and dialect `P1S`. There is no separate P2S MQTT schema in bambu-js. P2S has **no active chamber heater**. Chamber temperature rises from the bed and the hotend. This server has no chamber-temperature setter.

LAN Only and Developer Mode are switches on the printer. They let a third-party client talk. They do not turn off `BAMBU_SAFE_MODE`. Official steps: [LAN Only](https://wiki.bambulab.com/en/knowledge-sharing/enable-lan-mode), [Developer Mode](https://wiki.bambulab.com/en/knowledge-sharing/enable-developer-mode).

## Safe mode tools

While `BAMBU_SAFE_MODE` is on, the catalog is `status`, `temps`, `ams`, `list_files`, `get_version`, `set_light`, `set_camera`, and `set_sound`. Upload, slice, and motion are registered again only after `BAMBU_SAFE_MODE=0` and a reload. `set_camera` changes recording and timelapse settings. It does not open a stream.

## Fit

P2S plate is 256 × 256 × 256 mm. P1S usable height in the slicer is about 250 mm. If the part is larger, stop before `slice_hook`. Leave a few millimeters at the edges for a brim.

Nozzle on these machines is rated to 300 °C, bed to 100 °C (P1S) or 110 °C (P2S). This server cannot set temperatures. If `temps` shows a target you did not expect on an idle printer, tell the operator and do not start a job.

## AMS

Call `ams` and use the slot whose type matches the requested material.

- One external spool is not an AMS slot. Say which feed you are using.
- Ordinary TPU does not belong in the AMS. Only filament labeled for AMS feeds from a slot. Other TPU comes off the external holder, with `useAms: false` if they print that way.
- Fiber-filled filament wants a hardened nozzle. P2S ships with one. P1S ships with stainless steel. Say so before a CF or GF job.
- `print` defaults to AMS on and slot `0`. Override with the sidecar or the tool arguments when `ams` shows a different slot.

## While it is printing

`status` state `RUNNING` means a job owns the machine. Do not start another. Rising nozzle or bed temperature during a job is normal. A target with no job, or a state you cannot explain, is a reason to ask the operator, not a reason to send `stop` on your own.
