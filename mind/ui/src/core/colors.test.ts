import { describe, expect, it } from "vitest";
import { INK, SWATCHES } from "../constants";
import { contrast, fillOf, inkOn, luminance } from "./colors";

describe("colour contrast", () => {
  it("matches the WCAG reference values", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 6);
    expect(luminance("#000000")).toBeCloseTo(0, 6);
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    // the classic worked example: #767676 is the lightest grey that passes on white
    expect(contrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  it("picks dark text on yellow and white text on deep indigo", () => {
    expect(inkOn("#EAB308")).toBe(INK.dark);
    expect(inkOn("#312E81")).toBe(INK.light);
  });

  it("every offered colour stays readable across its whole gradient", () => {
    for (const s of SWATCHES) {
      const f = fillOf(s);
      expect(contrast(f.a, f.ink), s).toBeGreaterThanOrEqual(4.5);
      expect(contrast(f.b, f.ink), s).toBeGreaterThanOrEqual(contrast(f.a, f.ink));
    }
  });

  it("any colour at all: the gradient never makes the text harder to read", () => {
    for (let i = 0; i < 400; i++) {
      const hex = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0").toUpperCase();
      const f = fillOf(hex);
      expect(contrast(f.a, f.ink)).toBeGreaterThanOrEqual(contrast(hex, f.ink) - 1e-9);
      expect(contrast(f.b, f.ink)).toBeGreaterThanOrEqual(contrast(f.a, f.ink) - 1e-9);
    }
  });
});

describe("glow fill (every node lit like the centre)", () => {
  it("every branch colour of every theme: text reads over both ends of its gradient", async () => {
    const { THEMES } = await import("../theme");
    const { glowFill } = await import("./colors");
    for (const [name, t] of Object.entries(THEMES)) {
      for (const c of t.palette) {
        const f = glowFill(c, t.palette);
        expect(Math.min(contrast(f.a, f.ink), contrast(f.b, f.ink)), `${name} ${c}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("runs from the branch colour to the next one of the palette; a colour off the palette still gets two tones", async () => {
    const { glowFill } = await import("./colors");
    const pal = ["#1E3A8A", "#7F1D1D", "#14532D"];
    const f = glowFill("#1E3A8A", pal);
    expect([f.a, f.b]).toEqual(["#1E3A8A", "#7F1D1D"]);          // dark enough for white text as they are
    expect(f.ink).toBe("#FFFFFF");
    const off = glowFill("#14532D", ["#000000"]);
    expect(off.a).not.toBe(off.b);
  });
});
