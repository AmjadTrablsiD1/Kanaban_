import { expect, type Locator, type Page } from "@playwright/test";

export const MOD = process.platform === "darwin" ? "Meta" : "Control";

export interface TreeNode { text: string; status: string; children: TreeNode[] }

/** What the server actually saved -- the truth, not what the screen claims. */
export async function saved(page: Page) {
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 8000 });
  const res = await page.request.get("/api/state");
  return res.json() as Promise<{ maps: any[]; activeMapId: string; settings: any }>;
}

export function mapByName(state: { maps: any[] }, name: string) {
  const m = state.maps.find((x) => x.name === name);
  if (!m) throw new Error(`no map called ${name}: ${state.maps.map((x) => x.name).join(", ")}`);
  return m;
}

/** A map's branch structure as nested {text, status, children}, children in top-to-bottom order. */
export function tree(map: any): TreeNode[] {
  const byId = new Map(map.nodes.map((n: any) => [n.id, n]));
  const kids = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of map.edges) if (e.kind === "branch") {
    (kids.get(e.source) ?? kids.set(e.source, []).get(e.source)!).push(e.target);
    hasParent.add(e.target);
  }
  const build = (id: string): TreeNode => {
    const n: any = byId.get(id);
    const children = (kids.get(id) ?? []).map(build).sort((a: any, b: any) => a._y - b._y);
    return { text: n.text, status: n.status, children, _y: n.y } as any;
  };
  const strip = (t: any): TreeNode => ({ text: t.text, status: t.status, children: t.children.map(strip) });
  return map.nodes.filter((n: any) => !hasParent.has(n.id)).map((n: any) => strip(build(n.id)));
}

export const node = (page: Page, text: string): Locator =>
  page.locator(".react-flow__node").filter({ has: page.locator(".mn-text", { hasText: new RegExp(`^${escape(text)}$`) }) });

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function select(page: Page, text: string) {
  await node(page, text).locator(".mn-text").click();
  await expect(node(page, text)).toHaveClass(/selected/);
}

/** Drag from a node's connection dot to a point, as a person would. */
export async function dragFromHandle(page: Page, from: string, to: { x: number; y: number }, side = "right") {
  const n = node(page, from);
  await n.hover();
  const h = n.locator(`.react-flow__handle-${side}:not(.mn-anchor)`);   // not the hidden edge anchor
  const b = (await h.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move((b.x + to.x) / 2, (b.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

export async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * A point on an edge that a click will actually reach: sampled along the drawn
 * path, skipping any stretch that runs under a node (a long link can cross one).
 */
export async function edgeMiddle(page: Page, edgeId: string) {
  return page.evaluate((id) => {
    const p = document.querySelector<SVGPathElement>(`path[data-edge-id="${id}"]`)!;
    const len = p.getTotalLength();
    const m = p.getScreenCTM()!;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8]) {
      const pt = p.getPointAtLength(len * t);
      const s = new DOMPoint(pt.x, pt.y).matrixTransform(m);
      const hit = document.elementFromPoint(s.x, s.y);
      if (hit?.closest(".react-flow__edge") && !hit.closest(".react-flow__node")) return { x: s.x, y: s.y };
    }
    throw new Error(`edge ${id} has no clickable point on screen`);
  }, edgeId);
}
