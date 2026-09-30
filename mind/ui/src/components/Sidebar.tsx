import { ChevronDown, ChevronUp, Copy, Download, ListTodo, MoreHorizontal, Rocket, PanelLeftClose, Pencil, Plus, Search, Settings2, Trash2, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../constants";
import { activeTally, mapProgress, tally } from "../core/progress";
import { MOD } from "../commands/registry";
import { planOf } from "../core/plan";
import { DONE_VIEW, NEXT_VIEW, TODO_VIEW, useApp } from "../store/app";
import type { MindMap } from "../types";

export function Sidebar({ onImport }: { onImport: () => void }) {
  const maps = useApp((s) => s.maps);
  const order = useApp((s) => s.order);
  const active = useApp((s) => s.activeMapId);
  const list = order.map((id) => maps[id]).filter(Boolean);

  return (
    <aside className="flex h-full w-[272px] flex-col border-r" data-testid="sidebar"
           style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <img src="/favicon.svg" alt="" width={30} height={30} style={{ borderRadius: 8 }} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-tight">{C.app.name}</div>
          <div className="text-[11.5px]" style={{ color: "var(--textMuted)" }}>{C.app.tagline}</div>
        </div>
        <button className="icon-btn sm" title={`Hide the map list (${MOD} B)`} aria-label="Hide the map list"
                onClick={() => useApp.getState().setSetting("sidebarOpen", false)}>
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="px-3">
        <button className="btn w-full" style={{ justifyContent: "flex-start", color: "var(--textMuted)", background: "var(--bg)" }}
                onClick={() => useApp.getState().set({ paletteOpen: true })} data-testid="open-search">
          <Search size={15} /> <span className="flex-1 text-left">Search all maps…</span>
          <span className="kbd">{MOD} K</span>
        </button>
      </div>

      <div className="mt-4 flex items-center px-4 pb-2">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--textMuted)" }}>
          Maps · {list.length}
        </span>
        <button className="icon-btn sm" title="New map" aria-label="New map" data-testid="new-map"
                onClick={() => useApp.getState().createMap()}>
          <Plus size={16} />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Maps">
        {list.length > 0 && <NextItem />}
        {list.length > 0 && <TodoItem />}
        {list.length > 0 && <DoneItem />}
        {list.map((m, i) => <MapItem key={m.id} map={m} active={m.id === active} first={i === 0} last={i === list.length - 1} />)}
        {!list.length && (
          <p className="px-3 py-6 text-center text-[13px]" style={{ color: "var(--textMuted)" }}>
            No maps yet. Create one with <b>+</b>, or import your Kanban.
          </p>
        )}
      </nav>

      <div className="flex gap-2 border-t p-3" style={{ borderColor: "var(--border)" }}>
        <button className="btn flex-1" onClick={onImport} data-testid="import-open">
          <Download size={15} /> Import…
        </button>
        <button className="btn" title={`Settings & shortcuts (${MOD} ,)`} aria-label="Settings and shortcuts"
                onClick={() => useApp.getState().set({ settingsOpen: true })} data-testid="settings-open">
          <Settings2 size={15} />
        </button>
      </div>
    </aside>
  );
}

