// Rule 1: every theme is hued, applied as CSS variables from shared/themes.json.
// Components use var(--surface), var(--accent)... and never a colour literal.
// Branch colours come from the theme too (its `palette`), so a map changes
// colour with the theme.
import themes from "../../shared/themes.json";
import { C, PALETTE } from "./constants";

export interface Theme {
  label: string;
  scheme: "dark" | "light";
  pair: string;                  // the same theme's other side: T switches to it
  palette: string[];             // branch colours, in order
  [token: string]: string | string[];
}
export const THEMES = Object.fromEntries(
  Object.entries(themes).filter(([k]) => !k.startsWith("_")),
) as unknown as Record<string, Theme>;
export const THEME_NAMES = Object.keys(THEMES);
const NOT_CSS = new Set(["label", "scheme", "pair", "palette"]);
const KEY = `${C.app.id}.theme`;

const themeOf = (name: string) => THEMES[name] ?? THEMES[C.ui.default_theme];

export function applyTheme(name: string): void {
  const theme = themeOf(name);
  const root = document.documentElement;
  for (const [token, value] of Object.entries(theme)) {
    if (NOT_CSS.has(token) || typeof value !== "string") continue;
    root.style.setProperty(`--${token}`, value);
  }
  root.style.colorScheme = theme.scheme;
  root.dataset.theme = name in THEMES ? name : C.ui.default_theme;
  try { localStorage.setItem(KEY, name); } catch { /* private mode */ }
}

/** The branch colours of a theme. */
export const paletteOf = (name: string): string[] => themeOf(name).palette ?? PALETTE;
/** The same theme's dark/light partner. */
export const pairOf = (name: string): string => themeOf(name).pair ?? C.ui.default_theme;
/** The theme after this one, dark ones first, then light, round and round. */
export function nextTheme(name: string): string {
  const list = [...THEME_NAMES.filter((n) => THEMES[n].scheme === "dark"),
                ...THEME_NAMES.filter((n) => THEMES[n].scheme === "light")];
  return list[(list.indexOf(name) + 1) % list.length];
}

/** First paint uses the last theme seen, so there is no flash before the server answers. */
export function earlyTheme(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in THEMES) return saved;
  } catch { /* ignore */ }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "daylight" : C.ui.default_theme;
}

export const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
