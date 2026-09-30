// The classic Kanban board, as a third view of the open map. It edits the map
// itself (through the store's `apply`, like the canvas), so undo, saving and
// the mind map all follow every drag -- there is no second copy to sync.
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { C, spacingFactor, STATUS, type StatusId } from "../constants";
import { StatusGlyph } from "../canvas/glyphs";
import { PlanBadges } from "../canvas/MindNodeView";
import { nodePlan, type NodePlan } from "../canvas/nodePlan";
import { index } from "../core/graph";
import { planOf } from "../core/plan";
import { SpacingButton } from "../components/Chrome";
import {
  addCard, addIdeaUnder, boardColumns, boardNode, boardTabs, moveCard,
  type BoardCard, type BoardColumn, type BoardTab,
} from "../core/board";
import { branchColors } from "../core/colors";
import * as cmd from "../core/commands";
import { sizeOf, useApp } from "../store/app";
import { paletteOf } from "../theme";
import type { MindMap } from "../types";

/** The board last looked at, per map -- kept while the app is open. */
const lastTab = new Map<string, string>();
const DRAG = "application/x-kanaban-card";

function ago(iso: string | undefined): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "done today" : days === 1 ? "done yesterday" : days < 30 ? `done ${days} days ago` : `done ${iso.slice(0, 10)}`;
}

