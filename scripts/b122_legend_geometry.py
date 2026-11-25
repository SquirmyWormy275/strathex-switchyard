"""Literal retained source geometry; SVG points use a top-left origin."""
from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from functools import lru_cache
from math import hypot
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "third-party/cyber_engineer"
PDF_SHA256 = "a16192b9c8cc7f1031527a9b5e60b25fe1aa8eaf1592b9be4d6abc97be4b6040"
SVG_SHA256 = "06bb168f1cf6b7cf4d2a84041626d032a62d41b41e1dff2377fcaa32355ec2b3"
PAGE_HEIGHT = 841.89


def points(element):
    d = element.attrib.get("d", "")
    if re.search(r"[^MLZmlz0-9.,\s-]", d) or not d.startswith("M "):
        return []
    values = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", d)]
    if len(values) % 2:
        return []
    result = list(zip(values[::2], values[1::2]))
    transform = element.attrib.get("transform")
    if transform:
        match = re.fullmatch(r"matrix\(([^)]+)\)", transform)
        if not match:
            raise ValueError("Unsupported retained source transform")
        a, b, c, e, dx, dy = map(float, match[1].replace(",", " ").split())
        result = [(a*x+c*y+dx, b*x+e*y+dy) for x, y in result]
    return result


def bounds(poly):
    return min(x for x, _ in poly), min(y for _, y in poly), max(x for x, _ in poly), max(y for _, y in poly)


def inside(point, polygon, tolerance=1e-6):
    signs = []
    for (ax, ay), (bx, by) in zip(polygon, polygon[1:] + polygon[:1]):
        cross = (bx-ax)*(point[1]-ay)-(by-ay)*(point[0]-ax)
        if abs(cross) > tolerance * hypot(bx-ax, by-ay):
            signs.append(cross > 0)
    return bool(signs) and (all(signs) or not any(signs))


def span_at(poly, y):
    xs = []
    for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
        if ay != by and min(ay, by) <= y <= max(ay, by):
            xs.append(ax + (y-ay)*(bx-ax)/(by-ay))
    if len(xs) < 2:
        raise ValueError("Retained panel has no safe horizontal span")
    return min(xs), max(xs)


def inset(poly, amount=.5):
    """Intersect parallel edges moved inward by an actual distance in points."""
    cx, cy = (sum(p[i] for p in poly)/len(poly) for i in (0, 1))
    edges = []
    for (ax, ay), (bx, by) in zip(poly, poly[1:]+poly[:1]):
        dx, dy = bx-ax, by-ay
        nx, ny = -dy/hypot(dx, dy), dx/hypot(dx, dy)
        if nx*(cx-ax)+ny*(cy-ay) < 0:
            nx, ny = -nx, -ny
        edges.append((ax+amount*nx, ay+amount*ny, dx, dy))
    result = []
    for (ax, ay, dx, dy), (bx, by, ex, ey) in zip(edges[-1:]+edges[:-1], edges):
        t = ((bx-ax)*ey-(by-ay)*ex)/(dx*ey-dy*ex)
        result.append((ax+t*dx, ay+t*dy))
    if not all(inside(p, poly) for p in result):
        raise ValueError("The retained source flap could not be inset safely")
    return result


