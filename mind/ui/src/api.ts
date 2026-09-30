// The only file that talks HTTP. Every failure becomes an Error whose message
// is a sentence the UI can show as it is.
import { API } from "./constants";
import type { MindMap, ServerState, Settings } from "./types";

export type { ServerState };

// Which start of the server this window belongs to. Sent with every write, so
// a window left open across a restart is refused instead of overwriting newer data.
let instance = "";
export const setInstance = (id: string) => { instance = id; };

/** An error the UI can show as it is; `stale` means "this window is out of date". */
export class ApiError extends Error {
  constructor(message: string, public stale = false) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const writes = init.method && init.method !== "GET";
  const headers = new Headers(init.headers);
  if (writes && instance) headers.set("X-Kanaban-Instance", instance);
  let res: Response;
  try {
    res = await fetch(API(path), { ...init, headers });
  } catch {
    throw new ApiError("The app's server is not answering. Is Kanaban Mind still running?");
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const b = body as { detail?: unknown; stale?: boolean } | null;
    throw new ApiError(typeof b?.detail === "string" ? b.detail : `The server said ${res.status}.`, !!b?.stale);
  }
  return body as T;
}

const json = (method: string, data: unknown, extra: RequestInit = {}): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), ...extra,
});

export const api = {
  state: () => call<ServerState>("state"),
  whoami: () => call<{ token: string }>("whoami"),
  createMap: (name: string) => call<{ map: MindMap }>("maps", json("POST", { name })),
  saveMap: (m: MindMap, keepalive = false) =>
    call<{ ok: boolean; updatedAt: string; repairs: string[] }>(`maps/${m.id}`, json("PUT", m, { keepalive })),
  deleteMap: (id: string) => call<{ ok: boolean }>(`maps/${id}`, { method: "DELETE" }),
  saveWorkspace: (order: string[], activeMapId: string | null, centreName: string, keepalive = false) =>
    call("workspace", json("PUT", { order, activeMapId, centreName }, { keepalive })),
  importFile: (importer: string, file: Blob) =>
    call<{ maps: MindMap[]; summary: Record<string, number> }>(`import/${importer}`, { method: "POST", body: file }),
  importDefaultKanban: () =>
    call<{ maps: MindMap[]; summary: Record<string, number> }>("import/kanban/default", { method: "POST" }),
  saveSettings: (s: Settings, keepalive = false) =>
    call<{ settings: Settings; fileExists: boolean }>("settings", json("PUT", s, { keepalive })),
  resetSettings: () => call<{ settings: Settings; fileExists: boolean }>("settings", { method: "DELETE" }),
  reveal: () => call<{ ok: boolean; path: string }>("reveal", { method: "POST" }),
  // Only when started from the Kanban board's kanban.py -- a standalone start has no updater.
  update: (force = false) => call<UpdateInfo>(force ? "update?force=1" : "update"),
  runUpdate: () => call<{ ok: boolean; output: string; version: string; restarting: boolean }>("update", { method: "POST" }),
};

/** What the Kanban's updater says: the version here, the newest on GitHub, and its notes. */
export interface UpdateInfo {
  version: string;
  latest: string | null;
  updateAvailable: boolean;
  notes: string;
  offline: boolean;
  /** Started on its own (main.py): no updater, no classic board. */
  standalone?: boolean;
}
