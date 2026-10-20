// The overview in the corner -- by default only while the map is bigger than the
// screen (Settings -> Look). "Always" and "Never" are the other two choices.
import { MiniMap, useStore, type Node, type ReactFlowState } from "@xyflow/react";
import { useApp } from "../store/app";

/** Is every node on screen right now? Read from React Flow's own store, so panning updates it. */
const allOnScreen = (s: ReactFlowState): boolean => {
  const [tx, ty, zoom] = s.transform;
  if (!s.width || !s.height || !s.nodes.length) return true;
  const x0 = -tx / zoom, y0 = -ty / zoom, x1 = (s.width - tx) / zoom, y1 = (s.height - ty) / zoom;
  for (const n of s.nodes) {
    if (n.hidden) continue;
    const w = n.measured?.width ?? n.width ?? 150;
    const h = n.measured?.height ?? n.height ?? 44;
    if (n.position.x < x0 || n.position.y < y0 || n.position.x + w > x1 || n.position.y + h > y1) return false;
  }
  return true;
};

export function SmartMiniMap({ nodeColor, maskColor }: { nodeColor: (n: Node) => string; maskColor: string }) {
  const mode = useApp((s) => s.settings.minimapMode);
  const fits = useStore(allOnScreen);
  if (mode === "never" || (mode === "auto" && fits)) return null;
  return (
    <MiniMap pannable zoomable nodeColor={nodeColor} nodeStrokeWidth={0} nodeBorderRadius={8}
             maskColor={maskColor} style={{ width: 176, height: 118 }} ariaLabel="Overview" />
  );
}
