// Quick capture (I): one line to the Inbox, from anywhere, without deciding where
// it belongs yet. Enter adds and stays open for the next line; Esc closes.
import { Inbox } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { C } from "../constants";
import { useApp } from "../store/app";

export function Capture() {
  const open = useApp((s) => s.captureOpen);
  const [text, setText] = useState("");
  const [added, setAdded] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setAdded(0); setText(""); setTimeout(() => input.current?.focus()); } }, [open]);
  if (!open) return null;
  const close = () => useApp.getState().set({ captureOpen: false });
  const add = async () => {
    if (!text.trim()) return;
    if (await useApp.getState().capture(text)) { setAdded((n) => n + 1); setText(""); }
  };
  const goInbox = () => {
    const s = useApp.getState();
    const inbox = s.order.find((id) => s.maps[id]?.name === C.inbox.name);
    close();
    if (inbox) s.openMap(inbox);
  };
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="glass fade-in fixed left-1/2 top-[14vh] z-[61] w-[520px] max-w-[92vw] -translate-x-1/2 rounded-[16px] p-3"
           role="dialog" aria-modal aria-label="Quick capture" data-testid="capture">
        <div className="flex items-center gap-2.5">
          <Inbox size={18} style={{ color: "var(--accent)" }} />
          <input ref={input} className="field flex-1" style={{ height: 40, fontSize: 15 }} value={text} data-testid="capture-input"
                 placeholder={`A task for later — Enter puts it in “${C.inbox.name}”`} aria-label="Task"
                 maxLength={C.limits.max_text_len}
                 onChange={(e) => setText(e.target.value)}
                 onKeyDown={(e) => {
                   e.stopPropagation();
                   if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void add(); }
                   if (e.key === "Escape") { e.preventDefault(); close(); }
                 }} />
        </div>
        <div className="mt-2 flex items-center gap-2 px-1 text-[12px]" style={{ color: "var(--textMuted)" }}>
          <span className="flex-1" data-testid="capture-count">
            {added ? `${added} added to ${C.inbox.name}.` : "Enter adds it and keeps this open for the next one · Esc closes"}
          </span>
          {added > 0 && <button className="btn ghost" style={{ height: 26 }} onClick={goInbox}>Open {C.inbox.name}</button>}
        </div>
      </div>
    </>
  );
}
