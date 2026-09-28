import { ApiError, callTool, loadInfo, loadLive } from "./api";
import { baseName, duration, filamentColor, jobName, printFileError } from "./format";
import type { AmsSnapshot, Info, StatusSnapshot, TempsSnapshot, ToolResult } from "./types";

type Tone = "" | "good" | "warn" | "bad" | "info";

const STATES: Record<string, [string, Tone]> = {
  RUNNING: ["Printing", "good"],
  PREPARE: ["Preparing", "warn"],
  SLICING: ["Slicing", "warn"],
  PAUSE: ["Paused", "warn"],
  FINISH: ["Finished", "info"],
  FAILED: ["Failed", "bad"],
  IDLE: ["Idle", ""],
};

interface PendingSwitch {
  on: boolean;
  until: number;
}

interface TempTile {
  root: HTMLElement;
  value: HTMLElement;
  target: HTMLElement;
  shown: string;
}

interface View {
  model: HTMLElement;
  host: HTMLElement;
  conn: HTMLElement;
  connText: HTMLElement;
  safe: HTMLElement;
  safeText: HTMLElement;
  wifi: HTMLElement;
  wifiText: HTMLElement;
  netAlert: HTMLElement;
  state: HTMLElement;
  stateText: HTMLElement;
  job: HTMLElement;
  pct: HTMLElement;
  ringBar: SVGCircleElement;
  facts: HTMLElement;
  fault: HTMLElement;
  rowWork: HTMLElement;
  rowChamber: HTMLElement;
  rowRecord: HTMLElement;
  rowLapse: HTMLElement;
  rowSound: HTMLElement;
  temps: { nozzle: TempTile; bed: TempTile; chamber: TempTile };
  spools: HTMLElement;
  amsAside: HTMLElement;
  files: HTMLElement;
  fileIcon: HTMLTemplateElement;
  printLock: HTMLElement;
  printForm: HTMLElement;
  localFile: HTMLInputElement;
  amsSlot: HTMLSelectElement;
  plate: HTMLInputElement;
  printLocal: HTMLButtonElement;
  pauseBtn: HTMLButtonElement;
  resumeBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  toast: HTMLElement;
  ask: HTMLDialogElement;
  askTitle: HTMLElement;
  askText: HTMLElement;
  askFacts: HTMLElement;
  askYes: HTMLButtonElement;
  askNo: HTMLButtonElement;
  switches: Record<string, HTMLButtonElement>;
  soundOn: HTMLButtonElement;
  soundOff: HTMLButtonElement;
  reloadFiles: HTMLButtonElement;
}

function must<T extends Element>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as unknown as T;
}

function tempTile(id: string): TempTile {
  const root = must<HTMLElement>(id);
  const value = root.querySelector(".temp-value");
  const target = root.querySelector(".temp-target");
  if (!(value instanceof HTMLElement) || !(target instanceof HTMLElement)) {
    throw new Error(`Missing temperature fields in #${id}`);
  }
  return { root, value, target, shown: "" };
}