function MapItem({ map, active, first, last }: { map: MindMap; active: boolean; first: boolean; last: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(map.name);
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const p = useMemo(() => mapProgress(map), [map]);
  const store = useApp.getState;

  // the menu closes on a click anywhere else, or Esc
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setMenu(false); setConfirming(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMenu(false); setConfirming(false); } };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc, true); };
  }, [menu]);

  const finish = () => { store().renameMap(map.id, name); setRenaming(false); };
  const rename = () => { setMenu(false); setName(map.name); setRenaming(true); setTimeout(() => input.current?.select()); };
  const item = (label: string, icon: React.ReactNode, run: () => void, danger = false) => (
    <button role="menuitem" className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--surfaceRaised)]"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: danger ? "var(--danger)" : "var(--text)" }}
            onClick={run}>{icon}{label}</button>
  );

  return (
    <div ref={box} className="group relative mb-0.5 rounded-[10px]" data-testid="map-item" data-map-id={map.id}
         style={{ background: active ? "var(--surfaceRaised)" : "transparent",
                  boxShadow: active ? "inset 0 0 0 1px var(--border)" : "none" }}>
      <button className="flex w-full flex-col gap-1.5 rounded-[10px] py-2.5 pl-3 pr-10 text-left"
              style={{ cursor: "pointer", background: "transparent", border: "none" }}
              aria-current={active ? "page" : undefined}
              onClick={() => store().openMap(map.id)}
              onDoubleClick={rename}>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 flex-none rounded-full"
                style={{ background: active ? "var(--accent)" : "var(--border)", boxShadow: active ? "0 0 8px var(--accent)" : "none" }} />
          {renaming ? (
            <input ref={input} className="field" style={{ height: 26 }} value={name} autoFocus aria-label="Map name"
                   onClick={(e) => e.stopPropagation()}
                   onChange={(e) => setName(e.target.value)} onBlur={finish}
                   onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") finish(); if (e.key === "Escape") setRenaming(false); }} />
          ) : (
            <span className="truncate text-[13.5px] font-medium">{map.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2 pl-4">
          <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--border)" }}
               role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done}
               aria-label={`${map.name}: ${p.done} of ${p.total} tasks done`}>
            <div className="h-full rounded-full" style={{ width: `${p.ratio * 100}%`, background: "var(--q-done)",
                 transition: "width 300ms var(--ease)" }} />
          </div>
          <span className="num text-[11px]" style={{ color: "var(--textMuted)" }}>{p.done}/{p.total}</span>
        </div>
      </button>

      {/* one small button, clear of the name you click to open the map */}
      <button className={"icon-btn sm absolute right-1.5 top-2 " + (menu ? "on" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100")}
              title="Map actions" aria-label={`Actions for ${map.name}`} aria-haspopup="menu" aria-expanded={menu}
              onClick={() => { setMenu((v) => !v); setConfirming(false); }}>
        <MoreHorizontal size={16} />
      </button>

      {menu && (
        <div role="menu" aria-label={`${map.name} actions`} className="glass fade-in absolute right-1 top-10 z-20 w-[200px] rounded-[12px] p-1.5">
          {confirming ? (
            <div className="p-1.5">
              <p className="mb-2 text-[12.5px]">Delete “{map.name}”? A copy is kept in the backups folder.</p>
              <div className="flex gap-1.5">
                <button className="btn danger flex-1" style={{ height: 28 }}
                        onClick={() => { setMenu(false); setConfirming(false); store().deleteMap(map.id); }}>Delete</button>
                <button className="btn flex-1" style={{ height: 28 }} onClick={() => setConfirming(false)}>Keep</button>
              </div>
            </div>
          ) : (
            <>
              {item("Rename", <Pencil size={14} />, rename)}
              {item("Duplicate", <Copy size={14} />, () => { setMenu(false); store().duplicateMap(map.id); })}
              {!first && item("Move up", <ChevronUp size={14} />, () => { setMenu(false); store().moveMap(map.id, -1); })}
              {!last && item("Move down", <ChevronDown size={14} />, () => { setMenu(false); store().moveMap(map.id, 1); })}
              <div className="my-1 h-px" style={{ background: "var(--border)" }} />
              {item("Delete…", <Trash2 size={14} />, () => setConfirming(true), true)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Pinned above the maps: what can be worked on now, from every map. */
function NextItem() {
  const active = useApp((s) => s.activeMapId === NEXT_VIEW);
  const maps = useApp((s) => s.maps);
  const ready = useMemo(() => Object.values(maps).reduce((a, m) => {
    const p = planOf(m);
    return a + p.available.size + p.decisions.length;
  }, 0), [maps]);
  return (
    <div className="mb-1 rounded-[10px]" data-testid="next-item"
         style={{ background: active ? "var(--surfaceRaised)" : "transparent",
                  boxShadow: active ? "inset 0 0 0 1px var(--accent)" : "none" }}>
      <button className="flex w-full items-center gap-2 rounded-[10px] py-2.5 pl-3 pr-3 text-left"
              style={{ cursor: "pointer", background: "transparent", border: "none" }}
              aria-current={active ? "page" : undefined} title="Next up: what can be worked on now (U)"
              onClick={() => useApp.getState().openMap(NEXT_VIEW)}>
        <Rocket size={14} style={{ color: "var(--accent)" }} />
        <span className="flex-1 truncate text-[13.5px] font-semibold">{C.next_view.title}</span>
        <span className="num rounded-full px-2 text-[11.5px] font-semibold"
              style={{ background: "var(--surfaceRaised)", color: "var(--accent)" }} data-testid="next-count">{ready}</span>
      </button>
    </div>
  );
}

/** Pinned above the maps: every open task from every map, as its own map. */
function TodoItem() {
  const active = useApp((s) => s.activeMapId === TODO_VIEW);
  const maps = useApp((s) => s.maps);
  // the same tasks the list shows: open, and not on a road not taken
  const open = useMemo(() => Object.values(maps).reduce((a, m) => a + activeTally(m).open, 0), [maps]);
  return (
    <div className="mb-1 rounded-[10px]" data-testid="todo-item"
         style={{ background: active ? "var(--surfaceRaised)" : "transparent",
                  boxShadow: active ? "inset 0 0 0 1px var(--accent)" : "none" }}>
      <button className="flex w-full items-center gap-2 rounded-[10px] py-2.5 pl-3 pr-3 text-left"
              style={{ cursor: "pointer", background: "transparent", border: "none" }}
              aria-current={active ? "page" : undefined} title="Everything to do: every open task from every map (A)"
              onClick={() => useApp.getState().openMap(TODO_VIEW)}>
        <ListTodo size={14} style={{ color: "var(--q-todo)" }} />
        <span className="flex-1 truncate text-[13.5px] font-semibold">{C.todo_view.title}</span>
        <span className="num rounded-full px-2 text-[11.5px] font-semibold"
              style={{ background: "var(--q-todo-soft)", color: "var(--q-todo)" }} data-testid="todo-count">{open}</span>
      </button>
    </div>
  );
}

/** Pinned above the maps: every finished task from every map, as its own map. */
function DoneItem() {
  const active = useApp((s) => s.activeMapId === DONE_VIEW);
  const maps = useApp((s) => s.maps);
  const all = useMemo(() => tally(Object.values(maps).flatMap((m) => m.nodes.map((n) => n.status))), [maps]);
  return (
    <div className="mb-2 rounded-[10px]" data-testid="done-item"
         style={{ background: active ? "var(--q-done-soft)" : "transparent",
                  boxShadow: active ? "inset 0 0 0 1px var(--q-done)" : "none" }}>
      <button className="flex w-full flex-col gap-1.5 rounded-[10px] py-2.5 pl-3 pr-3 text-left"
              style={{ cursor: "pointer", background: "transparent", border: "none" }}
              aria-current={active ? "page" : undefined} title="Everything done, from every map (D)"
              onClick={() => useApp.getState().openMap(DONE_VIEW)}>
        <div className="flex items-center gap-2">
          <Trophy size={14} style={{ color: "var(--q-done)" }} />
          <span className="flex-1 truncate text-[13.5px] font-semibold">{C.done_view.title}</span>
          <span className="num rounded-full px-2 text-[11.5px] font-semibold"
                style={{ background: "var(--q-done-soft)", color: "var(--q-done)" }} data-testid="done-count">{all.done}</span>
        </div>
        <div className="flex items-center gap-2 pl-[22px]">
          <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--border)" }}
               role="progressbar" aria-valuemin={0} aria-valuemax={all.total} aria-valuenow={all.done}
               aria-label={`All maps: ${all.done} of ${all.total} tasks done`}>
            <div className="h-full rounded-full" style={{ width: `${all.ratio * 100}%`, background: "var(--q-done)" }} />
          </div>
          <span className="num text-[11px]" style={{ color: "var(--textMuted)" }}>{all.done}/{all.total}</span>
        </div>
      </button>
    </div>
  );
}
