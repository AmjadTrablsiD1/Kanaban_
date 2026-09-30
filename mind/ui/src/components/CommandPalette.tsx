import { CornerDownLeft, FileText, Map as MapIcon, Search, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { C, STATUS } from "../constants";
import { StatusGlyph } from "../canvas/glyphs";
import type { Command } from "../commands/registry";
import { fold, search } from "../core/search";
import { useApp } from "../store/app";

type Row =
  | { kind: "node"; key: string; mapId: string; nodeId: string; title: string; sub: string; status: keyof typeof STATUS; inNote: boolean }
  | { kind: "map"; key: string; mapId: string; title: string; sub: string }
  | { kind: "cmd"; key: string; cmd: Command };

export function CommandPalette({ commands }: { commands: Command[] }) {
  const open = useApp((s) => s.paletteOpen);
  const maps = useApp((s) => s.maps);
  const order = useApp((s) => s.order);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(""); setAt(0); setTimeout(() => input.current?.focus()); } }, [open]);

  const rows: Row[] = useMemo(() => {
    const all = order.map((id) => maps[id]).filter(Boolean);
    const fq = fold(q.trim());
    const out: Row[] = [];
    if (fq) {
      for (const h of search(all, q, C.ui.search_results))
        out.push({ kind: "node", key: `n-${h.map.id}-${h.node.id}`, mapId: h.map.id, nodeId: h.node.id,
                   title: h.node.text || "Untitled", sub: h.inNote ? `${h.map.name} · in the note` : h.map.name,
                   status: h.node.status, inNote: h.inNote });
    }
    for (const m of all)
      if (!fq || fold(m.name).includes(fq))
        out.push({ kind: "map", key: `m-${m.id}`, mapId: m.id, title: m.name, sub: `${m.nodes.length} nodes` });
    for (const c of commands)
      if ((!fq || fold(c.label).includes(fq)) && (c.enabled?.() ?? true))
        out.push({ kind: "cmd", key: `c-${c.id}`, cmd: c });
    return out.slice(0, 60);
  }, [q, maps, order, commands]);

  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (!open) return null;
  const close = () => useApp.getState().set({ paletteOpen: false });
  const choose = (r: Row | undefined) => {
    if (!r) return;
    close();
    const s = useApp.getState();
    if (r.kind === "node") { if (s.settings.view === "3d") s.setSetting("view", "2d"); s.focusNode(r.mapId, r.nodeId); }
    else if (r.kind === "map") s.openMap(r.mapId);
    else setTimeout(() => r.cmd.run());
  };

  let group = "";
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="glass panel fade-in fixed left-1/2 top-[12vh] z-[61] w-[640px] max-w-[92vw] -translate-x-1/2 overflow-hidden"
           role="dialog" aria-modal aria-label="Search" data-testid="palette">
        <div className="flex items-center gap-3 border-b px-4" style={{ borderColor: "var(--border)" }}>
          <Search size={18} style={{ color: "var(--textMuted)" }} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} data-testid="palette-input"
                 placeholder="Search nodes in every map, maps, and commands…" aria-label="Search"
                 className="h-14 flex-1 bg-transparent text-[15px] outline-none" style={{ color: "var(--text)" }}
                 onKeyDown={(e) => {
                   if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, rows.length - 1)); }
                   else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
                   else if (e.key === "Enter") { e.preventDefault(); choose(rows[at]); }
                   else if (e.key === "Escape") { e.preventDefault(); close(); }
                 }} />
          <span className="kbd">Esc</span>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2" role="listbox" aria-label="Search results">
          {!rows.length && (
            <div className="px-3 py-10 text-center text-[13px]" style={{ color: "var(--textMuted)" }}>
              Nothing matches “{q}”. Try fewer letters — accents and capitals do not matter.
            </div>
          )}
          {rows.map((r, i) => {
            const label = r.kind === "node" ? "Nodes" : r.kind === "map" ? "Maps" : "Commands";
            const head = label !== group ? (group = label) : null;
            return (
              <div key={r.key}>
                {head && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em]"
                              style={{ color: "var(--textMuted)" }}>{head}</div>}
                <button data-row={i} role="option" aria-selected={i === at}
                        className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left"
                        style={{ background: i === at ? "var(--surfaceRaised)" : "transparent", border: "none", cursor: "pointer",
                                 boxShadow: i === at ? "inset 0 0 0 1px var(--border)" : "none" }}
                        onMouseMove={() => setAt(i)} onClick={() => choose(r)}>
                  <span className="grid w-5 place-items-center" style={{ color: "var(--textMuted)" }}>
                    {r.kind === "node" ? (r.inNote ? <FileText size={15} /> : <StatusGlyph status={r.status} size={16} />)
                      : r.kind === "map" ? <MapIcon size={15} /> : <Terminal size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{r.kind === "cmd" ? r.cmd.label : r.title}</span>
                    {r.kind !== "cmd" && <span className="block truncate text-[11.5px]" style={{ color: "var(--textMuted)" }}>{r.sub}</span>}
                  </span>
                  {r.kind === "cmd" && r.cmd.keys && (
                    <span className="flex gap-1">{r.cmd.keys.map((k) => <span key={k} className="kbd">{k}</span>)}</span>
                  )}
                  {i === at && <CornerDownLeft size={14} style={{ color: "var(--textMuted)" }} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