function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function collect(): View {
  const fileIcon = document.getElementById("fileIcon");
  if (!(fileIcon instanceof HTMLTemplateElement)) throw new Error("Missing #fileIcon");
  return {
    model: must("model"),
    host: must("host"),
    conn: must("conn"),
    connText: must("connText"),
    safe: must("safe"),
    safeText: must("safeText"),
    wifi: must("wifi"),
    wifiText: must("wifiText"),
    netAlert: must("netAlert"),
    state: must("state"),
    stateText: must("stateText"),
    job: must("job"),
    pct: must("pct"),
    ringBar: must<SVGCircleElement>("ringBar"),
    facts: must("facts"),
    fault: must("fault"),
    rowWork: must("rowWork"),
    rowChamber: must("rowChamber"),
    rowRecord: must("rowRecord"),
    rowLapse: must("rowLapse"),
    rowSound: must("rowSound"),
    temps: { nozzle: tempTile("tNozzle"), bed: tempTile("tBed"), chamber: tempTile("tChamber") },
    spools: must("spools"),
    amsAside: must("amsAside"),
    files: must("files"),
    fileIcon,
    printLock: must("printLock"),
    printForm: must("printForm"),
    localFile: must<HTMLInputElement>("localFile"),
    amsSlot: must<HTMLSelectElement>("amsSlot"),
    plate: must<HTMLInputElement>("plate"),
    printLocal: must<HTMLButtonElement>("printLocal"),
    pauseBtn: must<HTMLButtonElement>("pauseBtn"),
    resumeBtn: must<HTMLButtonElement>("resumeBtn"),
    stopBtn: must<HTMLButtonElement>("stopBtn"),
    toast: must("toast"),
    ask: must<HTMLDialogElement>("ask"),
    askTitle: must("askTitle"),
    askText: must("askText"),
    askFacts: must("askFacts"),
    askYes: must<HTMLButtonElement>("askYes"),
    askNo: must<HTMLButtonElement>("askNo"),
    switches: {
      swChamber: must<HTMLButtonElement>("swChamber"),
      swWork: must<HTMLButtonElement>("swWork"),
      swRecord: must<HTMLButtonElement>("swRecord"),
      swLapse: must<HTMLButtonElement>("swLapse"),
    },
    soundOn: must<HTMLButtonElement>("soundOn"),
    soundOff: must<HTMLButtonElement>("soundOff"),
    reloadFiles: must<HTMLButtonElement>("reloadFiles"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setDataTone(node: Element, tone: string): void {
  if (tone) {
    if (node.getAttribute("data-tone") !== tone) node.setAttribute("data-tone", tone);
    return;
  }
  if (node.hasAttribute("data-tone")) node.removeAttribute("data-tone");
}

function lightLabel(mode: string | null | undefined): string {
  if (mode === "on") return "On";
  if (mode === "off") return "Off";
  if (mode === "flashing") return "Flashing";
  return "Unknown";
}

function flagLabel(value: string | null | undefined, onText: string, offText: string): string {
  if (!value) return "Unknown";
  return value === "enable" ? onText : offText;
}

function plateNumber(raw: string): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

function amsSignature(next: AmsSnapshot): string {
  if (next.supported === false) return "off";
  const parts: string[] = [];
  for (const unit of next.units ?? []) {
    parts.push(String(unit.id));
    for (const slot of unit.slots ?? []) {
      parts.push(`${slot.slot}:${slot.type ?? ""}:${slot.colorHex ?? ""}:${slot.active ? 1 : 0}`);
    }
  }
  return parts.join("|");
}

export function boot(): void {
  const view = collect();
  const pending = new Map<string, PendingSwitch>();
  let info: Info = {
    safeMode: true,
    hardwareModel: "",
    host: "",
    capabilities: {},
    tools: [],
  };
  let status: StatusSnapshot | null = null;
  let ams: AmsSnapshot | null = null;
  let statusKey = "";
  let pctShown: number | null = null;
  let pctKnown = false;
  let ringP = "0";
  let amsKey = "";
  let filesKey = "";
  let polling = false;
  let filesBusy = false;
  let filesLive = true;
  let filesAt = 0;
  let pollTimer = 0;
  let fileTimer = 0;
  let acting = false;
  let asking = false;
  let toastTimer = 0;
  let resolveAsk: ((yes: boolean) => void) | null = null;

  const has = (tool: string) => info.tools.includes(tool);

  function toast(message: string, bad = false): void {
    view.toast.textContent = message;
    view.toast.classList.toggle("is-bad", bad);
    view.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => view.toast.classList.remove("is-visible"), 3200);
  }

  function showNetwork(error: unknown): void {
    if (error instanceof ApiError && error.hint === "localNetwork") view.netAlert.classList.add("is-visible");
  }

  function clearNetwork(): void {
    view.netAlert.classList.remove("is-visible");
  }

  function setConn(online: boolean, text: string): void {
    setDataTone(view.conn, online ? "online" : "offline");
    setText(view.connText, text);
  }

  function setSwitch(id: string, on: boolean, subId: string, subText: string): void {
    const sw = view.switches[id];
    sw.setAttribute("aria-checked", on ? "true" : "false");
    sw.closest(".control")?.classList.toggle("is-on", on);
    const sub = document.getElementById(subId);
    if (sub) sub.textContent = subText;
  }

  function reportSwitch(id: string, on: boolean, subId: string, subText: string): void {
    const want = pending.get(id);
    if (want && Date.now() < want.until && on !== want.on) return;
    pending.delete(id);
    const sw = view.switches[id];
    const checked = on ? "true" : "false";
    const sub = document.getElementById(subId);
    if (sw.getAttribute("aria-checked") === checked && sub?.textContent === subText) return;
    setSwitch(id, on, subId, subText);
  }

  function reconcileSwitches(next: StatusSnapshot, work: { mode: string } | undefined): void {
    if (!view.rowChamber.hidden) {
      reportSwitch("swChamber", next.chamberLight === "on", "subChamber", lightLabel(next.chamberLight));
    }
    if (!view.rowWork.hidden && work) {
      reportSwitch("swWork", work.mode === "on", "subWork", lightLabel(work.mode));
    }
    const record = next.ipcam?.record;
    const lapse = next.ipcam?.timelapse;
    if (!view.rowRecord.hidden) {
      reportSwitch("swRecord", record === "enable", "subRecord", flagLabel(record, "Recording is on", "Recording is off"));
    }
    if (!view.rowLapse.hidden) {
      reportSwitch("swLapse", lapse === "enable", "subLapse", flagLabel(lapse, "Timelapse is on", "Timelapse is off"));
    }
  }

  function updateMotion(): void {
    if (!has("pause")) return;
    const state = status?.state;
    const busy = state === "RUNNING" || state === "PREPARE";
    view.pauseBtn.disabled = !busy || acting;
    view.resumeBtn.disabled = state !== "PAUSE" || acting;
    view.stopBtn.disabled = !(busy || state === "PAUSE") || acting;
    view.printLocal.disabled = busy || state === "PAUSE" || acting;
  }

  function renderStatus(next: StatusSnapshot): void {
    status = next;
    const state = next.state ?? "";
    const work = (next.lights ?? []).find((light) => light.node === "work_light");
    const key = [
      state,
      next.percent ?? "",
      next.subtask ?? "",
      next.layer ?? "",
      next.totalLayers ?? "",
      next.remainingMin ?? "",
      next.printError ?? "",
      next.errorCode ?? "",
      next.wifiSignal ?? "",
      next.chamberLight ?? "",
      work?.mode ?? "",
      next.ipcam?.record ?? "",
      next.ipcam?.timelapse ?? "",
    ].join("\0");
    if (key === statusKey) {
      reconcileSwitches(next, work);
      return;
    }
    statusKey = key;

    const known = STATES[state];
    const label = known
      ? known[0]
      : state
        ? state.charAt(0) + state.slice(1).toLowerCase()
        : "Unknown";
    const tone: Tone = known ? known[1] : "";
    setDataTone(view.state, tone);
    setText(view.stateText, label);

    const name = jobName(next.subtask);
    setText(view.job, name || "No job on the printer");
    view.job.classList.toggle("is-empty", !name);

    const pct = typeof next.percent === "number" ? Math.max(0, Math.min(100, next.percent)) : null;
    if (!pctKnown || pct !== pctShown) {
      pctKnown = true;
      pctShown = pct;
      view.pct.replaceChildren();
      if (pct == null) {
        view.pct.textContent = "–";
      } else {
        view.pct.append(document.createTextNode(String(pct)));
        const unit = document.createElement("small");
        unit.textContent = "%";
        view.pct.append(unit);
      }
    }
    const p = String((pct ?? 0) / 100);
    if (p !== ringP) {
      ringP = p;
      view.ringBar.style.setProperty("--p", p);
    }
    setDataTone(view.ringBar, tone);

    view.facts.replaceChildren();
    const addFact = (fact: string, value: string | null) => {
      if (!value) return;
      const span = document.createElement("span");
      span.append(document.createTextNode(`${fact} `));
      const strong = document.createElement("b");
      strong.className = "font-semibold text-ink";
      strong.textContent = value;
      span.append(strong);
      view.facts.append(span);
    };
    if (next.layer != null) {
      addFact("Layer", next.totalLayers ? `${next.layer} of ${next.totalLayers}` : String(next.layer));
    }
    if (state === "RUNNING" || state === "PAUSE" || state === "PREPARE") {
      addFact("Time left", duration(next.remainingMin));
    }

    const fault = Boolean(next.printError && next.printError !== 0);
    view.fault.hidden = !fault;
    if (fault) {
      setText(
        view.fault,
        `The printer reported an error (code ${next.errorCode || next.printError}). Check the printer screen.`,
      );
    }

    if (next.wifiSignal) {
      view.wifi.hidden = false;
      setText(view.wifiText, `Wi-Fi ${next.wifiSignal.replace("dBm", " dBm")}`);
    }

    reconcileSwitches(next, work);
    updateMotion();
  }

  function renderTemp(tile: TempTile, now: number | null | undefined, target: number | null | undefined): void {
    const shown = `${now ?? ""}:${target ?? ""}`;
    if (tile.shown === shown) return;
    tile.shown = shown;
    if (now == null) {
      setText(tile.value, "–");
      setText(tile.target, "Not reported");
      tile.root.classList.remove("is-heating");
      return;
    }
    const rounded = Math.round(now);
    tile.value.replaceChildren(document.createTextNode(String(rounded)));
    const unit = document.createElement("small");
    unit.textContent = "°C";
    tile.value.append(unit);
    if (target == null) setText(tile.target, "\u00a0");
    else if (target <= 0) setText(tile.target, "Heater off");
    else setText(tile.target, `Target ${Math.round(target)}°C`);
    tile.root.classList.toggle("is-heating", (target ?? 0) > 0 && Math.abs((target ?? 0) - now) > 3);
  }

  function renderTemps(temps: TempsSnapshot): void {
    renderTemp(view.temps.nozzle, temps.nozzleC, temps.nozzleTargetC);
    renderTemp(view.temps.bed, temps.bedC, temps.bedTargetC);
    if (view.temps.chamber.shown !== "none") renderTemp(view.temps.chamber, temps.chamberC, null);
  }

  function fillSlotPicker(): void {
    const select = view.amsSlot;
    const current = select.value;
    select.replaceChildren();
    for (const unit of ams?.units ?? []) {
      for (const slot of unit.slots ?? []) {
        if (!slot.type) continue;
        const option = document.createElement("option");
        option.value = String(slot.slot);
        option.textContent = `Slot ${slot.slot + 1} · ${slot.type}`;
        select.append(option);
      }
    }
    const external = document.createElement("option");
    external.value = "external";
    external.textContent = "External spool";
    select.append(external);
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function renderAms(next: AmsSnapshot): void {
    const key = amsSignature(next);
    if (key === amsKey) return;
    amsKey = key;
    ams = next;
    const units = next.units ?? [];
    const fragment = document.createDocumentFragment();
    if (next.supported === false || units.length === 0) {
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = next.supported === false ? "This printer has no AMS." : "No AMS detected.";
      fragment.append(note);
      view.amsAside.textContent = "";
    }
    for (const unit of units) {
      for (const slot of unit.slots ?? []) {
        const tile = document.createElement("div");
        tile.className = slot.active ? "spool is-active" : "spool";
        const reel = document.createElement("div");
        const color = filamentColor(slot.colorHex);
        reel.className = slot.type ? "reel" : "reel is-empty";
        if (color) reel.style.background = color;
        const text = document.createElement("div");
        text.className = "min-w-0 flex flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-0.5";
        const type = document.createElement("div");
        type.className = "font-semibold";
        type.textContent = slot.type || "Empty";
        const where = document.createElement("div");
        where.className = "text-xs text-muted";
        where.textContent = `${units.length > 1 ? `AMS ${unit.id + 1} · ` : ""}Slot ${slot.slot + 1}`;
        text.append(type, where);
        if (slot.type && color) {
          const hex = document.createElement("div");
          hex.className = "font-mono text-[11px] text-faint";
          hex.textContent = color;
          text.append(hex);
        }
        tile.append(reel, text);
        if (slot.active) {
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.textContent = "In use";
          tile.append(badge);
        }
        fragment.append(tile);
      }
    }
    view.spools.replaceChildren(fragment);
    if (units.length > 0) {
      const count = units.reduce((sum, unit) => sum + (unit.slots ?? []).filter((slot) => slot.type).length, 0);
      view.amsAside.textContent = `${count} loaded`;
    }
    fillSlotPicker();
  }

  function renderFiles(list: string[]): void {
    const key = `${has("print") ? "1" : "0"}\0${list.join("\n")}`;
    if (key === filesKey) return;
    filesKey = key;
    if (list.length === 0) {
      const item = document.createElement("li");
      item.className = "empty-note";
      item.textContent = "No files stored on the printer.";
      view.files.replaceChildren(item);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const name of list) {
      const item = document.createElement("li");
      item.append(view.fileIcon.content.cloneNode(true));
      const span = document.createElement("span");
      span.className = "min-w-0 flex-1 truncate text-sm";
      span.textContent = name;
      span.title = name;
      item.append(span);
      if (has("print") && printFileError(name) == null) {
        const button = document.createElement("button");
        button.className = "btn btn-sm";
        button.type = "button";
        button.textContent = "Print";
        button.addEventListener("click", () => {
          void startPrint(name, true);
        });
        item.append(button);
      }
      fragment.append(item);
    }
    view.files.replaceChildren(fragment);
  }

  function showOffline(error: unknown): void {
    statusKey = "";
    setConn(false, "Offline");
    setDataTone(view.state, "bad");
    setText(view.stateText, "Offline");
    setText(view.job, "Can't reach the printer");
    view.job.classList.add("is-empty");
    setText(view.facts, messageOf(error));
    showNetwork(error);
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const live = await loadLive();
      if (live.status) {
        renderStatus(live.status);
        setConn(true, "Online");
        clearNetwork();
      } else if (live.statusError) {
        showOffline(live.statusError);
      }
      if (live.temps) renderTemps(live.temps);
      if (live.ams) renderAms(live.ams);
    } catch (error) {
      showOffline(error);
    } finally {
      polling = false;
    }
  }

  function noteFiles(text: string): void {
    filesKey = "";
    const item = document.createElement("li");
    item.className = "empty-note";
    item.textContent = text;
    view.files.replaceChildren(item);
  }

  async function loadFiles(): Promise<void> {
    if (!filesLive || filesBusy) return;
    filesBusy = true;
    filesAt = Date.now();
    try {
      const result = asRecord(await callTool("list_files"));
      if (result?.supported === false) {
        filesLive = false;
        window.clearTimeout(fileTimer);
        view.reloadFiles.hidden = true;
        noteFiles("This printer does not list files.");
        return;
      }
      const files = result && Array.isArray(result.files) ? result.files.filter((name) => typeof name === "string") : [];
      renderFiles(files);
    } catch (error) {
      noteFiles(`Couldn't list files: ${messageOf(error)}`);
      showNetwork(error);
    } finally {
      filesBusy = false;
    }
  }

  function finishAsk(yes: boolean): void {
    if (view.ask.open) view.ask.close();
    asking = false;
    const resolve = resolveAsk;
    resolveAsk = null;
    resolve?.(yes);
  }

  function confirmAction(
    title: string,
    text: string,
    facts: Array<[string, string]>,
    yesLabel: string,
    danger: boolean,
  ): Promise<boolean> {
    if (asking || view.ask.open) return Promise.resolve(false);
    asking = true;
    view.askTitle.textContent = title;
    view.askText.textContent = text;
    view.askFacts.replaceChildren();
    for (const [key, value] of facts) {
      const term = document.createElement("dt");
      term.textContent = key;
      const detail = document.createElement("dd");
      detail.textContent = value;
      view.askFacts.append(term, detail);
    }
    view.askFacts.hidden = facts.length === 0;
    view.askYes.textContent = yesLabel;
    view.askYes.classList.toggle("is-primary", !danger);
    view.askYes.classList.toggle("is-danger", danger);
    view.ask.showModal();
    return new Promise((resolve) => {
      resolveAsk = resolve;
    });
  }

  async function flip(
    id: string,
    run: (on: boolean) => Promise<unknown>,
    labelOn: string,
    labelOff: string,
  ): Promise<void> {
    const sw = view.switches[id];
    const next = sw.getAttribute("aria-checked") !== "true";
    const subId = `sub${id.slice(2)}`;
    const before = document.getElementById(subId)?.textContent ?? "";
    sw.disabled = true;
    setSwitch(id, next, subId, next ? "Turning on…" : "Turning off…");
    pending.set(id, { on: next, until: Date.now() + 12_000 });
    try {
      const result = (await run(next)) as ToolResult | null;
      if (result && result.supported === false) {
        pending.delete(id);
        setSwitch(id, !next, subId, before);
        toast("This printer doesn't support that.", true);
      } else {
        clearNetwork();
        toast(next ? labelOn : labelOff);
      }
    } catch (error) {
      pending.delete(id);
      setSwitch(id, !next, subId, before);
      showNetwork(error);
      toast(messageOf(error), true);
    } finally {
      sw.disabled = false;
      window.setTimeout(() => void poll(), 2500);
      window.setTimeout(() => void poll(), 7000);
    }
  }

  async function setSound(on: boolean): Promise<void> {
    view.soundOn.disabled = true;
    view.soundOff.disabled = true;
    try {
      await callTool("set_sound", { on });
      view.soundOn.setAttribute("aria-pressed", on ? "true" : "false");
      view.soundOff.setAttribute("aria-pressed", on ? "false" : "true");
      view.rowSound.classList.toggle("is-on", on);
      clearNetwork();
      toast(on ? "Sound on" : "Sound off");
    } catch (error) {
      showNetwork(error);
      toast(messageOf(error), true);
    } finally {
      view.soundOn.disabled = false;
      view.soundOff.disabled = false;
    }
  }

  async function startPrint(file: string, alreadyUploaded: boolean): Promise<void> {
    if (acting) return;
    const problem = printFileError(file);
    if (problem) {
      toast(problem, true);
      if (!alreadyUploaded) view.localFile.focus();
      return;
    }
    const slot = view.amsSlot.value;
    const useAms = slot !== "external";
    const plate = plateNumber(view.plate.value);
    const filament = view.amsSlot.selectedOptions[0]?.textContent ?? "External spool";
    const yes = await confirmAction(
      "Start this print?",
      "The printer will heat up and start moving.",
      [
        ["File", baseName(file)],
        ["Plate", String(plate)],
        ["Filament", filament],
      ],
      "Start print",
      false,
    );
    if (!yes) return;
    const args: Record<string, unknown> = { file, confirm: true, plate, useAms };
    if (useAms) args.amsMapping = [Number(slot)];
    if (alreadyUploaded) args.alreadyUploaded = true;
    acting = true;
    updateMotion();
    try {
      await callTool("print", args);
      clearNetwork();
      toast("Print sent");
      window.setTimeout(() => void poll(), 2500);
    } catch (error) {
      showNetwork(error);
      toast(messageOf(error), true);
    } finally {
      acting = false;
      updateMotion();
    }
  }

  async function motion(tool: string, title: string, text: string, yesLabel: string, danger: boolean): Promise<void> {
    if (acting) return;
    const job = status?.subtask ? jobName(status.subtask) : "the current job";
    const yes = await confirmAction(title, text, [["Job", job]], yesLabel, danger);
    if (!yes) return;
    acting = true;
    updateMotion();
    try {
      await callTool(tool, { confirm: true });
      clearNetwork();
      toast(`${yesLabel} sent`);
      window.setTimeout(() => void poll(), 2500);
    } catch (error) {
      showNetwork(error);
      toast(messageOf(error), true);
    } finally {
      acting = false;
      updateMotion();
    }
  }

  function cameraResult(body: unknown, key: "record" | "timelapse"): ToolResult {
    const result = (asRecord(body) ?? {}) as ToolResult;
    const field = result[key];
    if (field && typeof field === "object" && field.supported === false) return { supported: false };
    return result;
  }

  view.switches.swChamber.addEventListener("click", () => {
    void flip("swChamber", (on) => callTool("set_light", { on, node: "chamber_light" }), "Chamber light on", "Chamber light off");
  });
  view.switches.swWork.addEventListener("click", () => {
    void flip("swWork", (on) => callTool("set_light", { on, node: "work_light" }), "Work light on", "Work light off");
  });
  view.switches.swRecord.addEventListener("click", () => {
    void flip(
      "swRecord",
      async (on) => cameraResult(await callTool("set_camera", { record: on }), "record"),
      "Recording on",
      "Recording off",
    );
  });
  view.switches.swLapse.addEventListener("click", () => {
    void flip(
      "swLapse",
      async (on) => cameraResult(await callTool("set_camera", { timelapse: on }), "timelapse"),
      "Timelapse on",
      "Timelapse off",
    );
  });
  view.soundOn.addEventListener("click", () => void setSound(true));
  view.soundOff.addEventListener("click", () => void setSound(false));
  view.reloadFiles.addEventListener("click", () => void loadFiles());
  view.printLocal.addEventListener("click", () => {
    const file = view.localFile.value.trim();
    if (!file) {
      toast("Enter the path to a .gcode.3mf file first.", true);
      view.localFile.focus();
      return;
    }
    void startPrint(file, false);
  });
  view.pauseBtn.addEventListener("click", () => {
    void motion("pause", "Pause the print?", "The print head parks until you resume.", "Pause", false);
  });
  view.resumeBtn.addEventListener("click", () => {
    void motion("resume", "Resume the print?", "The printer continues where it stopped.", "Resume", false);
  });
  view.stopBtn.addEventListener("click", () => {
    void motion("stop", "Stop the print?", "This cancels the job. It cannot be resumed.", "Stop print", true);
  });
  view.askYes.addEventListener("click", () => finishAsk(true));
  view.askNo.addEventListener("click", () => finishAsk(false));
  view.ask.addEventListener("cancel", () => finishAsk(false));

  async function start(): Promise<void> {
    try {
      info = await loadInfo();
    } catch {
      setConn(false, "Page server stopped");
      return;
    }
    document.title = `${info.hardwareModel} · Printer`;
    view.model.textContent = `Bambu Lab ${info.hardwareModel}`;
    view.host.textContent = info.host;
    setDataTone(view.safe, info.safeMode ? "safe" : "unsafe");
    view.safeText.textContent = info.safeMode ? "Safe mode on" : "Safe mode off";
    const caps = info.capabilities;
    view.rowChamber.hidden = caps.chamberLight === false || !has("set_light");
    view.rowWork.hidden = !caps.workLight || !has("set_light");
    view.rowRecord.hidden = caps.ipcamRecord === false || !has("set_camera");
    view.rowLapse.hidden = caps.timelapse === false || !has("set_camera");
    view.rowSound.hidden = !has("set_sound");
    if (caps.chamberTempSensor === false) {
      setText(view.temps.chamber.value, "–");
      setText(view.temps.chamber.target, "No sensor");
      view.temps.chamber.shown = "none";
    }
    filesLive = caps.ftps !== false && has("list_files");
    if (!filesLive) {
      view.reloadFiles.hidden = true;
      noteFiles("This printer does not list files.");
    }
    const unlocked = has("print");
    view.printLock.hidden = unlocked;
    view.printForm.hidden = !unlocked;
    fillSlotPicker();
    await poll();
    if (filesLive) {
      filesAt = Date.now();
      void loadFiles();
    }
    armPoll();
    armFiles();
  }

  function armPoll(): void {
    window.clearTimeout(pollTimer);
    if (document.hidden) return;
    pollTimer = window.setTimeout(() => {
      void poll().finally(armPoll);
    }, 5000);
  }

  function armFiles(): void {
    window.clearTimeout(fileTimer);
    if (document.hidden || !filesLive) return;
    const wait = Math.max(0, 60_000 - (Date.now() - filesAt));
    fileTimer = window.setTimeout(() => {
      void loadFiles().finally(armFiles);
    }, wait);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearTimeout(pollTimer);
      window.clearTimeout(fileTimer);
      return;
    }
    void poll().finally(armPoll);
    armFiles();
  });

  void start();
}
