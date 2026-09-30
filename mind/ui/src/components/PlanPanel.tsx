// The Plan panel (P, or the Workflow button on a node): everything that turns
// a node from "a task" into part of a plan -- what it waits for, how its parts
// add up, whether it is a question, and its dates. Every change goes through
// the store's apply, so it is undoable and saved like any other edit.
import { CircleHelp, Lock, Plus, Trash2, Unlock } from "lucide-react";
import { useMemo, useState } from "react";
import { DEP_ORDER, DEPS, LOGIC, LOGIC_ORDER, STATUS, type DepType, type Logic } from "../constants";
import { answerOf } from "../core/branches";
import * as cmd from "../core/commands";
import { index } from "../core/graph";
import { describe, planOf } from "../core/plan";
import { planOptions, useApp } from "../store/app";
import { sizeOf } from "../store/app";
import type { MindMap, MindNode } from "../types";
import { Cap, Drawer } from "./Panels";

const run = (fn: (m: MindMap) => cmd.Result) => useApp.getState().apply(fn, { select: false, arrange: false });
const setF = (id: string, patch: Parameters<typeof cmd.setFields>[2]) => run((m) => cmd.setFields(m, [id], patch));

export function PlanPanel() {
  const id = useApp((s) => s.planFor);
  const map = useApp((s) => s.active());
  useApp((s) => s.whatIf);
  const node = map?.nodes.find((n) => n.id === id);
  if (!id || !map || !node) return null;
  const close = () => useApp.getState().set({ planFor: null });
  return (
    <Drawer title="Plan" onClose={close} testId="plan-panel">
      <div className="mb-1 text-[15px] font-semibold">{node.text || "Untitled"}</div>
      <State map={map} node={node} />
      <Waits map={map} node={node} />
      <Logic map={map} node={node} />
      <Question map={map} node={node} />
      <Dates node={node} />
    </Drawer>
  );
}

/** In one line: can this be worked on now, and if not, why. */
function State({ map, node }: { map: MindMap; node: MindNode }) {
  const plan = planOf(map, planOptions());
  const why = plan.act.why.get(node.id);
  let text = "";
  let tone = "var(--q-done)";
  if (plan.act.inactive.has(node.id)) { text = `Out of play: ${why}`; tone = "var(--textMuted)"; }
  else if (plan.act.undecided.has(node.id)) { text = "Waits for a question to be answered."; tone = "var(--q-doing)"; }
  else if (node.kind === "condition") text = answerOf(map, node.id) ? `Answered: ${answerOf(map, node.id)}` : "A question, not answered yet.";
  else if (plan.available.has(node.id)) text = node.status === "doing" ? "Under way." : "Can be started now.";
  else if (node.status === "done") text = "Done.";
  else {
    const bl = (plan.blockers.get(node.id) ?? []).filter((b) => b.stops === "start").map((b) => describe(map, b));
    text = bl.length ? `Can't start yet — ${bl.join("; ")}.` : plan.held.has(node.id) ? "Can't start yet — what it belongs to is waiting." : "";
    tone = "var(--edgeNeeds)";
  }
  if (!text) return null;
  return <p className="mb-2 text-[13px] font-medium" style={{ color: tone }} data-testid="plan-state">{text}</p>;
}

