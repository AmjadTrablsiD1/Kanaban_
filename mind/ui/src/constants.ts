// Rule 11: the same shared/constants.json the Python core reads. Vite inlines
// it at build time, so there is exactly one file to edit and no drift.
import constants from "../../shared/constants.json";
import themes from "../../shared/themes.json";

export const C = constants;

export type StatusId = keyof typeof constants.statuses.items;
export type EdgeKind = keyof typeof constants.edges.kinds;

export const STATUS_ORDER = constants.statuses.order as StatusId[];
export const STATUS = constants.statuses.items as Record<
  StatusId,
  { label: string; key: string; counts_as: "open" | "done" | null; glyph: string }
>;

/** The accent colours a node can be given (theme-independent data). */
export const PALETTE: string[] = themes._palette;

export const API = (path: string) => `/api/${path.replace(/^\//, "")}`;

export type SpacingId = keyof typeof constants.layout.spacing.items;
export const SPACING_ORDER = constants.layout.spacing.order as SpacingId[];
const SPACING = constants.layout.spacing.items as Record<string, { label: string; factor: number }>;
export const spacingLabel = (id: SpacingId) => SPACING[id].label;
/** How far apart nodes sit, as a factor on the layout gaps; unknown ids are "normal". */
export const spacingFactor = (id: string | undefined) => SPACING[id ?? ""]?.factor ?? 1;

export type Logic = keyof typeof constants.plan.logic.items;
export type DepType = keyof typeof constants.plan.deps.items;
export const LOGIC_ORDER = constants.plan.logic.order as Logic[];
export const LOGIC = constants.plan.logic.items as Record<Logic, { label: string; short: string; hint: string }>;
export const DEP_ORDER = constants.plan.deps.order as DepType[];
export const DEPS = constants.plan.deps.items as Record<DepType, { label: string; short: string; hint: string }>;
/** A registry as an ordered list of {id, label, hint}: for the Settings choices. */
export const choices = (r: { order: string[]; items: Record<string, { label: string; hint: string }> }) =>
  r.order.map((id) => ({ id, ...r.items[id] }));
