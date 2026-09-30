/** Short, sortable-ish, filename-safe -- the same shape as app/schema.py::new_id. */
export function newId(prefix = ""): string {
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `${prefix}${Date.now().toString(16)}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
