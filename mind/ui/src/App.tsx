import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { RefreshCw } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { DoneCanvas } from "./canvas/DoneCanvas";
import { NextCanvas, TodoCanvas } from "./canvas/TodoCanvas";
import { MindCanvas } from "./canvas/MindCanvas";
import { buildCommands, handleKey } from "./commands/registry";
import { Dock, DoneTopBar, ModeBanner, NextTopBar, TodoTopBar, TopBar } from "./components/Chrome";
import { CommandPalette } from "./components/CommandPalette";
import { EmptyState, NotePanel, SettingsPanel, Toasts, useImport } from "./components/Panels";
import { PlanPanel } from "./components/PlanPanel";
import { Sidebar } from "./components/Sidebar";
import { checkForUpdates } from "./components/Updates";
import { C } from "./constants";
import { buildDoneMap } from "./core/done";
import { buildNextMap } from "./core/next";
import { buildTodoMap } from "./core/todo";
import { DONE_VIEW, flushOnExit, NEXT_VIEW, TODO_VIEW, useApp } from "./store/app";

const View3D = lazy(() => import("./three/View3D"));
const BoardView = lazy(() => import("./board/BoardView"));
let started = false;

export default function App() {
  const phase = useApp((s) => s.phase);
  const error = useApp((s) => s.loadError);

  useEffect(() => {
    if (!started) { started = true; useApp.getState().init(); checkForUpdates(); }
    const leave = () => flushOnExit();
    const hidden = () => { if (document.visibilityState === "hidden") flushOnExit(); };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", hidden); };
  }, []);

  if (phase === "loading") return <Loading />;
  if (phase === "failed") return <Failed message={error} />;
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

function Shell() {
  const rf = useReactFlow();
  const commands = useMemo(() => buildCommands(rf), [rf]);
  const map = useApp((s) => s.active());
  const doneView = useApp((s) => s.activeMapId === DONE_VIEW);
  const maps = useApp((s) => s.maps);
  const order = useApp((s) => s.order);
  // Built only while it is on screen, and rebuilt whenever any map changes.
  const done = useMemo(() => (doneView ? buildDoneMap(order.map((id) => maps[id]).filter(Boolean)) : null),
                       [doneView, maps, order]);
  const todoView = useApp((s) => s.activeMapId === TODO_VIEW);
  const centre = useApp((s) => s.centreName);
  const todo = useMemo(() => (todoView ? buildTodoMap(order.map((id) => maps[id]).filter(Boolean), centre) : null),
                       [todoView, maps, order, centre]);
  const nextView = useApp((s) => s.activeMapId === NEXT_VIEW);
  const whatIf = useApp((s) => s.whatIf);
  const criticalBy = useApp((s) => s.settings.criticalBy);
  const next = useMemo(() => (nextView ? buildNextMap(order.map((id) => maps[id]).filter(Boolean), { whatIf, criticalBy }) : null),
                       [nextView, maps, order, whatIf, criticalBy]);
  const view = useApp((s) => s.settings.view);
  const sidebarOpen = useApp((s) => s.settings.sidebarOpen);
  const compact = useApp((s) => s.settings.compact);
  const colorful = useApp((s) => s.settings.colorful);
  const imp = useImport();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKey(e, commands);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands]);

  useEffect(() => {
    const title = done ? C.done_view.title : todo ? C.todo_view.title : next ? C.next_view.title : map?.name;
    document.title = title ? `${title} — ${C.app.name}` : C.app.name;
  }, [map?.name, !!done, !!todo, !!next]);   // eslint-disable-line

  return (
    <div className="app" style={{ gridTemplateColumns: sidebarOpen ? "272px 1fr" : "0px 1fr",
                                  ["--sidebar-w" as string]: sidebarOpen ? "272px" : "0px" }}>
      <div className="min-w-0 overflow-hidden">{sidebarOpen && <Sidebar onImport={imp.run} />}</div>
      <main className={"stage" + (compact ? " compact" : "") + (colorful ? " colorful" : "")}>
        {done ? (
          view === "3d"
            ? <Suspense fallback={<Center text="Loading the 3D view…" />}><View3D map={done.map} /></Suspense>
            : <DoneCanvas key="done" done={done} />
        ) : next ? (
          view === "3d"
            ? <Suspense fallback={<Center text="Loading the 3D view…" />}><View3D map={next.map} /></Suspense>
            : <NextCanvas key="next" next={next} />
        ) : todo ? (
          view === "3d"
            ? <Suspense fallback={<Center text="Loading the 3D view…" />}><View3D map={todo.map} /></Suspense>
            : <TodoCanvas key="todo" todo={todo} />
        ) : map ? (
          view === "3d"
            ? <Suspense fallback={<Center text="Loading the 3D view…" />}><View3D map={map} /></Suspense>
            : view === "board"
              ? <Suspense fallback={<Center text="Loading the board…" />}><BoardView key={map.id} map={map} /></Suspense>
              : <MindCanvas key={map.id} map={map} />
        ) : <EmptyState onImport={imp.run} />}
        {done && <DoneTopBar done={done} />}
        {todo && <TodoTopBar todo={todo} />}
        {next && <NextTopBar next={next} />}
        {map && <TopBar map={map} />}
        {(map || done || todo || next) && (view === "2d" || ((done || todo || next) && view === "board")) && <Dock readOnly={!!(done || todo || next)} />}
        {map && view === "2d" && <ModeBanner />}
      </main>
      <CommandPalette commands={commands} />
      <SettingsPanel commands={commands} />
      <NotePanel />
      <PlanPanel />
      <Toasts />
      {imp.picker}
    </div>
  );
}

function Center({ text }: { text: string }) {
  return (
    <div className="relative z-[2] grid h-full place-items-center">
      <div className="flex items-center gap-3 text-[14px]" style={{ color: "var(--textMuted)" }}>
        <span className="h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />{text}
      </div>
    </div>
  );
}

function Loading() {
  // A skeleton of the real layout, so the first frame already looks like the app.
  return (
    <div className="app" style={{ gridTemplateColumns: "272px 1fr" }} aria-busy>
      <aside className="border-r p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="mb-6 h-8 w-40 animate-pulse rounded-[8px]" style={{ background: "var(--surfaceRaised)" }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="mb-3 h-10 animate-pulse rounded-[10px]" style={{ background: "var(--surfaceRaised)" }} />
        ))}
      </aside>
      <main className="stage"><Center text={`Opening ${C.app.name}…`} /></main>
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="grid h-full place-items-center p-8" style={{ background: "var(--bg)" }} role="alert">
      <div className="max-w-[440px] text-center">
        <h1 className="mb-2 text-[22px] font-semibold">{C.app.name} could not load your maps</h1>
        <p className="mb-6 text-[14px]" style={{ color: "var(--textMuted)" }}>{message}</p>
        <button className="btn primary" onClick={() => { started = false; location.reload(); }}>
          <RefreshCw size={15} /> Try again
        </button>
      </div>
    </div>
  );
}
