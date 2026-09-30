// "Everything to do": every open task from every map around one big centre.
// Built live (core/todo.ts); each task stands for the real one, so marking it
// done happens in its own map -- and it moves over to "Everything done".
import { ArrowUpRight, Check, CircleHelp, PartyPopper } from "lucide-react";
import type { StatusId } from "../constants";
import * as cmd from "../core/commands";
import { NEXT_CENTRE, type NextMap } from "../core/next";
import { planOf } from "../core/plan";
import { CENTRE_ID, type TodoMap } from "../core/todo";
import { useApp } from "../store/app";
import { cssVar } from "../theme";
import { LiveCanvas } from "./LiveCanvas";
import { nodePlan } from "./nodePlan";

/** The live map, for the keyboard commands (Space, 0–3 act on what is selected here). */
export const todoView: { current: TodoMap | null } = { current: null };

/** Change real nodes through the view: grouped by map, one undo step per map. */
function inTheirMaps(virtualIds: string[], fn: (m: Parameters<typeof cmd.setStatus>[0], ids: string[]) => cmd.Result) {
  const t = todoView.current;
  if (!t) return new Map<string, string[]>();
  const byMap = new Map<string, string[]>();
  for (const v of virtualIds) {
    const o = t.origin.get(v);
    if (o) byMap.set(o.mapId, [...(byMap.get(o.mapId) ?? []), o.nodeId]);
  }
  const s = useApp.getState();
  for (const [mapId, ids] of byMap) s.applyTo(mapId, (m) => fn(m, ids));
  return byMap;
}

/** Set a status from here. "Done" takes the task off this map, so say where it went. */
export function statusTodo(ids: string[], status: StatusId) {
  const byMap = inTheirMaps(ids, (m, real) => cmd.setStatus(m, real, status));
  const n = [...byMap.values()].flat().length;
  if (n && status === "done") {
    useApp.getState().toast("success", `${n === 1 ? "Done" : `${n} done`} — moved to Everything done (D).`,
      { label: "Undo", run: () => [...byMap.keys()].forEach((id) => useApp.getState().undoIn(id)) });
  }
  return n;
}

export const doneTodo = (ids: string[]) => statusTodo(ids, "done");

export function openTodo(virtualId: string) {
  const o = todoView.current?.origin.get(virtualId);
  if (o) useApp.getState().focusNode(o.mapId, o.nodeId);
}

/** Double-clicking the centre renames it, in the top bar. */
export function renameCentre() {
  const el = document.querySelector<HTMLInputElement>("[data-testid=centre-name]");
  el?.focus();
  el?.select();
}

export function TodoCanvas({ todo }: { todo: TodoMap }) {
  return <TaskList live={todo} variant="todo" empty={todo.stats.doing + todo.stats.todo === 0} />;
}

export function NextCanvas({ next }: { next: NextMap }) {
  return <TaskList live={next} variant="next" empty={next.stats.doing + next.stats.ready + next.stats.decide === 0} />;
}

const EMPTY = {
  todo: { title: "Nothing left to do", text: "Every task in every map is done (or there are only ideas). Give a node a status — 1 to do, 2 doing — and it appears here." },
  next: { title: "Nothing can start right now", text: "Everything open is waiting for something: another task, a date or an answer. Open the Plan panel (P) on a task to see what it waits for." },
};

/** The two task lists built from every map: "Everything to do" and "Next up". */
function TaskList({ live, variant, empty }: { live: Omit<TodoMap, "stats">; variant: "todo" | "next"; empty: boolean }) {
  todoView.current = { ...live, stats: { doing: 0, todo: 0, total: 0, maps: 0 } };
  const maps = useApp((s) => s.maps);
  const whatIf = useApp((s) => s.whatIf);
  const criticalBy = useApp((s) => s.settings.criticalBy);
  const showCritical = useApp((s) => s.settings.showCritical);
  const rootId = variant === "todo" ? CENTRE_ID : NEXT_CENTRE;
  // badges come from each task's own map
  const badge = (id: string) => {
    const o = live.origin.get(id);
    const m = o && maps[o.mapId];
    return m ? nodePlan(m, planOf(m, { whatIf, criticalBy }), o.nodeId, whatIf, showCritical) : undefined;
  };
  const isQuestion = (id: string) => live.map.nodes.find((n) => n.id === id)?.kind === "condition";
  return (
    <LiveCanvas
      map={live.map} progress={live.progress} rootId={rootId}
      isReal={(id) => live.origin.has(id)}
      onToggle={(id) => { if (isQuestion(id)) answerIn(id); else doneTodo([id]); }}
      bar={(id) => <TodoBar id={id} mapName={maps[live.origin.get(id)!.mapId]?.name ?? ""} question={isQuestion(id)} />}
      onOpen={openTodo} onRootOpen={variant === "todo" ? renameCentre : undefined} plan={badge}
      minimapColor={(id, branch) => branch ?? cssVar(id === rootId ? "rootA" : "q-todo")}
      testId={`${variant}-canvas`} className="todo-view" label={variant === "todo" ? "Everything to do" : "Next up"}
    >
      {empty && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" style={{ zIndex: 2 }}>
          <div className="glass pointer-events-auto max-w-[400px] rounded-[18px] p-7 text-center" data-testid={`${variant}-empty`}>
            <PartyPopper size={36} style={{ color: "var(--q-done)", margin: "0 auto 12px" }} />
            <h2 className="mb-2 text-[18px] font-semibold">{EMPTY[variant].title}</h2>
            <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--textMuted)" }}>{EMPTY[variant].text}</p>
          </div>
        </div>
      )}
    </LiveCanvas>
  );
}

/** A question: go to it in its own map and open its Plan panel, where it is answered. */
function answerIn(virtualId: string) {
  const o = todoView.current?.origin.get(virtualId);
  if (!o) return;
  const s = useApp.getState();
  s.focusNode(o.mapId, o.nodeId);
  s.set({ planFor: o.nodeId });
}

function TodoBar({ id, mapName, question }: { id: string; mapName: string; question: boolean }) {
  return (
    <div className="glass bar fade-in nodrag" role="toolbar" aria-label="Task actions">
      <button className="btn" style={{ height: 28 }} title="Edit this task in its own map (double-click)"
              data-testid="todo-open" onClick={() => openTodo(id)}>
        <ArrowUpRight size={14} /> Open in {mapName || "its map"}
      </button>
      {question
        ? <button className="btn" style={{ height: 28 }} title="Answer it in its Plan panel" data-testid="todo-answer"
                  onClick={() => answerIn(id)}><CircleHelp size={14} /> Answer</button>
        : <button className="btn" style={{ height: 28 }} title="Mark it done (Space)" data-testid="todo-done"
                  onClick={() => doneTodo([id])}><Check size={14} /> Done</button>}
    </div>
  );
}