function Waits({ map, node }: { map: MindMap; node: MindNode }) {
  const [pick, setPick] = useState("");
  const waitsFor = map.edges.filter((e) => e.kind === "needs" && e.target === node.id);
  const neededBy = map.edges.filter((e) => e.kind === "needs" && e.source === node.id);
  const name = (id: string) => map.nodes.find((n) => n.id === id)?.text || "Untitled";
  const others = useMemo(() => map.nodes.filter((n) => n.id !== node.id)
    .sort((a, b) => (a.text || "").localeCompare(b.text || "")), [map.nodes, node.id]);
  const row = (e: MindMap["edges"][number], other: string, arrow: string) => (
    <div key={e.id} className="flex items-center gap-2 py-1" data-testid="plan-need">
      <span className="min-w-0 flex-1 truncate text-[13px]">{arrow} {name(other)}</span>
      <select className="field" style={{ width: 132, height: 28 }} value={e.dep ?? "fs"} aria-label={`Kind of waiting on ${name(other)}`}
              onChange={(ev) => run((m) => cmd.setDep(m, e.id, ev.target.value as DepType))}>
        {DEP_ORDER.map((d) => <option key={d} value={d} title={DEPS[d].hint}>{DEPS[d].label}</option>)}
      </select>
      <button className="icon-btn sm" title="Remove this dependency" aria-label={`Remove dependency on ${name(other)}`}
              onClick={() => run((m) => cmd.cutEdges(m, [e.id]))}><Trash2 size={14} /></button>
    </div>
  );
  return (
    <>
      <Cap>Waits for</Cap>
      {waitsFor.map((e) => row(e, e.source, "←"))}
      {!waitsFor.length && <p className="text-[12.5px]" style={{ color: "var(--textMuted)" }}>Nothing: it can start any time.</p>}
      <div className="mt-2 flex gap-2">
        <select className="field" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add something it waits for"
                data-testid="plan-add-need" style={{ height: 30 }}>
          <option value="">Add something it waits for…</option>
          {others.map((n) => <option key={n.id} value={n.id}>{n.text || "Untitled"}{n.kind === "condition" ? " (question)" : ""}</option>)}
        </select>
        <button className="btn" style={{ height: 30 }} disabled={!pick} data-testid="plan-add-need-go"
                onClick={() => { run((m) => cmd.connect(m, pick, node.id, "needs")); setPick(""); }}><Lock size={14} /> Add</button>
      </div>
      {neededBy.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-[12px] font-semibold" style={{ color: "var(--textMuted)" }}>Waited for by</p>
          {neededBy.map((e) => row(e, e.target, "→"))}
        </>
      )}
      <p className="mt-2 text-[12px]" style={{ color: "var(--textMuted)" }}>
        Or draw it: connect two nodes, click the connection and choose <b>Needs</b>.
      </p>
    </>
  );
}

