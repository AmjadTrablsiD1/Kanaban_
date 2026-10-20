// Settings -> Your data: where the maps live, and how they travel to another PC.
//   Export all maps   one file you carry over (USB, mail) and Import there
//   Maps folder       a synced folder (OneDrive, iCloud, Dropbox) both PCs point at
import { Download, FolderOpen, FolderSync, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../api";
import { C } from "../constants";
import { saveAllNow, useApp } from "../store/app";

export function DataSection({ Cap }: { Cap: (p: { children: React.ReactNode }) => React.ReactElement }) {
  const info = useApp((s) => s.info);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const s = useApp.getState();
  const own = !info || info.dataDir === info.defaultDataDir;

  const exportAll = async () => {
    await saveAllNow();                                  // the file holds what you see, not the last save
    try {
      const res = await fetch(api.exportUrl());
      if (!res.ok) throw new Error(`The server said ${res.status}.`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1]
        ?? C.sync.bundle_name.replace("{date}", new Date().toISOString().slice(0, 10));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      s.toast("success", `Saved ${name} to your downloads. On the other PC: Settings → Import maps.`);
    } catch (e) {
      s.toast("error", (e as Error).message);
    }
  };

  const switchTo = async (target: string) => {
    setBusy(true);
    try {
      if (!(await saveAllNow())) throw new Error("Some changes are not saved yet, so the folder was not changed.");
      const out = await api.switchFolder(target);
      const m = out.summary;
      s.toast("success", `Now using ${out.dataDir}. ${m.added} map${m.added === 1 ? "" : "s"} copied in, ${m.updated} brought up to date. Reloading…`);
      setTimeout(() => location.reload(), 1400);
    } catch (e) {
      s.toast("error", (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <Cap>Your data</Cap>
      <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--textMuted)" }}>
        Every map is saved automatically as its own file, with safety copies. The Kanaban board app is never changed.
      </p>
      <code className="mt-2 block break-all rounded-[8px] px-2 py-1.5 text-[11.5px]" data-testid="data-dir"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>
        {info?.dataDir}
      </code>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn" onClick={() => api.reveal().catch((e) => s.toast("error", (e as Error).message))}>
          <FolderOpen size={15} /> Open data folder
        </button>
      </div>

      <div className="mt-4 mb-1.5 text-[13.5px] font-medium">On another PC</div>
      <p className="text-[12px] leading-relaxed" style={{ color: "var(--textMuted)" }}>
        Export every map to one file and import it on the other PC. Maps both PCs have keep the newer version; the
        older one goes to backups, so nothing is lost.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn" onClick={exportAll} data-testid="export-all"><Download size={15} /> Export all maps</button>
        <button className="btn" onClick={() => file.current?.click()} data-testid="import-maps"><Upload size={15} /> Import maps…</button>
        <input ref={file} type="file" accept=".json,application/json" hidden data-testid="import-maps-file"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) s.importFile(f); e.target.value = ""; }} />
      </div>

      <div className="mt-4 mb-1.5 text-[13.5px] font-medium">Maps folder</div>
      <p className="text-[12px] leading-relaxed" style={{ color: "var(--textMuted)" }}>
        Point both PCs at the same synced folder (OneDrive, iCloud Drive, Dropbox) and changes on one appear on the
        other. Your maps are copied in; the folder you leave stays as it is. If both PCs change the same map before
        it syncs, both versions are kept.
      </p>
      <div className="mt-2 flex gap-2">
        <input className="field num flex-1" value={path} placeholder="Whole path, e.g. C:\Users\you\OneDrive\Kanaban Mind"
               aria-label="Maps folder" data-testid="data-dir-input" spellCheck={false}
               onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className="btn primary" disabled={busy || !path.trim()} data-testid="data-dir-use"
                onClick={() => switchTo(path.trim())}><FolderSync size={15} /> Use</button>
      </div>
      {!own && (
        <button className="btn mt-2" disabled={busy} data-testid="data-dir-default" onClick={() => switchTo("")}
                title={info?.defaultDataDir}>Back to this PC's own folder</button>
      )}
    </>
  );
}
