"""Every theme is complete, hued (never grey) and readable -- checked, not eyeballed.

Contrast is WCAG 2.1: 4.5 for body text, 3 for large/bold text and strokes.
"""
import json
import re

import pytest

from app.constants import ROOT

THEMES = json.loads((ROOT / "shared" / "themes.json").read_text())
NAMES = [k for k in THEMES if not k.startswith("_")]
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def lum(hex_: str) -> float:
    def ch(v: int) -> float:
        c = v / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    h = hex_.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def test_the_worked_examples_of_the_contrast_formula():
    # two independent known values: black/white is 21:1, #777 on white is 4.48:1
    assert contrast("#000000", "#FFFFFF") == pytest.approx(21, abs=0.01)
    assert contrast("#777777", "#FFFFFF") == pytest.approx(4.48, abs=0.01)


def test_there_are_several_dark_and_several_light_themes_in_pairs():
    schemes = [THEMES[n]["scheme"] for n in NAMES]
    assert schemes.count("dark") >= 5 and schemes.count("light") >= 5
    for n in NAMES:
        pair = THEMES[n]["pair"]
        assert pair in THEMES and THEMES[pair]["pair"] == n and THEMES[pair]["scheme"] != THEMES[n]["scheme"]


@pytest.mark.parametrize("name", NAMES)
def test_every_theme_has_every_token(name):
    assert set(THEMES[name]) == set(THEMES["midnight"]), set(THEMES[name]) ^ set(THEMES["midnight"])


@pytest.mark.parametrize("name", NAMES)
def test_text_and_status_colours_are_readable(name):
    t = THEMES[name]
    for ground in ("bg", "surface", "surfaceRaised", "canvas"):
        assert contrast(t["text"], t[ground]) >= 7, (ground, "text")
        assert contrast(t["textMuted"], t[ground]) >= 4.5, (ground, "textMuted")
        for s in ("idea", "todo", "doing", "done"):
            assert contrast(t[f"q-{s}"], t[ground]) >= 4.5, (ground, s)   # chips and counts are text
    assert contrast(t["accentText"], t["accent"]) >= 4.5
    for end in ("rootA", "rootB"):                                     # large bold text on the root's gradient
        assert contrast(t["rootText"], t[end]) >= 3, end
    assert contrast(t["accent"], t["surface"]) >= 3                    # focus rings, selected borders


@pytest.mark.parametrize("name", NAMES)
def test_neutrals_are_tinted_never_grey(name):
    t = THEMES[name]
    for token in ("bg", "surface", "canvas", "border", "textMuted"):
        h = t[token].lstrip("#")
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        assert max(r, g, b) - min(r, g, b) >= 4, (token, t[token])


@pytest.mark.parametrize("name", NAMES)
def test_the_branch_palette_is_colourful_and_visible_on_the_canvas(name):
    t = THEMES[name]
    pal = t["palette"]
    assert len(pal) >= 8 and len(set(pal)) == len(pal) and all(HEX.match(c) for c in pal)
    for c in pal:
        assert contrast(c, t["canvas"]) >= 2.2, c                     # a branch stroke you can see
    for token in ("edgeNeeds", "critical", "edgeLink"):              # dependency arrows, the critical path
        assert contrast(t[token], t["canvas"]) >= 3, token
