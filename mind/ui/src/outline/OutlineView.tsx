// The outline: the map as an indented list, for typing long lists fast. Every
// line is the node itself -- the same map, the same undo, the same fold.
//   Enter       new line below (on a centre: its first child)
//   Tab / ⇧Tab  indent under the line above / out one level
//   ↑ ↓         move between lines
//   ⌫ on empty  delete the line
//   ⌘/Ctrl ↵    done / reopen
import { ChevronDown, ChevronRight, CircleHelp } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { STATUS } from "../constants";
import { StatusGlyph } from "../canvas/glyphs";
import * as cmd from "../core/commands";
import { foldedCount } from "../core/fold";
import { index } from "../core/graph";
import { outlineRows, type Row } from "../core/outline";
import { planOf } from "../core/plan";
import { sizeOf, useApp } from "../store/app";
import type { MindMap } from "../types";

export function OutlineView({ map }: { map: MindMap }) {
  const idx = useMemo(() => index(map), [map]);
  const rows = useMemo(() => outlineRows(map, idx), [map, idx]);
  const plan = useMemo(() => planOf(map), [map]);
  const focusNext = useRef<{ id: string; caret: "end" | "start" } | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // after a change re-renders the rows, put the caret where the change says
  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    const el = list.current?.querySelector<HTMLInputElement>(`input[data-id="${want.id}"]`);
    if (!el) return;
    focusNext.current = null;
    el.focus();
    const at = want.caret === "end" ? el.value.length : 0;
    el.setSelectionRange(at, at);
  });

  const store = useApp.getState;
  const apply = (fn: (m: MindMap) => cmd.Result) => store().apply(fn, { select: false });
  const commit = (id: string, value: string) => {
    const n = idx.byId.get(id);
    const clean = value.trim();
    if (n && clean !== n.text) apply((m) => cmd.setText(m, id, clean));
  };
  const at = (id: string) => rows.findIndex((r) => r.node.id === id);
  const go = (id: string, delta: number) => {
    const r = rows[at(id) + delta];
    const el = r && list.current?.querySelector<HTMLInputElement>(`input[data-id="${r.node.id}"]`);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, row: Row) => {
    const id = row.node.id;
    const input = e.currentTarget;
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit(id, input.value);
      apply((m) => cmd.toggleDone(m, [id]));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit(id, input.value);
      const r = row.parent === null || row.hasKids && !row.node.folded
        ? apply((m) => moveFirst(cmd.addChild(m, id, "", sizeOf), id))      // a centre, or an open branch: first child
        : apply((m) => cmd.addSibling(m, id, "", sizeOf));
      if (r?.nodeId) focusNext.current = { id: r.nodeId, caret: "end" };
      return;
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      commit(id, input.value);
      const above = rows.slice(0, at(id)).reverse().find((r) => r.parent === row.parent && r.depth === row.depth);
      if (!above || row.parent === null) return;
      const r = apply((m) => {
        const moved = cmd.moveUnder(m, id, above.node.id);
        return above.node.folded && !moved.error ? { ...cmd.setFolded(moved.map, [above.node.id], false), nodeId: id } : moved;
      });
      if (r) focusNext.current = { id, caret: "end" };
      return;
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      commit(id, input.value);
      if (row.parent === null) return;
      const grand = idx.parents.get(row.parent)?.[0];
      if (!grand) return;                                     // under a centre already: stays
      const r = apply((m) => cmd.moveUnder(m, id, grand, row.parent));
      if (r) focusNext.current = { id, caret: "end" };
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      commit(id, input.value);
      go(id, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (e.key === "Backspace" && !input.value && row.parent !== null && !row.hasKids) {
      e.preventDefault();
      const prev = rows[at(id) - 1];
      apply((m) => cmd.deleteNodes(m, [id]));
      if (prev) focusNext.current = { id: prev.node.id, caret: "end" };
      return;
    }
    if (e.key === "Escape") input.blur();
  };

  return (
    <div className="outline-view absolute inset-0 overflow-y-auto" data-testid="outline-view">
      <div ref={list} className="mx-auto max-w-[780px] px-6 pb-28 pt-[84px]" role="tree" aria-label={`${map.name}, as an outline`}>
        {rows.map((row) => {
          const n = row.node;
          const p = plan.progress.get(n.id);
          const question = n.kind === "condition";
          return (
            <div key={n.id} className={"outline-row" + (n.status === "done" ? " done" : "") + (plan.act.inactive.has(n.id) ? " inactive" : "")}
                 role="treeitem" aria-level={row.depth + 1} aria-expanded={row.hasKids ? !n.folded : undefined}
                 data-testid="outline-row" data-node-id={n.id} style={{ paddingLeft: row.depth * 24 }}>
              {row.hasKids ? (
                <button className="outline-fold" data-testid="outline-fold" aria-label={n.folded ? "Unfold" : "Fold"}
                        title={n.folded ? `Unfold (${foldedCount(map, n.id, idx)} hidden)` : "Fold"}
                        onClick={() => store().toggleFold([n.id])}>
                  {n.folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
              ) : <span className="outline-fold" aria-hidden />}
              <button className="outline-status" data-testid="outline-status" aria-label={`${STATUS[n.status].label}. Toggle done.`}
                      title={question ? "A question (P opens its plan on the map)" : `${STATUS[n.status].label} — click to ${n.status === "done" ? "reopen" : "mark done"}`}
                      onClick={() => apply((m) => cmd.toggleDone(m, [n.id]))}>
                {question ? <CircleHelp size={15} style={{ color: "var(--q-idea)" }} /> : <StatusGlyph status={n.status} size={15} />}
              </button>
              <input key={`${n.id}:${n.text}`} className={"outline-text" + (row.parent === null ? " root" : "")}
                     data-id={n.id} data-testid="outline-text" defaultValue={n.text} spellCheck
                     aria-label="Line text" placeholder={row.parent === null ? "Central idea" : "Type…"}
                     onBlur={(e) => commit(n.id, e.target.value)} onKeyDown={(e) => onKey(e, row)} />
              {n.folded && <span className="outline-meta num" data-testid="outline-folded">+{foldedCount(map, n.id, idx)}</span>}
              {p && p.total > 0 && row.hasKids && <span className="outline-meta num">{p.done}/{p.total}</span>}
              {n.due && <span className="outline-meta num">due {n.due.slice(5)}</span>}
            </div>
          );
        })}
        <p className="mt-6 text-[12px]" style={{ color: "var(--textMuted)" }}>
          Enter: new line · Tab / ⇧Tab: in / out · ↑ ↓: move · {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} Enter: done · ⌫ on an empty line: delete
        </p>
      </div>
    </div>
  );
}

/** A new child of an open branch goes to the top of it, right under the line you were on. */
function moveFirst(r: cmd.Result, parent: string): cmd.Result {
  if (!r.nodeId || r.error) return r;
  const moved = cmd.moveUnder(r.map, r.nodeId, parent, null);
  return moved.error ? r : { ...moved, nodeId: r.nodeId };
}
