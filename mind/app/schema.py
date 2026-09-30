"""Validate and repair a mind map.

A map comes from three untrusted places -- a file on disk that may have been
hand-edited, the browser, and an importer -- so everything that reads one goes
through `clean_map`. It never raises on bad *content*: it repairs what it can,
drops what it cannot, and reports every change so the UI can say what happened.
It only raises ValueError when the input is not a map at all.
"""
from __future__ import annotations

import math
import re
import secrets
import time
from datetime import datetime, timezone

from app.constants import C, EDGE_KINDS, STATUSES

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


_last_stamp = 0


def new_id(prefix: str = "") -> str:
    """Short, URL- and filename-safe, and strictly increasing within one run.

    Maps are listed by id when the workspace order does not mention them, so
    ids made in the same millisecond (one import makes six) must still sort in
    the order they were made -- a random tail alone would shuffle them.
    """
    global _last_stamp
    stamp = max(time.time_ns() // 1000, _last_stamp + 1)     # microseconds, never repeating
    _last_stamp = stamp
    return f"{prefix}{stamp:x}{secrets.token_hex(2)}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def valid_id(value: object) -> bool:
    return isinstance(value, str) and bool(ID_RE.match(value))


def _num(value: object, default: float = 0.0) -> float:
    if isinstance(value, bool):          # bool is an int in Python; never a coordinate
        return default
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return default


def _text(value: object, limit: int, default: str = "") -> str:
    if not isinstance(value, str):
        return default
    return value[:limit]


def _color(value: object) -> str | None:
    return value.upper() if isinstance(value, str) and HEX_RE.match(value) else None


def empty_map(name: str = "New map") -> dict:
    """A fresh map with one central idea, ready to grow."""
    root = {"id": new_id("n"), "text": name, "note": "", "status": "idea",
            "x": 0.0, "y": 0.0, "color": None, "createdAt": now_iso()}
    stamp = now_iso()
    return {"id": new_id("m"), "name": name, "emoji": "", "createdAt": stamp,
            "updatedAt": stamp, "viewport": {"x": 0.0, "y": 0.0, "zoom": 1.0},
            "nodes": [root], "edges": []}


def _clean_node(raw: object, seen: set[str], repairs: list[str]) -> dict | None:
    if not isinstance(raw, dict):
        repairs.append("dropped a node that was not an object")
        return None
    nid = raw.get("id")
    if not valid_id(nid) or nid in seen:
        # A node's id is what its edges point at: a duplicate cannot be told
        # apart from the original, so it is dropped rather than guessed at.
        repairs.append(f"dropped a node with a missing or duplicate id ({nid!r})")
        return None
    seen.add(nid)

    status = raw.get("status")
    if status not in STATUSES:
        repairs.append(f"node {nid}: unknown status {status!r} -> {C.statuses.default_new}")
        status = C.statuses.default_new

    node = {
        "id": nid,
        "text": _text(raw.get("text"), C.limits.max_text_len),
        "note": _text(raw.get("note"), C.limits.max_note_len),
        "status": status,
        "x": _num(raw.get("x")),
        "y": _num(raw.get("y")),
        "color": _color(raw.get("color")),
        "createdAt": _text(raw.get("createdAt"), 40) or now_iso(),
    }
    # A completion date only means something on a finished node.
    done_at = raw.get("doneAt")
    if status == "done" and isinstance(done_at, str) and done_at:
        node["doneAt"] = done_at[:40]
    _clean_plan(raw, node, repairs)
    return node


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _clean_plan(raw: dict, node: dict, repairs: list[str]) -> None:
    """The optional planning fields (constants.json -> plan). Bad values are dropped, never guessed."""
    nid = node["id"]
    logic = raw.get("logic")
    if logic is not None:
        if logic in C.plan.logic.order:
            node["logic"] = logic
        else:
            repairs.append(f"node {nid}: unknown logic {logic!r} dropped")
    need = raw.get("need")
    if isinstance(need, (int, float)) and not isinstance(need, bool) and math.isfinite(need) and need >= 1:
        node["need"] = int(need)
    if valid_id(raw.get("chosen")):
        node["chosen"] = raw["chosen"]
    if raw.get("kind") == "condition":
        node["kind"] = "condition"
    answer = _text(raw.get("answer"), C.limits.max_text_len).strip()
    if answer:
        node["answer"] = answer
    for key in ("decideBy", "due", "after"):
        value = raw.get(key)
        if isinstance(value, str) and DATE_RE.match(value):
            node[key] = value
        elif value is not None:
            repairs.append(f"node {nid}: {key} {value!r} is not a date (YYYY-MM-DD); dropped")
    est = raw.get("estimate")
    if isinstance(est, (int, float)) and not isinstance(est, bool) and math.isfinite(est) and 0 <= est <= C.plan.max_estimate_days:
        node["estimate"] = float(est)
    elif est is not None:
        repairs.append(f"node {nid}: estimate {est!r} dropped")
    p3 = raw.get("p3")
    if isinstance(p3, dict):  # the older app saved {x, y, z}
        p3 = [p3.get(k) for k in ("x", "y", "z")]
    if isinstance(p3, list) and len(p3) == 3 and all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in p3):
        node["p3"] = [float(v) for v in p3]


