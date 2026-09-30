// Undo / redo, one stack pair per map. Maps are immutable, so a snapshot is
// just a reference -- unchanged nodes are shared between versions.
import type { MindMap } from "../types";

export class History {
  private past = new Map<string, MindMap[]>();
  private future = new Map<string, MindMap[]>();
  constructor(private limit: number) {}

  /** Call with the map as it was *before* an edit. */
  record(before: MindMap): void {
    const stack = this.past.get(before.id) ?? [];
    stack.push(before);
    if (stack.length > this.limit) stack.shift();
    this.past.set(before.id, stack);
    this.future.set(before.id, []);
  }

  undo(current: MindMap): MindMap | null {
    const prev = this.past.get(current.id)?.pop();
    if (!prev) return null;
    (this.future.get(current.id) ?? this.future.set(current.id, []).get(current.id)!).push(current);
    return prev;
  }

  redo(current: MindMap): MindMap | null {
    const next = this.future.get(current.id)?.pop();
    if (!next) return null;
    (this.past.get(current.id) ?? this.past.set(current.id, []).get(current.id)!).push(current);
    return next;
  }

  canUndo(mapId: string): boolean { return (this.past.get(mapId)?.length ?? 0) > 0; }
  canRedo(mapId: string): boolean { return (this.future.get(mapId)?.length ?? 0) > 0; }
  forget(mapId: string): void { this.past.delete(mapId); this.future.delete(mapId); }
  dropRedo(mapId: string): void { this.future.set(mapId, []); }
}
