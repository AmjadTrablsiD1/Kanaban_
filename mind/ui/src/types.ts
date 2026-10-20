import type { DepType, EdgeKind, Logic, StatusId } from "./constants";

export interface MindNode {
  id: string;
  text: string;
  note: string;
  status: StatusId;
  x: number;
  y: number;
  color: string | null;
  createdAt: string;
  doneAt?: string;
  // planning -- all optional; see shared/constants.json -> plan and core/plan.ts
  logic?: Logic;                    // how the children add up; absent = all of
  need?: number;                    // for "at least": how many
  chosen?: string;                  // for "one of": the child taken
  kind?: "condition";               // a question whose answer picks a branch
  answer?: string;                  // the label of the branch that holds
  decideBy?: string;                // YYYY-MM-DD
  estimate?: number;                // days of work
  due?: string;                     // YYYY-MM-DD
  after?: string;                   // YYYY-MM-DD: not before this day
  p3?: [number, number, number];    // where it was placed in 3D
  folded?: boolean;                 // its branch is folded away (2D, outline)
}

export interface MindEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
  dep?: DepType;                    // for "needs": which end waits for which (default finish -> start)
}

export interface Viewport { x: number; y: number; zoom: number }

export interface MindMap {
  id: string;
  name: string;
  emoji: string;
  createdAt: string;
  updatedAt: string;
  rev?: string;                     // the file's revision on disk (two PCs, one folder)
  viewport: Viewport;
  nodes: MindNode[];
  edges: MindEdge[];
}

export interface Settings {
  theme: string;
  saveOnExit: boolean;
  sidebarOpen: boolean;
  snapToGrid: boolean;
  showNotes: boolean;
  view: string;
  autoArrange: boolean;
  compact: boolean;
  hideDone: boolean;
  colorful: boolean;
  spacing: string;
  depMode: string;
  criticalBy: string;
  showCritical: boolean;
  layout3d: string;
  labels3d: string;
  remember3d: boolean;
  look: string;                     // "quiet" | "classic"
  minimapMode: string;              // "auto" | "always" | "never"
  doingLimit: number;
  doingMode: string;                // "off" | "warn" | "strict"
  classicEditable: boolean;         // the old board at /classic may be edited
  lighting: string;                 // "off" | "soft" | "neon": nodes and lines give off light
  activeBranch: boolean;            // the branch you select or point at lights up
  doingGlow: boolean;               // tasks in Doing pulse with light
  doneFades: boolean;               // done tasks lose their colour and light
}

export interface ServerState {
  instance: string;
  maps: MindMap[];
  activeMapId: string | null;
  centreName: string;
  settings: Settings;
  settingsFileExists: boolean;
  problems: string[];
  firstRunImport: Record<string, number> | null;
  info: { dataDir: string; defaultDataDir: string; version: string; kanbanPath: string; kanbanReadable: boolean };
}
