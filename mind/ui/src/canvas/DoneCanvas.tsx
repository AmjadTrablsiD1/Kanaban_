// The "Everything done" map: every finished task from every map, laid out as a
// mind map and rebuilt live. Nothing here is stored -- each task node stands for
// the real one, so the only edits are "reopen" (made in its own map) and "go there".
import { ArrowUpRight, RotateCcw, Trophy } from "lucide-react";
import * as cmd from "../core/commands";
import type { DoneMap } from "../core/done";
import { DONE_VIEW, useApp } from "../store/app";
import { cssVar } from "../theme";
import { LiveCanvas } from "./LiveCanvas";

/** The live done map, for the keyboard commands (Space reopens what is selected here). */
export const doneView: { current: DoneMap | null } = { current: null };

export function reopen(virtualIds: string[]) {
  const d = doneView.current;
  if (!d) return 0;
  const byMap = new Map<string, string[]>();
  for (const v of virtualIds) {
    const o = d.origin.get(v);
    if (o) byMap.set(o.mapId, [...(byMap.get(o.mapId) ?? []), o.nodeId]);
  }
  const s = useApp.getState();
  for (const [mapId, ids] of byMap) s.applyTo(mapId, (m) => cmd.setStatus(m, ids, "todo"));
  const n = [...byMap.values()].flat().length;
  if (n) s.toast("info", `Reopened ${n} task${n === 1 ? "" : "s"} — back to "To do" in ${n === 1 ? "its" : "their"} map.`,
                 { label: "Undo", run: () => [...byMap.keys()].forEach((id) => useApp.getState().undoIn(id)) });
  return n;
}

export function jumpTo(virtualId: string) {
  const o = doneView.current?.origin.get(virtualId);
  if (o) useApp.getState().focusNode(o.mapId, o.nodeId);
}

function when(iso: string | undefined, now: number): string {
  if (!iso) return "done (no date recorded)";
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "done today";
  if (days === 1) return "done yesterday";
  if (days < 30) return `done ${days} days ago`;
  return `done on ${iso.slice(0, 10)}`;
}

export function DoneCanvas({ done }: { done: DoneMap }) {
  doneView.current = done;
  const now = Date.now();
  return (
    <LiveCanvas
      map={done.map} progress={done.progress} rootId="done:root"
      isReal={(id) => done.origin.has(id)}
      show={(n) => ({ ...n, note: when(n.doneAt, now) })}
      onToggle={(id) => { reopen([id]); }}
      bar={(id) => <DoneBar id={id} />}
      onOpen={jumpTo}
      minimapColor={(_, branch) => branch ?? cssVar("q-done")}
      testId="done-canvas" className="done-view" label="Everything done"
    >
      {done.stats.done === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" style={{ zIndex: 2 }}>
          <div className="glass pointer-events-auto max-w-[400px] rounded-[18px] p-7 text-center" data-testid="done-empty">
            <Trophy size={36} style={{ color: "var(--q-done)", margin: "0 auto 12px" }} />
            <h2 className="mb-2 text-[18px] font-semibold">Nothing finished yet</h2>
            <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--textMuted)" }}>
              Mark a task done in any map — <span className="kbd">Space</span> — and it shows up here,
              grouped by map and board, newest first.
            </p>
          </div>
        </div>
      )}
    </LiveCanvas>
  );
}

function DoneBar({ id }: { id: string }) {
  return (
    <div className="glass bar fade-in nodrag" role="toolbar" aria-label="Done task actions">
      <button className="btn" style={{ height: 28 }} title="Go to this task in its own map (double-click)"
              onClick={() => jumpTo(id)}><ArrowUpRight size={14} /> Open in its map</button>
      <button className="btn" style={{ height: 28 }} title="Not done after all: back to To do (Space)"
              onClick={() => reopen([id])}><RotateCcw size={14} /> Reopen</button>
    </div>
  );
}

export { DONE_VIEW };
