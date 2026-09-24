# Printer notes

Read this when the job depends on the machine, not for every chat.

## P2S speaks P1S

Set `BAMBU_MODEL=P1S` for P2S hardware. The value `P2S` is accepted and stored as `P1S`. There is no separate P2S MQTT schema in bambu-js.

LAN Only and Developer Mode are switches on the printer. They let a third-party client talk. They do not turn off `BAMBU_SAFE_MODE`. Official steps: [LAN Only](https://wiki.bambulab.com/en/knowledge-sharing/enable-lan-mode), [Developer Mode](https://wiki.bambulab.com/en/knowledge-sharing/enable-developer-mode).

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