function Logic({ map, node }: { map: MindMap; node: MindNode }) {
  const idx = index(map);
  const kids = (idx.children.get(node.id) ?? []).map((k) => idx.byId.get(k)!).sort((a, b) => a.y - b.y);
  const logic = node.logic ?? "all";
  return (
    <>
      <Cap>Its parts</Cap>
      <div className="seg flex-wrap" role="group" aria-label="How its parts add up">
        {LOGIC_ORDER.map((l: Logic) => (
          <button key={l} className={logic === l ? "on" : ""} aria-pressed={logic === l} title={LOGIC[l].hint}
                  data-testid={`logic-${l}`} onClick={() => setF(node.id, { logic: l === "all" ? null : l })}>{LOGIC[l].label}</button>
        ))}
      </div>
      <p className="mt-1.5 text-[12px]" style={{ color: "var(--textMuted)" }}>{LOGIC[logic].hint}{kids.length ? "" : " (It has no parts yet: add children with Tab.)"}</p>
      {logic === "atleast" && (
        <label className="mt-2 flex items-center gap-2 text-[13px]">How many
          <input type="number" min={1} max={Math.max(1, kids.length)} className="field" style={{ width: 80, height: 28 }}
                 value={node.need ?? 1} data-testid="plan-need-n" aria-label="How many parts are enough"
                 onChange={(e) => setF(node.id, { need: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
          of {kids.length}
        </label>
      )}
      {logic === "one" && kids.length > 0 && (
        <div className="mt-2 grid gap-1" role="radiogroup" aria-label="The path taken">
          {[{ id: "", text: "Not chosen yet (the best one counts)" }, ...kids].map((k) => (
            <label key={k.id || "none"} className="flex items-center gap-2 text-[13px]">
              <input type="radio" name="chosen" checked={(node.chosen ?? "") === k.id} data-testid={`chosen-${k.text}`}
                     onChange={() => setF(node.id, { chosen: k.id || null })} />
              {k.text || "Untitled"}
            </label>
          ))}
        </div>
      )}
    </>
  );
}

function Question({ map, node }: { map: MindMap; node: MindNode }) {
  const [label, setLabel] = useState("");
  const whatIf = useApp((s) => s.whatIf[node.id] ?? "");
  const isQ = node.kind === "condition";
  const answers = map.edges.filter((e) => e.kind === "branch" && e.source === node.id && e.label).map((e) => e.label!);
  const answer = answerOf(map, node.id);
  return (
    <>
      <Cap>Question</Cap>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={isQ} data-testid="plan-is-question"
               onChange={(e) => setF(node.id, e.target.checked ? { kind: "condition" } : { kind: null, answer: null, decideBy: null })} />
        <CircleHelp size={15} style={{ color: "var(--q-doing)" }} /> This is a question: its answer decides which branch holds
      </label>
      {isQ && (
        <div className="mt-2 grid gap-2">
          <div className="text-[12.5px] font-semibold">Answer</div>
          <div className="seg flex-wrap" role="group" aria-label="Answer">
            <button className={!answer ? "on" : ""} aria-pressed={!answer} onClick={() => setF(node.id, { answer: null })}>Not decided</button>
            {answers.map((a) => (
              <button key={a} className={answer === a ? "on" : ""} aria-pressed={answer === a} data-testid={`answer-${a}`}
                      onClick={() => setF(node.id, { answer: a })}>{a}</button>
            ))}
          </div>
          <div className="text-[12.5px] font-semibold">What if (preview, not saved)</div>
          <div className="seg flex-wrap" role="group" aria-label="What if">
            <button className={!whatIf ? "on" : ""} aria-pressed={!whatIf} onClick={() => useApp.getState().setWhatIf(node.id, null)}>Off</button>
            {answers.map((a) => (
              <button key={a} className={whatIf === a ? "on" : ""} aria-pressed={whatIf === a} data-testid={`whatif-${a}`}
                      onClick={() => useApp.getState().setWhatIf(node.id, a)}>{a}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="field" style={{ height: 30 }} placeholder="New answer, e.g. yes" value={label} aria-label="New answer"
                   data-testid="plan-answer-new" onChange={(e) => setLabel(e.target.value)}
                   onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && label.trim()) { useApp.getState().apply((m) => cmd.addAnswer(m, node.id, label, sizeOf), { select: false }); setLabel(""); } }} />
            <button className="btn" style={{ height: 30 }} disabled={!label.trim()} data-testid="plan-answer-add"
                    onClick={() => { useApp.getState().apply((m) => cmd.addAnswer(m, node.id, label, sizeOf), { select: false }); setLabel(""); }}>
              <Plus size={14} /> Add</button>
          </div>
          <p className="text-[12px]" style={{ color: "var(--textMuted)" }}>
            Each answer is a branch; put the tasks for that case under it. Branches without an answer hold either way.
          </p>
          <label className="flex items-center gap-2 text-[13px]">Decide by
            <input type="date" className="field" style={{ width: 160, height: 30 }} value={node.decideBy ?? ""} data-testid="plan-decide-by"
                   aria-label="Decide by" onChange={(e) => setF(node.id, { decideBy: e.target.value || null })} />
          </label>
        </div>
      )}
    </>
  );
}

function Dates({ node }: { node: MindNode }) {
  const task = STATUS[node.status].counts_as != null;
  return (
    <>
      <Cap>Time</Cap>
      {!task && <p className="mb-2 text-[12px]" style={{ color: "var(--textMuted)" }}>Dates and estimates are for tasks; this is an idea.</p>}
      <div className="grid grid-cols-[110px_1fr] items-center gap-2 text-[13px]">
        <label htmlFor="plan-est">Estimate</label>
        <span className="flex items-center gap-2">
          <input id="plan-est" type="number" min={0} step={0.5} className="field" style={{ width: 90, height: 30 }} data-testid="plan-estimate"
                 value={node.estimate ?? ""} placeholder="—"
                 onChange={(e) => setF(node.id, { estimate: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} /> days
        </span>
        <label htmlFor="plan-due">Due</label>
        <input id="plan-due" type="date" className="field" style={{ width: 160, height: 30 }} value={node.due ?? ""} data-testid="plan-due"
               onChange={(e) => setF(node.id, { due: e.target.value || null })} />
        <label htmlFor="plan-after">Not before</label>
        <input id="plan-after" type="date" className="field" style={{ width: 160, height: 30 }} value={node.after ?? ""} data-testid="plan-after"
               onChange={(e) => setF(node.id, { after: e.target.value || null })} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--textMuted)" }}>
        <Unlock size={13} /> Estimates feed the critical path (dock → Route button).
      </p>
    </>
  );
}