export default function BoardView({ map }: { map: MindMap }) {
  const theme = useApp((s) => s.settings.theme);
  const spacing = spacingFactor(useApp((s) => s.settings.spacing));
  const hideDone = useApp((s) => s.settings.hideDone);
  const focus = useApp((s) => s.focus);
  const tabs = useMemo(() => boardTabs(map), [map]);
  const [tab, setTabState] = useState(() => lastTab.get(map.id) ?? "");
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const setTab = (id: string) => { lastTab.set(map.id, id); setTabState(id); };
  const columns = useMemo(() => (current ? boardColumns(map, current.id) : []), [map, current?.id]);   // eslint-disable-line
  const colors = useMemo(() => branchColors(map, paletteOf(theme)), [map, theme]);
  const whatIf = useApp((s) => s.whatIf);
  const criticalBy = useApp((s) => s.settings.criticalBy);
  const showCritical = useApp((s) => s.settings.showCritical);
  const plan = useMemo(() => planOf(map, { whatIf, criticalBy }), [map, whatIf, criticalBy]);
  const badges = useMemo(() => {
    const idx = index(map);
    return new Map(map.nodes.map((n) => [n.id, nodePlan(map, plan, n.id, whatIf, showCritical, idx)]));
  }, [map, plan, whatIf, showCritical]);

  // Search asked to show a node: open its board and bring its card into view.
  useEffect(() => {
    const id = focus.nodeId;
    if (!id) return;
    const home = tabs.find((t) => boardColumns(map, t.id).some((c) => c.cards.some((k) => k.node.id === id)));
    if (home && home.id !== current?.id) setTab(home.id);
    requestAnimationFrame(() => document.querySelector(`[data-card-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }, [focus.nonce]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging a card near either edge scrolls the board, so every column can be reached.
  const scroller = useRef<HTMLDivElement>(null);
  const edgeScroll = useRef({ dir: 0, raf: 0 });
  const steer = (dir: number) => {
    const s = edgeScroll.current;
    s.dir = dir;
    if (!dir) { cancelAnimationFrame(s.raf); s.raf = 0; return; }
    if (s.raf) return;
    const step = () => {
      if (!s.dir || !scroller.current) { s.raf = 0; return; }
      scroller.current.scrollLeft += s.dir * C.board.edge_scroll_px;
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(edgeScroll.current.raf), []);
  const onDragOver = (e: React.DragEvent) => {
    const r = scroller.current?.getBoundingClientRect();
    if (!r || !e.dataTransfer.types.includes(DRAG)) return;
    const zone = C.board.edge_zone_px;
    steer(e.clientX < r.left + zone ? -1 : e.clientX > r.right - zone ? 1 : 0);
  };

  const gap = Math.round(14 * spacing);
  return (
    <div className="board-view absolute inset-0 flex flex-col" style={{ zIndex: 1, paddingTop: 80, ["--card-gap" as string]: `${Math.round(8 * spacing)}px` }}
         data-testid="board-view">
      <Tabs map={map} tabs={tabs} current={current} onPick={setTab} colors={colors} />
      <div ref={scroller} className="board-scroll min-h-0 flex-1" style={{ gap, padding: `12px 16px 16px` }} aria-label="Columns"
           onDragOver={onDragOver} onDrop={() => steer(0)} onDragEnd={() => steer(0)}
           onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) steer(0); }}>
        {current && columns.map((col) => (
          <Column key={col.id} map={map} tab={current} col={col} colors={colors} badges={badges}
                  collapsed={hideDone && col.status === "done"} />
        ))}
        {current && !current.loose && <AddColumn board={boardNode(current.id)} />}
      </div>
    </div>
  );
}

function Tabs({ map, tabs, current, onPick, colors }:
  { map: MindMap; tabs: BoardTab[]; current?: BoardTab; onPick: (id: string) => void; colors: Map<string, string | null> }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const root = map.nodes.find((n) => !map.edges.some((e) => e.kind === "branch" && e.target === n.id));
  const add = (text: string) => {
    if (!root || !text.trim()) { setAdding(false); return; }
    const r = useApp.getState().apply((m) => addIdeaUnder(m, root.id, text.trim(), sizeOf), { select: false });
    setAdding(false);
    if (r?.nodeId) onPick(r.nodeId);
  };
  return (
    <div className="flex flex-none items-center gap-3 px-4">
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1" role="group" aria-label="Boards">
      {tabs.map((t) => (
        renaming === t.id ? (
          <InlineInput key={t.id} initial={t.title} label="Board name" width={180}
                       onDone={(v) => { if (v.trim()) useApp.getState().apply((m) => cmd.setText(m, boardNode(t.id), v.trim()), { select: false }); setRenaming(null); }} />
        ) : (
          <button key={t.id} aria-pressed={t.id === current?.id} data-testid="board-tab"
                  className={"board-tab" + (t.id === current?.id ? " on" : "")} onClick={() => onPick(t.id)}
                  onDoubleClick={() => !t.loose && setRenaming(t.id)} title={t.loose ? "Tasks straight off the map's centre" : "Double-click to rename"}>
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: t.color ?? colors.get(boardNode(t.id)) ?? "var(--accent)" }} />
            <span className="max-w-[200px] truncate">{t.title}</span>
            <span className="num text-[11px]" style={{ color: "var(--textMuted)" }}>{t.progress.done}/{t.progress.total}</span>
          </button>
        )
      ))}
      {adding
        ? <InlineInput initial="" label="New board name" placeholder="Board name" width={180} onDone={add} />
        : <button className="board-tab" onClick={() => setAdding(true)} data-testid="board-add" title="A new board: a new branch off the map's centre">
            <Plus size={14} /> Board
          </button>}
    </div>
      <span className="glass flex-none rounded-[12px] p-0.5"><SpacingButton up={false} /></span>
    </div>
  );
}

function Column({ map, tab, col, colors, collapsed, badges }:
  { map: MindMap; tab: BoardTab; col: BoardColumn; colors: Map<string, string | null>; collapsed: boolean;
    badges: Map<string, NodePlan | undefined> }) {
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const store = useApp.getState;
  const dot = col.status ? `var(--q-${col.status})` : col.color ?? "var(--accent)";

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(DRAG);
    if (id) store().apply((m) => moveCard(m, tab.id, id, col.id), { select: false });
  };
  const add = (text: string) => {
    if (!text.trim()) { setAdding(false); return; }
    store().apply((m) => addCard(m, tab.id, col.id, text.trim(), sizeOf), { select: false });   // stays open for the next one
  };
  const remove = () => {
    const n = col.cards.length;
    store().apply((m) => cmd.deleteNodes(m, [col.id]), { select: false });
    store().toast("info", `Column “${col.title}” deleted${n ? ` with ${n} card${n === 1 ? "" : "s"}` : ""}.`,
                  { label: "Undo", run: () => store().undo() });
  };

  return (
    <section className={"board-col glass" + (over ? " over" : "")} aria-label={`${col.title}, ${col.cards.length} cards`}
             data-testid="board-column" data-column-id={col.id}
             onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setOver(true); } }}
             onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
             onDrop={drop}>
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        {col.status ? <StatusGlyph status={col.status} size={15} />
                    : <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />}
        {renaming ? (
          <InlineInput initial={col.title} label="Column name" width={150}
                       onDone={(v) => { if (v.trim()) store().apply((m) => cmd.setText(m, col.id, v.trim()), { select: false }); setRenaming(false); }} />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold" data-testid="column-title"
              onDoubleClick={() => col.kind === "topic" && setRenaming(true)}
              title={col.kind === "topic" ? "Double-click to rename" : `Status: ${col.title}`}>{col.title}</h3>
        )}
        <span className="num rounded-full px-2 text-[11.5px] font-semibold" data-testid="column-count"
              style={{ background: col.status ? `var(--q-${col.status}-soft)` : "var(--surfaceRaised)", color: col.status ? `var(--q-${col.status})` : "var(--textMuted)" }}>
          {col.cards.length}
        </span>
        {col.kind === "topic" && (
          <button className="icon-btn sm" title="Delete this column and its cards" aria-label={`Delete column ${col.title}`} onClick={remove}>
            <Trash2 size={14} />
          </button>
        )}
      </header>

      <div className="board-cards" data-testid="column-cards">
        {collapsed ? (
          <button className="board-empty" onClick={() => store().setSetting("hideDone", false)}>
            {col.cards.length} done, hidden — show them (H)
          </button>
        ) : col.cards.map((c) => <Card key={c.node.id} map={map} card={c} color={colors.get(c.node.id) ?? null} inStatusColumn={!!col.status}
                                         plan={badges.get(c.node.id)} />)}
        {!collapsed && !col.cards.length && <div className="board-empty">Drop cards here</div>}
      </div>

      <footer className="px-2 pb-2">
        {adding
          ? <InlineInput initial="" label={`New card in ${col.title}`} placeholder="Card title — Enter adds, Esc stops" onDone={(v) => { add(v); if (!v.trim()) setAdding(false); }} keepOpen multiline />
          : <button className="board-add-card" onClick={() => setAdding(true)} data-testid="add-card"><Plus size={14} /> Add card</button>}
      </footer>
    </section>
  );
}

function Card({ map, card, color, inStatusColumn, plan }:
  { map: MindMap; card: BoardCard; color: string | null; inStatusColumn: boolean; plan?: NodePlan }) {
  const { node, path, sub } = card;
  const selected = useApp((s) => s.selectedNodes.includes(node.id));
  const [editing, setEditing] = useState(false);
  const store = useApp.getState;
  const status = node.status as StatusId;
  const note = node.note.split("\n").find((l) => l.trim()) ?? "";
  const openInMap = () => {
    const s = store();
    s.setSetting("view", "2d");
    setTimeout(() => s.focusNode(map.id, node.id), 60);
  };
  return (
    <article className={"kb-card" + (selected ? " sel" : "") + (status === "done" ? " done" : "") +
                        (plan?.inactive ? " inactive" : "") + (plan?.critical ? " critical" : "") + (plan?.wait ? " waiting" : "")}
             style={{ ["--branch" as string]: color ?? `var(--q-${status})` }}
             draggable={!editing} data-testid="board-card" data-card-id={node.id} data-status={status}
             onDragStart={(e) => { e.dataTransfer.setData(DRAG, node.id); e.dataTransfer.effectAllowed = "move"; }}
             onClick={() => store().select([node.id], [])} onDoubleClick={() => setEditing(true)}>
      <div className="flex items-start gap-2">
        <button className="kb-status" title={status === "done" ? "Reopen (Space)" : "Mark done (Space)"} aria-label={`${STATUS[status].label} — toggle done`}
                onClick={(e) => { e.stopPropagation(); store().apply((m) => cmd.toggleDone(m, [node.id]), { select: false }); }}>
          <StatusGlyph status={status} size={16} />
        </button>
        {editing ? (
          <InlineInput initial={node.text} label="Card title" multiline
                       onDone={(v) => { if (v.trim() && v.trim() !== node.text) store().apply((m) => cmd.setText(m, node.id, v.trim()), { select: false }); setEditing(false); }} />
        ) : (
          <span className="kb-title min-w-0 flex-1" data-testid="card-title">{node.text || "(untitled)"}</span>
        )}
        <span className="kb-actions">
          <button className="icon-btn sm" title="Show it in the mind map" aria-label="Show in the mind map"
                  onClick={(e) => { e.stopPropagation(); openInMap(); }}><ArrowUpRight size={14} /></button>
          <button className="icon-btn sm" title="Delete (Delete)" aria-label="Delete card"
                  onClick={(e) => {
                    e.stopPropagation();
                    store().apply((m) => cmd.deleteNodes(m, [node.id]), { select: false });
                    store().toast("info", `Deleted “${node.text}”.`, { label: "Undo", run: () => store().undo() });
                  }}><Trash2 size={14} /></button>
        </span>
      </div>
      {note && <p className="kb-note">{note}</p>}
      {plan && <PlanBadges plan={plan} />}
      {(path.length > 0 || sub.total > 0 || status === "done" || !inStatusColumn) && (
        <div className="kb-meta">
          {!inStatusColumn && <span style={{ color: `var(--q-${status})` }}>{STATUS[status].label}</span>}
          {path.length > 0 && <span className="truncate">↳ {path.join(" · ")}</span>}
          {sub.total > 0 && <span className="num">{sub.done}/{sub.total} sub-tasks</span>}
          {status === "done" && node.doneAt && <span>{ago(node.doneAt)}</span>}
        </div>
      )}
    </article>
  );
}

function AddColumn({ board }: { board: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="board-col-add">
      {adding
        ? <InlineInput initial="" label="New column name" placeholder="Column name, e.g. Bugs" width={220}
                       onDone={(v) => {
                         if (v.trim()) useApp.getState().apply((m) => addIdeaUnder(m, board, v.trim(), sizeOf), { select: false });
                         setAdding(false);
                       }} />
        : <button className="board-add-card" onClick={() => setAdding(true)} data-testid="add-column"><Plus size={14} /> Add column</button>}
    </div>
  );
}

/** A small text field that commits on Enter / blur and gives up on Esc. */
function InlineInput({ initial, label, placeholder, width, multiline, keepOpen, onDone }: {
  initial: string; label: string; placeholder?: string; width?: number; multiline?: boolean; keepOpen?: boolean;
  onDone: (value: string) => void;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const props = {
    ref, value: v, "aria-label": label, placeholder, className: "field kb-input",
    style: { width: width ?? "100%", height: multiline ? "auto" : 28 },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement & HTMLInputElement>) => setV(e.target.value),
    onBlur: () => onDone(keepOpen ? "" : v),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (keepOpen) { if (v.trim()) { onDone(v); setV(""); } else onDone(""); }
        else onDone(v);
      }
      if (e.key === "Escape") { e.preventDefault(); onDone(keepOpen ? "" : initial); }
    },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}

