import type { AmsSnapshot, Info, StatusSnapshot, TempsSnapshot } from "./types";

export class ApiError extends Error {
  readonly hint: "localNetwork" | null;

  constructor(message: string, hint: "localNetwork" | null = null) {
    super(message);
    this.name = "ApiError";
    this.hint = hint;
  }
}

function hintOf(value: unknown): "localNetwork" | null {
  return value === "localNetwork" ? "localNetwork" : null;
}

export async function loadInfo(): Promise<Info> {
  const res = await fetch("/api/info", { cache: "no-store" });
  if (!res.ok) throw new ApiError("Page server stopped");
  const body: unknown = await res.json();
  if (!body || typeof body !== "object" || !Array.isArray((body as Info).tools)) {
    throw new ApiError("Page server stopped");
  }
  return body as Info;
}

export interface LiveSnapshot {
  status: StatusSnapshot | null;
  temps: TempsSnapshot | null;
  ams: AmsSnapshot | null;
  statusError: ApiError | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Status, temperatures, and AMS in one round trip. A status failure still returns the other two. */
export async function loadLive(): Promise<LiveSnapshot> {
  let res: Response;
  try {
    res = await fetch("/api/live", { cache: "no-store" });
  } catch {
    throw new ApiError("The page server is not responding");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("Bad response from the page server");
  }
  const record = asObject(body);
  if (!res.ok || !record) {
    const message = typeof record?.error === "string" ? record.error : `HTTP ${res.status}`;
    throw new ApiError(message, hintOf(record?.hint));
  }
  const statusError = typeof record.statusError === "string" ? record.statusError : null;
  return {
    status: asObject(record.status) as StatusSnapshot | null,
    temps: asObject(record.temps) as TempsSnapshot | null,
    ams: asObject(record.ams) as AmsSnapshot | null,
    statusError: statusError ? new ApiError(statusError, hintOf(record.hint)) : null,
  };
}

export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`/api/tool/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("The page server is not responding");
  }

  let body: { ok?: boolean; error?: string; hint?: unknown; result?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new ApiError("Bad response from the page server");
  }
  if (!res.ok || body.ok === false) {
    throw new ApiError(body.error || `HTTP ${res.status}`, hintOf(body.hint));
  }
  return body.result;
}