def _branch_would_cycle(children: dict[str, list[str]], parent: str, child: str) -> bool:
    """True if `child` already reaches `parent` through branches."""
    stack, seen = [child], set()
    while stack:
        cur = stack.pop()
        if cur == parent:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(children.get(cur, ()))
    return False


def _clean_edges(raw_edges: object, node_ids: set[str], repairs: list[str]) -> list[dict]:
    if not isinstance(raw_edges, list):
        if raw_edges is not None:
            repairs.append("edges was not a list; started with none")
        return []
    edges: list[dict] = []
    seen_ids: set[str] = set()
    seen_pairs: set[tuple[str, str, str]] = set()
    children: dict[str, list[str]] = {}
    waits: dict[str, list[str]] = {}          # needs: source -> the nodes waiting on it
    for raw in raw_edges:
        if not isinstance(raw, dict):
            repairs.append("dropped an edge that was not an object")
            continue
        src, dst = raw.get("source"), raw.get("target")
        if src not in node_ids or dst not in node_ids:
            repairs.append(f"dropped an edge to a node that does not exist ({src} -> {dst})")
            continue
        if src == dst:
            repairs.append(f"dropped an edge from node {src} to itself")
            continue
        kind = raw.get("kind")
        if kind not in EDGE_KINDS:
            kind = "link"          # an unknown kind must never grow the tree
        if kind == "branch" and _branch_would_cycle(children, src, dst):
            # A branch loop would make "everything under this node" infinite.
            repairs.append(f"branch {src} -> {dst} closed a loop; kept it as a link")
            kind = "link"
        if kind == "needs" and _branch_would_cycle(waits, src, dst):
            # A loop of waiting would block every task in it forever.
            repairs.append(f"needs {src} -> {dst} closed a loop of waiting; kept it as a link")
            kind = "link"
        key = (src, dst, kind)
        if key in seen_pairs:
            repairs.append(f"dropped a duplicate {kind} {src} -> {dst}")
            continue
        eid = raw.get("id")
        if not valid_id(eid) or eid in seen_ids:
            eid = new_id("e")
        seen_ids.add(eid)
        seen_pairs.add(key)
        if kind == "branch":
            children.setdefault(src, []).append(dst)
        if kind == "needs":
            waits.setdefault(src, []).append(dst)
        edge = {"id": eid, "source": src, "target": dst, "kind": kind}
        label = _text(raw.get("label"), C.limits.max_text_len)
        if label:
            edge["label"] = label
        if kind == "needs":
            dep = raw.get("dep")
            edge["dep"] = dep if dep in C.plan.deps.order else C.plan.deps.default
        edges.append(edge)
    return edges


def clean_map(raw: object) -> tuple[dict, list[str]]:
    """Return (a valid map, the list of repairs made to get there)."""
    if not isinstance(raw, dict):
        raise ValueError("a map must be a JSON object")
    repairs: list[str] = []

    mid = raw.get("id")
    if not valid_id(mid):
        mid = new_id("m")
        repairs.append("map had no usable id; gave it a new one")

    nodes_raw = raw.get("nodes")
    if not isinstance(nodes_raw, list):
        repairs.append("nodes was not a list; started empty")
        nodes_raw = []
    if len(nodes_raw) > C.limits.max_nodes_per_map:
        raise ValueError(f"a map may hold at most {C.limits.max_nodes_per_map} nodes")

    seen: set[str] = set()
    nodes = [n for n in (_clean_node(r, seen, repairs) for r in nodes_raw) if n]
    edges = _clean_edges(raw.get("edges"), seen, repairs)

    vp = raw.get("viewport") if isinstance(raw.get("viewport"), dict) else {}
    zoom = _num(vp.get("zoom"), 1.0)
    zoom = min(max(zoom, C.ui.zoom_min), C.ui.zoom_max)

    name = _text(raw.get("name"), C.limits.max_text_len).strip() or "Untitled map"
    stamp = now_iso()
    clean = {
        "id": mid,
        "name": name,
        "emoji": _text(raw.get("emoji"), 8),
        "createdAt": _text(raw.get("createdAt"), 40) or stamp,
        "updatedAt": _text(raw.get("updatedAt"), 40) or stamp,
        "viewport": {"x": _num(vp.get("x")), "y": _num(vp.get("y")), "zoom": zoom},
        "nodes": nodes,
        "edges": edges,
    }
    return clean, repairs


def counts(m: dict) -> dict[str, int]:
    """How many nodes carry each status -- for summaries, not for progress rings."""
    out = {s: 0 for s in STATUSES}
    for n in m.get("nodes", []):
        out[n["status"]] = out.get(n["status"], 0) + 1
    return out
