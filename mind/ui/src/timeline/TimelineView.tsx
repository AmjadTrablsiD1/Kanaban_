// The Timeline: every dated, open task from every map on one strip of days.
// A bar runs from its start (not-before date, or due minus estimate) to its due
// day; a question shows its decide-by day. Click a bar to open it in its map.
import { ArrowLeft, CalendarRange } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { C } from "../constants";
import { addDays, todayIso } from "../core/plan";
import { buildTimeline, type TimelineItem } from "../core/timeline";
import { planOptions, useApp } from "../store/app";

const LABEL_W = 240;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function TimelineView() {
  const maps = useApp((s) => s.maps);
  const order = useApp((s) => s.order);
  const whatIf = useApp((s) => s.whatIf);
  const back = useApp((s) => (s.returnMapId && s.maps[s.returnMapId] ? s.maps[s.returnMapId].name : null));
  const today = todayIso();
  const t = useMemo(() => buildTimeline(order.map((id) => maps[id]).filter(Boolean), today, planOptions()),
    [maps, order, whatIf, today]);   // eslint-disable-line react-hooks/exhaustive-deps
  const scroller = useRef<HTMLDivElement>(null);
  const D = C.timeline.day_px;

  // open at the strip's first day: it starts at the earliest dated task (or a week back),
  // so whatever is late is on screen first, never hidden behind the names
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = 0;
  }, [t.first]);

  const days = Array.from({ length: t.days }, (_, i) => addDays(t.first, i));
  const total = t.rows.reduce((a, r) => a + r.items.length, 0);
  const late = t.rows.reduce((a, r) => a + r.items.filter((i) => i.overdue).length, 0);
  const open = (it: TimelineItem) => {
    const s = useApp.getState();
    if (s.settings.view !== "2d") s.setSetting("view", "2d");
    s.focusNode(it.mapId, it.nodeId);
  };

  return (
    <div className="absolute inset-0 flex flex-col" data-testid="timeline-view">
      <div className="pointer-events-none relative z-10 flex items-start gap-3 p-3">
        <div className="glass pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[14px] pl-2 pr-4" data-chrome="top" data-testid="timeline-topbar">
          {back && (
            <button className="icon-btn" title={`Back to ${back} (W)`} aria-label={`Back to ${back}`}
                    onClick={() => { const s = useApp.getState(); if (s.returnMapId) s.openMap(s.returnMapId); }}>
              <ArrowLeft size={17} />
            </button>
          )}
          <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: "var(--surfaceRaised)" }}>
            <CalendarRange size={18} style={{ color: "var(--accent)" }} />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight">{C.timeline.title}</div>
            <div className="num text-[11.5px]" style={{ color: "var(--textMuted)" }} data-testid="timeline-summary">
              {total} dated · {late} late{t.undated ? ` · ${t.undated} open task${t.undated === 1 ? "" : "s"} without a date` : ""}
            </div>
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="grid flex-1 place-items-center px-6 text-center" data-testid="timeline-empty">
          <div className="max-w-[420px]">
            <h2 className="mb-2 text-[18px] font-semibold">Nothing dated yet</h2>
            <p className="text-[13.5px]" style={{ color: "var(--textMuted)" }}>
              Give a task a due date in its Plan (select it, press P). It shows up here with every other dated task, from every map.
            </p>
          </div>
        </div>
      ) : (
        <div ref={scroller} className="timeline-scroll relative min-h-0 flex-1 overflow-auto pb-6" data-testid="timeline-scroll">
          <div style={{ width: LABEL_W + t.days * D, position: "relative" }}>
            {/* the day ruler, sticky at the top */}
            <div className="timeline-ruler" style={{ paddingLeft: LABEL_W }}>
              {days.map((d, i) => {
                const [y, m, dd] = d.split("-").map(Number);
                const dow = new Date(y, m - 1, dd).getDay();
                return (
                  <div key={d} className={"timeline-day" + (dow === 0 || dow === 6 ? " weekend" : "") + (i === t.today ? " today" : "")}
                       style={{ width: D }} title={d}>
                    {(dd === 1 || i === 0) && <span className="timeline-month">{MONTHS[m - 1]}{m === 1 || i === 0 ? ` ${y}` : ""}</span>}
                    <span className="num">{dd}</span>
                  </div>
                );
              })}
            </div>
            {/* weekend shading and today's line run down the whole strip */}
            <div className="pointer-events-none absolute bottom-0 top-0" style={{ left: LABEL_W, width: t.days * D }} aria-hidden>
              {days.map((d, i) => {
                const [y, m, dd] = d.split("-").map(Number);
                const dow = new Date(y, m - 1, dd).getDay();
                return dow === 0 || dow === 6 ? <div key={d} className="timeline-weekend" style={{ left: i * D, width: D }} /> : null;
              })}
              <div className="timeline-now" style={{ left: t.today * D + D / 2 }} data-testid="timeline-today" />
            </div>
            {t.rows.map((row) => (
              <section key={row.mapId} className="timeline-group">
                <div className="timeline-map" style={{ width: LABEL_W }}>{row.name}</div>
                {row.items.map((it) => (
                  <div key={it.nodeId} className="timeline-row">
                    <button className="timeline-label" style={{ width: LABEL_W }} title={it.text} onClick={() => open(it)}>
                      <span className="truncate">{it.text}</span>
                    </button>
                    <button className={"timeline-bar" + (it.overdue ? " late" : "") + (it.question ? " question" : "") + (it.waiting ? " waiting" : "")}
                            data-testid="timeline-bar" data-node-id={it.nodeId}
                            style={{ left: LABEL_W + it.start * D + 2, width: (it.end - it.start + 1) * D - 4,
                                     ["--bar" as string]: it.question ? "var(--q-idea)" : `var(--q-${it.status === "doing" ? "doing" : "todo"})` }}
                            title={`${it.text} — ${it.question ? `decide by ${it.decideBy}` : it.due ? `due ${it.due}` : `from ${it.after}`}${it.overdue ? " (late)" : ""}${it.waiting ? " · waits for something" : ""}`}
                            onClick={() => open(it)}>
                      <span className="truncate">{it.text}</span>
                    </button>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
