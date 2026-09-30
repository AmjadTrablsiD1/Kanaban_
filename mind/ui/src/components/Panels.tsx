import { Check, FolderOpen, Info, RotateCcw, Save, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { C, choices, SPACING_ORDER, spacingLabel } from "../constants";
import type { Command } from "../commands/registry";
import * as cmd from "../core/commands";
import { useApp, type ToastKind } from "../store/app";
import { THEMES, THEME_NAMES } from "../theme";
import type { Settings } from "../types";
import { UpdateSettings } from "./Updates";

export function Drawer({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="glass fade-in fixed bottom-3 right-3 top-3 z-[61] flex w-[400px] max-w-[92vw] flex-col rounded-[18px]"
             role="dialog" aria-modal aria-label={title} data-testid={testId}>
        <div className="flex items-center border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="flex-1 text-[16px] font-semibold tracking-tight">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </>
  );
}

export const Cap = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] first:mt-0" style={{ color: "var(--textMuted)" }}>{children}</h3>
);

export function Toggle({ label, hint, on, onChange, testId }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="relative flex cursor-pointer items-start gap-3 rounded-[10px] px-2 py-2 hover:bg-[var(--surfaceRaised)]">
      <span className="flex-1">
        <span className="block text-[13.5px] font-medium">{label}</span>
        {hint && <span className="block text-[12px]" style={{ color: "var(--textMuted)" }}>{hint}</span>}
      </span>
      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span aria-hidden className="relative mt-0.5 h-5 w-9 flex-none rounded-full transition-colors"
            style={{ background: on ? "var(--accent)" : "var(--border)" }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full transition-all"
              style={{ left: on ? 18 : 2, background: on ? "var(--accentText)" : "var(--surface)" }} />
      </span>
    </label>
  );
}

/** A small preview of a theme: its canvas, a root and three branches in its own colours. */
function ThemeTile({ name, on, onPick }: { name: string; on: boolean; onPick: () => void }) {
  const t = THEMES[name];
  const c = (token: string) => t[token] as string;
  return (
    <button onClick={onPick} aria-pressed={on} data-testid={`theme-${name}`} title={t.label}
            className="flex flex-col items-center gap-1 rounded-[10px] p-1 text-[11px] font-medium"
            style={{ background: "transparent", cursor: "pointer", color: "var(--text)",
                     border: `2px solid ${on ? "var(--accent)" : "transparent"}` }}>
      <svg viewBox="0 0 48 32" width="100%" aria-hidden style={{ borderRadius: 7, display: "block", border: `1px solid ${c("border")}` }}>
        <rect width="48" height="32" fill={c("canvas")} />
        {t.palette.slice(0, 3).map((p, i) => (
          <g key={p}>
            <line x1="20" y1="16" x2="37" y2={7 + i * 9} stroke={p} strokeWidth="1.6" />
            <rect x="35" y={4.5 + i * 9} width="10" height="5" rx="2" fill={c("surface")} stroke={p} strokeWidth="1" />
          </g>
        ))}
        <rect x="5" y="12" width="17" height="8" rx="3" fill={c("rootA")} />
        <rect x="5" y="12" width="17" height="8" rx="3" fill={c("rootB")} opacity=".45" />
      </svg>
      <span className="max-w-full truncate">{t.label}</span>
    </button>
  );
}

/** One setting with a few named choices: a segmented control and the chosen one's hint. */
function Choice({ label, value, options, onPick, testId }:
  { label: string; value: string; options: { id: string; label: string; hint: string }[]; onPick: (v: string) => void; testId: string }) {
  const hint = options.find((o) => o.id === value)?.hint;
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[13.5px] font-medium">{label}</div>
      <div className="seg flex-wrap" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} className={value === o.id ? "on" : ""} aria-pressed={value === o.id} title={o.hint}
                  data-testid={`${testId}-${o.id}`} onClick={() => onPick(o.id)}>{o.label}</button>
        ))}
      </div>
      {hint && <p className="mt-1 text-[12px]" style={{ color: "var(--textMuted)" }}>{hint}</p>}
    </div>
  );
}

