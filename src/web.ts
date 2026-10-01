import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BambuLanClient, type PrinterPort } from "./client.js";
import { loadConfig, type Config } from "./config.js";
import { MockPrinter } from "./mock.js";
import type { Capabilities } from "./models.js";
import { createTools, type Tool } from "./tools/index.js";

const HOST = "127.0.0.1";
const PORT = 4173;

const PRINTER_ENV_KEYS = [
  "BAMBU_IP",
  "BAMBU_ACCESS_CODE",
  "BAMBU_SERIAL",
  "BAMBU_MODEL",
  "BAMBU_SAFE_MODE",
  "BAMBU_MOCK",
  "SLICER_BIN",
] as const;

export function errorHint(message: string): "localNetwork" | null {
  if (message.includes("EHOSTUNREACH") || message.includes("No route to host")) return "localNetwork";
  return null;
}

/** Fill only keys that are missing. Does not overwrite the environment or change safe mode on its own. */
export function fillMissingPrinterEnv(env: NodeJS.ProcessEnv, mcpText: string | null): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  if (!mcpText) return next;
  let parsed: unknown;
  try {
    parsed = JSON.parse(mcpText);
  } catch {
    return next;
  }
  const block = (parsed as { mcpServers?: { bambu?: { env?: Record<string, unknown> } } }).mcpServers?.bambu
    ?.env;
  if (!block) return next;
  for (const key of PRINTER_ENV_KEYS) {
    const current = next[key];
    if (typeof current === "string" && current.trim() !== "") continue;
    const value = block[key];
    if (typeof value === "string" && value.trim() !== "") next[key] = value;
  }
  return next;
}

/** One printer report for the page poll: status, temps, and ams share a single request. */
export async function readLive(tools: Tool[]): Promise<{
  status: unknown;
  temps: unknown;
  ams: unknown;
  statusError: string | null;
  hint: "localNetwork" | null;
}> {
  const [status, temps, ams] = await Promise.all([
    runTool(tools, "status", {}),
    runTool(tools, "temps", {}),
    runTool(tools, "ams", {}),
  ]);
  const statusError = status.body.ok === false ? String(status.body.error ?? "Status failed") : null;
  return {
    status: status.body.ok ? (status.body.result ?? null) : null,
    temps: temps.body.ok ? (temps.body.result ?? null) : null,
    ams: ams.body.ok ? (ams.body.result ?? null) : null,
    statusError,
    hint: statusError && status.body.hint === "localNetwork" ? "localNetwork" : null,
  };
}

export async function runTool(
  tools: Tool[],
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    return { status: 404, body: { ok: false, error: `Unknown tool ${name}` } };
  }
  try {
    const result = await tool.handler(args);
    return { status: 200, body: { ok: true, result: result as Record<string, unknown> } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = errorHint(message);
    return { status: 400, body: { ok: false, error: message, ...(hint ? { hint } : {}) } };
  }
}

const STATIC_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export function webRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../web/dist");
}

/** Hashed build files under `web/dist/assets` only. Rejects paths that leave that directory. */
export function resolveStaticFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/assets/") || decoded.includes("\0") || decoded.includes("\\")) return null;
  if (!existsSync(root)) return null;
  const rootReal = realpathSync(root);
  const candidate = normalize(join(rootReal, decoded.slice(1)));
  const rel = relative(rootReal, candidate);
  if (!rel.startsWith(`assets${sep}`) || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (!existsSync(candidate)) return null;
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return null;
  }
  const relReal = relative(rootReal, real);
  if (!relReal.startsWith(`assets${sep}`) || relReal.startsWith("..") || isAbsolute(relReal)) return null;
  if (!statSync(real).isFile()) return null;
  if (!STATIC_TYPES[extname(real).toLowerCase()]) return null;
  return real;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createWebHandler(options: {
  tools: Tool[];
  info: { safeMode: boolean; hardwareModel: string; host: string; capabilities: Capabilities };
  page: () => string;
  staticRoot?: string;
}) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    if (req.method === "GET" && options.staticRoot && url.pathname.startsWith("/assets/")) {
      const file = resolveStaticFile(options.staticRoot, url.pathname);
      const type = file ? STATIC_TYPES[extname(file).toLowerCase()] : undefined;
      if (!file || !type) {
        sendJson(res, 404, { ok: false, error: "Not found" });
        return;
      }
      const bytes = await readFile(file);
      res.writeHead(200, {
        "content-type": type,
        "content-length": bytes.byteLength,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      res.end(bytes);
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = options.page();
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(html),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/live") {
      sendJson(res, 200, await readLive(options.tools));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/info") {
      sendJson(res, 200, {
        safeMode: options.info.safeMode,
        hardwareModel: options.info.hardwareModel,
        host: options.info.host,
        capabilities: options.info.capabilities,
        tools: options.tools.map((tool) => tool.name),
      });
      return;
    }
    const match = /^\/api\/tool\/([a-z_]+)$/.exec(url.pathname);
    if (req.method === "POST" && match) {
      const raw = await readBody(req);
      let args: Record<string, unknown> = {};
      if (raw.trim() !== "") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { ok: false, error: "Invalid JSON" });
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          sendJson(res, 400, { ok: false, error: "Body must be a JSON object" });
          return;
        }
        args = parsed as Record<string, unknown>;
      }
      const outcome = await runTool(options.tools, match[1], args);
      sendJson(res, outcome.status, outcome.body);
      return;
    }
    sendJson(res, 404, { ok: false, error: "Not found" });
  };
}

function printerPort(cfg: Config): PrinterPort {
  return cfg.mock ? new MockPrinter() : new BambuLanClient(cfg);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

export function startWeb(): void {
  const mcpFile = join(homedir(), ".cursor", "mcp.json");
  const mcpText = existsSync(mcpFile) ? readFileSync(mcpFile, "utf8") : null;
  const cfg = loadConfig(fillMissingPrinterEnv(process.env, mcpText));
  const port = printerPort(cfg);
  const tools = createTools(port, {
    safeMode: cfg.safeMode,
    slicerBin: cfg.slicerBin,
    capabilities: cfg.capabilities,
  });
  const root = webRoot();
  const page = () => readFileSync(join(root, "index.html"), "utf8");
  page();
  const handler = createWebHandler({
    tools,
    info: {
      safeMode: cfg.safeMode,
      hardwareModel: cfg.hardwareModel,
      host: cfg.ip,
      capabilities: cfg.capabilities,
    },
    page,
    staticRoot: root,
  });
  const server = createServer((req, res) => {
    void handler(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: message, hint: errorHint(message) });
    });
  });
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.error(
      `bambu-ui ${cfg.mock ? "mock" : "lan"} hardware=${cfg.hardwareModel} host=${cfg.ip} safeMode=${cfg.safeMode ? "on" : "off"} ${url}`,
    );
    if (process.platform === "darwin") {
      const child = spawn("open", [url], { stdio: "ignore", detached: true });
      child.unref();
    }
  });
}

if (isDirectRun()) {
  try {
    startWeb();
  } catch (error) {
    console.error("Fatal:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
