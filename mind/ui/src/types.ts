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
  viewport: Viewport;
  nodes: MindNode[];
  edges: MindEdge[];
}

export interface Settings {
  theme: string;
  saveOnExit: boolean;
  sidebarOpen: boolean;
  minimap: boolean;
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
  info: { dataDir: string; version: string; kanbanPath: string; kanbanReadable: boolean };
}