@lru_cache(maxsize=1)
def geometry():
    source = (SOURCE / "pure-template.svg").read_bytes()
    faces = json.loads((SOURCE / "template-faces.json").read_text())
    if hashlib.sha256(source).hexdigest() != SVG_SHA256 or faces["sourceSvgSha256"] != SVG_SHA256 or len(faces["compact"]) != 18 or len(faces["full"]) != 15:
        raise ValueError("The retained source geometry changed; review its provenance first")
    elements = list(ET.fromstring(source))
    source_faces = [bounds(points(e)) for e in elements if e.attrib.get("fill") == "rgb(95.68634%, 95.608521%, 95.628357%)"]
    expected_faces = [(f["x"], f["y"], f["x"]+f["w"], f["y"]+f["h"]) for f in faces["compact"]+faces["full"]]
    signature = lambda rows: sorted(tuple(round(v, 5) for v in row) for row in rows)
    if faces.get("units") != "points" or len(source_faces) != 33 or signature(source_faces) != signature(expected_faces):
        raise ValueError("Face coordinates do not match the pinned source's literal rectangles")
    polygons = [points(e)[:4] for e in elements if e.attrib.get("fill") == "rgb(91.363525%, 91.20636%, 91.246033%)"]
    if len(polygons) != 60 or any(len(p) != 4 for p in polygons):
        raise ValueError("The source must contain exactly sixty full-insert flaps")
    clips = [points(e) for e in elements if e.attrib.get("fill") == "none" and e.attrib.get("stroke")]
    full = []
    for face in faces["full"]:
        x, y, w, h = (face[k] for k in ("x", "y", "w", "h"))
        panels = {}
        for poly in polygons:
            x0, y0, x1, y1 = bounds(poly)
            cx, cy = (x0+x1)/2, (y0+y1)/2
            if abs(cx-(x+w/2)) > 45 or abs(cy-(y+h/2)) > 55:
                continue
            if y1 < y and x0 < x+w/2 < x1:
                modifier, prefix = "shift", "S"
                lo, hi, prefix_y = y0+2, y0+13.5, y1-4
            elif y0 > y+h and x0 < x+w/2 < x1:
                modifier, prefix = "ctrl_shift_alt", "C+S+A"
                lo, hi, prefix_y = y1-13.5, y1-2, y0+5
            elif x1 < x and y0 < y+h/2 < y1:
                modifier, prefix = "alt", "A"
            elif x0 > x+w and y0 < y+h/2 < y1:
                modifier, prefix = "shift_alt", "S+A"
            else:
                continue
            if modifier in panels:
                raise ValueError("Ambiguous retained source panel")
            if modifier in ("shift", "ctrl_shift_alt"):
                spans = [span_at(poly, q) for q in (lo, hi)]
                left, right = max(p[0] for p in spans)+1, min(p[1] for p in spans)-1
                box = (left, lo, right-left, hi-lo)
                panel = dict(polygon=poly, prefix=prefix, prefixPoint=(x+w/2, prefix_y), actionBox=box, rotation=0)
            else:
                cut_points = [p for cut in clips if cut and all(inside(p, poly, .35) for p in cut) for p in cut]
                if len(cut_points) != 6:
                    raise ValueError("The source side-panel clip cuts did not verify")
                left = max(p[0] for p in cut_points)+1 if modifier == "alt" else x+w+1
                right = x-1 if modifier == "alt" else min(p[0] for p in cut_points)-1
                box = (left, y+1, right-left, h-2)
                panel = dict(polygon=poly, prefix=prefix, inkBox=box, clipPoints=cut_points, rotation=90 if modifier == "alt" else -90)
            box = panel.get("inkBox", panel.get("actionBox"))
            bx, by, bw, bh = box
            if bw <= 0 or bh <= 0 or not all(inside(p, poly) for p in ((bx, by), (bx+bw, by), (bx, by+bh), (bx+bw, by+bh))):
                raise ValueError("Legend ink would cross a retained source cut")
            panels[modifier] = panel
        if set(panels) != {"shift", "alt", "shift_alt", "ctrl_shift_alt"}:
            raise ValueError("A source full insert is missing a verified flap")
        full.append(dict(face=face, panels=panels))
    first = full[0]
    all_points = [p for panel in first["panels"].values() for p in panel["polygon"]]
    x0, y0, x1, y1 = bounds(all_points)
    crop = (x0-1, y0-1, x1-x0+2, y1-y0+2)
    source_paths = [e for e in elements if (p := points(e)) and all(crop[0] <= x <= crop[0]+crop[2] and crop[1] <= y <= crop[1]+crop[3] for x, y in p)]
    if len(source_paths) != 16:
        raise ValueError("The standalone insert must retain all sixteen original face/flap/clip paths")
    return dict(compact=faces["compact"], full=full, crop=crop, sourcePaths=source_paths)
