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
