// New versions, when Kanaban Mind runs inside the Kanban board (kanban.py): the
// same updater the classic board had -- GitHub is asked, one click installs,
// the app restarts itself and this page reloads. Started on its own (main.py)
// there is no updater, and nothing here shows.
import { ArrowUpCircle, ExternalLink, RefreshCw, SquareKanban } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import { api, type UpdateInfo } from "../api";
import { C } from "../constants";
import { saveAllNow, useApp } from "../store/app";

type Phase = "idle" | "checking" | "installing" | "restarting";

const useUpdates = create<{ info: UpdateInfo | null; phase: Phase; open: boolean }>(() => ({
  info: null, phase: "idle", open: false,
}));

async function check(force: boolean) {
  useUpdates.setState({ phase: "checking" });
  try {
    const info = await api.update(force);
    useUpdates.setState({ info, phase: "idle" });
    return info;
  } catch {
    useUpdates.setState({ phase: "idle" });            // no updater here: stay invisible
    return null;
  }
}

async function waitForRestart(): Promise<boolean> {
  const u = C.updates;
  const started = Date.now();
  await new Promise((r) => setTimeout(r, u.restart_first_wait_ms));   // let it go down first
  while (Date.now() - started < u.restart_timeout_ms) {
    try { await api.whoami(); return true; } catch { /* still restarting */ }
    await new Promise((r) => setTimeout(r, u.restart_poll_ms));
  }
  return false;
}

export async function installUpdate() {
  const toast = useApp.getState().toast;
  useUpdates.setState({ phase: "installing" });
  if (!(await saveAllNow())) {
    useUpdates.setState({ phase: "idle" });
    toast("error", "Some changes could not be saved, so the update was not started. Nothing was lost.");
    return;
  }
  try {
    const out = await api.runUpdate();
    if (!out.restarting) {
      useUpdates.setState({ phase: "idle" });
      toast("info", out.output || "Already up to date.");
      return;
    }
  } catch (e) {
    useUpdates.setState({ phase: "idle" });
    toast("error", `The update did not install: ${(e as Error).message}`);
    return;
  }
  useUpdates.setState({ phase: "restarting", open: false });
  toast("info", "Installing and restarting... this page reloads by itself in a few seconds.");
  if (await waitForRestart()) location.reload();
  else {
    useUpdates.setState({ phase: "idle" });
    toast("error", "The app has not come back yet. Start it again, then reload this page.");
  }
}

/** Asks once when the app opens, like the classic board did. */
export const checkForUpdates = () => void check(false);

const ver = (v: string | null | undefined) => (v ? `v${v}` : "");

/** Top-right: only there when a newer version is waiting. */
export function UpdateChip() {
  const { info, phase, open } = useUpdates();
  if (!info?.updateAvailable) return null;
  const busy = phase === "installing" || phase === "restarting";
  return (
    <div className="relative">
      <button className="btn primary h-8 px-2.5 text-[12.5px]" data-testid="update-chip" aria-expanded={open}
              onClick={() => useUpdates.setState({ open: !open })} title="A newer version is ready to install">
        <ArrowUpCircle size={14} /> {ver(info.latest)} available
      </button>
      {open && (
        <div className="glass absolute right-0 top-10 z-50 w-[300px] rounded-[14px] p-4 text-[13px]" data-testid="update-panel"
             role="dialog" aria-label="Update">
          <div className="font-semibold">Version {info.latest} is ready</div>
          <div className="mt-0.5 text-[12px]" style={{ color: "var(--textMuted)" }}>You have {info.version}.</div>
          {info.notes && <p className="mt-2 leading-relaxed">{info.notes}</p>}
          <p className="mt-2 text-[12px]" style={{ color: "var(--textMuted)" }}>
            Your maps and your Kanban board are never replaced by an update.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn primary" data-testid="update-now" disabled={busy} onClick={() => void installUpdate()}>
              {busy ? "Installing..." : "Update now"}
            </button>
            <button className="btn" onClick={() => useUpdates.setState({ open: false })}>Later</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings: the version, a manual check, and the way back to the classic board. */
export function UpdateSettings({ Cap }: { Cap: (p: { children: React.ReactNode }) => React.ReactElement }) {
  const { info, phase } = useUpdates();
  const [checked, setChecked] = useState(false);
  if (!info || info.standalone) return null;
  return (
    <>
      <Cap>Version &amp; updates</Cap>
      <p className="text-[12.5px]" data-testid="update-status" style={{ color: "var(--textMuted)" }}>
        {info.updateAvailable ? `Version ${info.latest} is ready to install (you have ${info.version}).`
          : checked && info.offline ? `Version ${info.version}. GitHub could not be reached just now.`
          : checked ? `Version ${info.version} -- the newest there is.` : `Version ${info.version}.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {info.updateAvailable ? (
          <button className="btn primary" data-testid="update-now-settings" disabled={phase !== "idle"}
                  onClick={() => void installUpdate()}><ArrowUpCircle size={15} /> Update now</button>
        ) : (
          <button className="btn" data-testid="update-check" disabled={phase !== "idle"}
                  onClick={() => void check(true).then(() => setChecked(true))}>
            <RefreshCw size={15} /> {phase === "checking" ? "Checking..." : "Check for updates"}
          </button>
        )}
        <a className="btn" href={C.updates.classic_path} target="_blank" rel="noopener" data-testid="open-classic"
           title="The Kanban board as it was, with its own board.json -- not linked to the maps">
          <SquareKanban size={15} /> Classic board <ExternalLink size={12} />
        </a>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--textMuted)" }}>
        The classic board keeps its own file, exactly as before. Changes there do not reach the maps.
      </p>
    </>
  );
}