export function SettingsPanel({ commands }: { commands: Command[] }) {
  const open = useApp((s) => s.settingsOpen);
  const settings = useApp((s) => s.settings);
  const dirty = useApp((s) => s.settingsDirty);
  const fileExists = useApp((s) => s.settingsFileExists);
  const info = useApp((s) => s.info);
  if (!open) return null;
  const s = useApp.getState();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => s.setSetting(k, v);
  const groups = [...new Set(commands.filter((c) => c.keys).map((c) => c.group))];

  return (
    <Drawer title="Settings & shortcuts" onClose={() => s.set({ settingsOpen: false })} testId="settings">
      <Cap>Theme</Cap>
      <p className="-mt-1 mb-2 text-[12px]" style={{ color: "var(--textMuted)" }}>
        <span className="kbd">T</span> switches dark / light · <span className="kbd">⇧</span><span className="kbd">T</span> the next theme
      </p>
      {(["dark", "light"] as const).map((scheme) => (
        <div key={scheme} className="mb-2 grid grid-cols-5 gap-1.5" role="group" aria-label={`${scheme === "dark" ? "Dark" : "Light"} themes`}>
          {THEME_NAMES.filter((t) => THEMES[t].scheme === scheme).map((t) => (
            <ThemeTile key={t} name={t} on={settings.theme === t} onPick={() => set("theme", t)} />
          ))}
        </div>
      ))}
      <Toggle label="Colourful nodes" hint="Each node takes a soft tint of its branch colour." on={settings.colorful}
              onChange={(v) => set("colorful", v)} testId="set-colorful" />

      <Cap>Spacing</Cap>
      <div className="seg" role="group" aria-label="Spacing between nodes">
        {SPACING_ORDER.map((id) => (
          <button key={id} className={settings.spacing === id ? "on" : ""} aria-pressed={settings.spacing === id}
                  onClick={() => set("spacing", id)} data-testid={`spacing-${id}`} style={{ flex: 1, justifyContent: "center" }}>
            {spacingLabel(id)}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[12px]" style={{ color: "var(--textMuted)" }}>
        {settings.autoArrange ? "How far apart nodes sit, in 2D and 3D." : "Applies the next time you tidy up (L) — auto-arrange is off."}
      </p>

      <Cap>Planning</Cap>
      <Choice label="Dependency checks" value={settings.depMode} options={choices(C.plan.dep_modes)}
              onPick={(v) => set("depMode", v)} testId="dep-mode" />
      <Choice label="Critical path" value={settings.criticalBy} options={choices(C.plan.critical_by)}
              onPick={(v) => set("criticalBy", v)} testId="critical-by" />
      <Toggle label="Show the critical path" hint="The chain of work that sets the finish date glows (⇧C)." on={settings.showCritical}
              onChange={(v) => set("showCritical", v)} testId="set-critical" />

      <Cap>3D view</Cap>
      <Choice label="Layout" value={settings.layout3d} options={choices(C.view3d.layouts)}
              onPick={(v) => set("layout3d", v)} testId="layout3d" />
      <Choice label="Names" value={settings.labels3d} options={choices(C.view3d.labels)}
              onPick={(v) => set("labels3d", v)} testId="labels3d" />
      <Toggle label="Remember where I put nodes in 3D" hint="A node you drag stays there next time." on={settings.remember3d}
              onChange={(v) => set("remember3d", v)} testId="set-remember3d" />

      <Cap>Canvas</Cap>
      <Toggle label="Auto-arrange" hint="Branches stay tidy as you edit; dragging a node re-orders it." on={settings.autoArrange}
              onChange={(v) => set("autoArrange", v)} testId="set-auto" />
      <Toggle label="Compact nodes" hint="Smaller nodes, so more of a big map fits on screen." on={settings.compact}
              onChange={(v) => set("compact", v)} testId="set-compact" />
      <Toggle label="Show notes on nodes" hint="The first two lines of a note, under the title." on={settings.showNotes}
              onChange={(v) => set("showNotes", v)} />
      <Toggle label="Overview map" hint="The small map in the corner. M toggles it." on={settings.minimap}
              onChange={(v) => set("minimap", v)} />
      <Toggle label="Snap to grid" hint="Only when auto-arrange is off." on={settings.snapToGrid}
              onChange={(v) => set("snapToGrid", v)} />

      <Cap>Saving settings</Cap>
      <Toggle label="Save on exit" hint="Settings are written to settings.json as you change them and when you leave." on={settings.saveOnExit}
              onChange={(v) => set("saveOnExit", v)} testId="set-save-on-exit" />
      <div className="mt-2 flex gap-2">
        <button className="btn primary flex-1" onClick={() => s.saveSettingsNow()} data-testid="settings-save">
          <Save size={15} /> Save settings
        </button>
        <button className="btn danger" onClick={() => s.resetSettings()} data-testid="settings-reset"
                title="Delete settings.json and go back to the defaults"><RotateCcw size={15} /> Reset</button>
      </div>
      <p className="mt-2 text-[12px]" style={{ color: "var(--textMuted)" }} data-testid="settings-file-state">
        {dirty ? "You have unsaved setting changes." : fileExists ? "settings.json is up to date." : "Using the defaults — no settings.json yet."}
      </p>

      <Cap>Your data</Cap>
      <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--textMuted)" }}>
        Every map is saved automatically as its own file, with safety copies. The Kanaban board app is never changed.
      </p>
      <code className="mt-2 block break-all rounded-[8px] px-2 py-1.5 text-[11.5px]"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>
        {info?.dataDir}
      </code>
      <button className="btn mt-2" onClick={() => api.reveal().catch((e) => s.toast("error", (e as Error).message))}>
        <FolderOpen size={15} /> Open data folder
      </button>

      <UpdateSettings Cap={Cap} />

      <Cap>Keyboard</Cap>
      {groups.map((g) => (
        <div key={g} className="mb-3">
          <div className="mb-1 text-[12px] font-semibold">{g}</div>
          {commands.filter((c) => c.group === g && c.keys).map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-1 text-[12.5px]">
              <span className="flex-1" style={{ color: "var(--textMuted)" }}>{c.label}</span>
              <span className="flex gap-1">{c.keys!.map((k) => <span key={k} className="kbd">{k}</span>)}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="mb-3">
        <div className="mb-1 text-[12px] font-semibold">Mouse</div>
        {[["Drag from a node's dot onto another node", "connect"], ["Drag from a node's dot into empty space", "new child there"],
          ["Double-click empty canvas", "new idea"], ["Double-click a node", "rename"], ["Shift-drag", "select several"],
          ["Click a connection", "cut, flip, reverse, label"]].map(([a, b]) => (
          <div key={a} className="flex gap-2 py-1 text-[12.5px]">
            <span className="flex-1" style={{ color: "var(--textMuted)" }}>{a}</span><span>{b}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11.5px]" style={{ color: "var(--textMuted)" }}>{C.app.name} {info?.version}</p>
    </Drawer>
  );
}

export function NotePanel() {
  const nodeId = useApp((s) => s.noteFor);
  const node = useApp((s) => (s.noteFor ? s.active()?.nodes.find((n) => n.id === s.noteFor) : undefined));
  const [value, setValue] = useState("");
  const recorded = useRef(false);
  useEffect(() => { setValue(node?.note ?? ""); recorded.current = false; }, [nodeId]);   // eslint-disable-line
  if (!nodeId || !node) return null;
  const close = () => useApp.getState().set({ noteFor: null });
  return (
    <Drawer title="Note" onClose={close} testId="note-panel">
      <div className="mb-3 text-[14px] font-semibold">{node.text || "Untitled"}</div>
      <textarea className="field" style={{ height: "60vh", padding: 12, lineHeight: 1.55, resize: "none" }}
                value={value} autoFocus placeholder="Details, links, anything worth keeping…" aria-label="Note"
                data-testid="note-text"
                onChange={(e) => {
                  setValue(e.target.value);
                  const v = e.target.value;
                  useApp.getState().apply((m) => cmd.setNote(m, nodeId, v), { arrange: true, select: false, record: !recorded.current });
                  recorded.current = true;                      // one undo step per note session
                }}
                onKeyDown={(e) => e.stopPropagation()} />
      <p className="mt-2 text-[12px]" style={{ color: "var(--textMuted)" }}>Saved as you type.</p>
    </Drawer>
  );
}

const TOAST_ICON: Record<ToastKind, React.ReactNode> = {
  info: <Info size={16} />, success: <Check size={16} />, warn: <TriangleAlert size={16} />, error: <TriangleAlert size={16} />,
};
const TOAST_COLOR: Record<ToastKind, string> = { info: "var(--info)", success: "var(--success)", warn: "var(--warn)", error: "var(--danger)" };

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 z-[70] flex w-[380px] max-w-[92vw] flex-col gap-2" aria-live="polite"
         style={{ left: "calc(var(--sidebar-w, 0px) + 16px)" }}>
      {toasts.map((t) => (
        <div key={t.id} className="glass fade-in pointer-events-auto flex items-start gap-3 rounded-[12px] px-3.5 py-3 text-[13px]"
             role={t.kind === "error" ? "alert" : "status"} data-testid="toast" data-kind={t.kind}>
          <span style={{ color: TOAST_COLOR[t.kind], marginTop: 1 }}>{TOAST_ICON[t.kind]}</span>
          <span className="flex-1 leading-snug">{t.text}</span>
          {t.action && (
            <button className="btn" style={{ height: 26, padding: "0 9px" }}
                    onClick={() => { t.action!.run(); useApp.getState().dismissToast(t.id); }}>{t.action.label}</button>
          )}
          <button className="icon-btn sm" aria-label="Dismiss" onClick={() => useApp.getState().dismissToast(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/** Import: the Kanban's own board.json when macOS allows reading it, otherwise a file picker. */
export function useImport() {
  const file = useRef<HTMLInputElement>(null);
  const picker = (
    <input ref={file} type="file" accept=".json,application/json" hidden data-testid="import-file"
           onChange={(e) => { const f = e.target.files?.[0]; if (f) useApp.getState().importFile(f); e.target.value = ""; }} />
  );
  const run = async () => {
    const s = useApp.getState();
    if (s.info?.kanbanReadable) {
      const ok = await s.importDefaultKanban();
      if (ok) return;
    }
    s.toast("info", "Choose your Kanban's board.json to import it.");
    file.current?.click();
  };
  return { picker, run, choose: () => file.current?.click() };
}

export function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="relative z-[2] grid h-full place-items-center p-8" data-testid="empty-state">
      <div className="max-w-[440px] text-center">
        <img src="/favicon.svg" alt="" width={84} height={84} className="mx-auto mb-6" style={{ borderRadius: 20,
             boxShadow: "0 20px 60px color-mix(in srgb, var(--accent) 35%, transparent)" }} />
        <h1 className="mb-2 text-[26px] font-semibold tracking-tight">Start a mind map</h1>
        <p className="mb-7 text-[14px] leading-relaxed" style={{ color: "var(--textMuted)" }}>
          Put an idea in the middle, press <span className="kbd">Tab</span> to branch out, and mark tasks done as you go.
          Or bring your Kanban board in — every category becomes a map.
        </p>
        <div className="flex justify-center gap-3">
          <button className="btn primary" style={{ height: 40, padding: "0 18px" }} data-testid="empty-new"
                  onClick={() => useApp.getState().createMap()}>New mind map</button>
          <button className="btn" style={{ height: 40, padding: "0 18px" }} onClick={onImport} data-testid="empty-import">
            Import my Kanban
          </button>
        </div>
      </div>
    </div>
  );
}
