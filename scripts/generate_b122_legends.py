#!/usr/bin/env python3
"""Generate the canonical SXSY-B122 physical legend kit and operator quick guide.

The repository settles two banks and 22 control identities, but not the physical
position of a control within its bank. Generated logical IDs therefore identify
documentation order only and MUST NOT be treated as B122 matrix coordinates.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence

from pypdf import PdfReader, PdfWriter
from reportlab import rl_config
from reportlab.lib.colors import Color, HexColor, black, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

rl_config.invariant = 1

ROOT = Path(__file__).resolve().parents[1]
CONTROL_MAP = ROOT / "packages/protocol/generated/b122-control-map.json"
DEFAULT_TEMPLATE = ROOT / "third-party/cyber_engineer/pure-template.pdf"
LEGEND_ROOT = ROOT / "legends/printable"
PDF_ROOT = ROOT / "output/pdf"

MODIFIERS = ("normal", "shift", "alt", "shift_alt", "ctrl", "ctrl_shift", "ctrl_alt", "ctrl_shift_alt")
SECONDARY_MODIFIERS = ("shift", "alt", "shift_alt", "ctrl_shift_alt")


@dataclass(frozen=True)
class Palette:
    name: str
    dark: Color
    mid: Color
    light: Color
    paper: Color
    accent: Color


PALETTES = {
    "ibm-blue": Palette("IBM TERMINAL BLUE", HexColor("#0B2E4F"), HexColor("#286A94"), HexColor("#A8D8E8"), white, HexColor("#68C4E8")),
    "command-orange": Palette("COMMAND ORANGE", HexColor("#211C1A"), HexColor("#C6451A"), HexColor("#F2B49B"), HexColor("#FFF7F0"), HexColor("#F05A28")),
    "monochrome": Palette("MONOCHROME", black, HexColor("#555555"), HexColor("#DDDDDD"), white, black),
}

DISPLAY_NAMES = {
    "REANCHOR": "RE-ANCHOR",
    "PROOF": "PROOF",
    "OPTION_PROVIDER": "OPTION PROVIDER",
    "PLAN_EXPANDER": "PLAN EXPANDER",
    "PLAN_APPROVAL": "PLAN APPROVAL",
    "HANDOFF": "HANDOFF",
    "FIND_BLOCKED_AGENT": "FIND BLOCKED",
    "FIND_FINISHED_AGENT": "FIND FINISHED",
    "AUTHORITY_REFRESH": "AUTHORITY REFRESH",
    "COUNCIL": "COUNCIL",
    "CLAUDE": "CLAUDE",
    "CHATGPT": "CHATGPT",
    "VSCODE": "VS CODE",
    "TERMINAL": "TERMINAL",
    "COMMIT": "COMMIT",
    "GITHUB": "GITHUB",
    "COMPOUND": "COMPOUND",
    "RUN": "RUN",
    "VOICE": "VOICE",
    "PIPELINE": "PIPELINE",
    "SHIELD": "SHIELD",
    "SANDBOX": "SANDBOX",
}

SHORT_ACTIONS = {
    ("PROOF", "shift"): "ADVERSARIAL REVIEW",
    ("OPTION_PROVIDER", "shift"): "DECISION PACKET",
    ("HANDOFF", "shift"): "QUEUE PACKET",
    ("HANDOFF", "alt"): "FOCUS PLANNER",
    ("HANDOFF", "shift_alt"): "QUEUE / FOCUS",
    ("FIND_BLOCKED_AGENT", "shift"): "BLOCKER QUEUE",
    ("FIND_FINISHED_AGENT", "shift"): "DONE QUEUE",
    ("AUTHORITY_REFRESH", "shift"): "REVIEWED BROADCAST",
    ("COUNCIL", "shift"): "AUTO PARTITION",
    ("COUNCIL", "alt"): "PROPOSE PLAN",
    ("CLAUDE", "shift"): "FRESH SURFACE",
    ("CLAUDE", "alt"): "CLAUDE CODE",
    ("CHATGPT", "shift"): "FRESH SURFACE",
    ("CHATGPT", "alt"): "CODEX TERMINAL",
    ("VSCODE", "shift"): "NEW WINDOW",
    ("TERMINAL", "shift"): "VS CODE TERM",
    ("COMMIT", "shift"): "PR UPSERT",
    ("COMMIT", "alt"): "PR MERGE - GATED",
    ("COMMIT", "shift_alt"): "DIRECT MAIN - GATED",
    ("GITHUB", "shift"): "CURRENT PR",
    ("GITHUB", "alt"): "ISSUES",
    ("GITHUB", "shift_alt"): "ACTIONS",
    ("COMPOUND", "shift"): "REFRESH LEARNING",
    ("COMPOUND", "alt"): "WORKFLOW PALETTE",
    ("COMPOUND", "shift_alt"): "LFG - GATED",
    ("RUN", "shift"): "DEBUG TARGET",
    ("RUN", "alt"): "STOP MANAGED RUN",
    ("RUN", "shift_alt"): "LAUNCH WEB APP",
    ("VOICE", "shift"): "SWITCH PROVIDER",
    ("VOICE", "alt"): "BIND SESSION",
    ("VOICE", "shift_alt"): "SESSION PICKER",
    ("PIPELINE", "shift"): "LOCAL GATE",
    ("PIPELINE", "alt"): "DIAGNOSE FAILURE",
    ("PIPELINE", "shift_alt"): "CLEAN REPRO",
    ("PIPELINE", "ctrl_shift_alt"): "REPAIR - GATED",
    ("SHIELD", "shift"): "DEEP AUDIT",
    ("SHIELD", "alt"): "SUPPLY CHAIN",
    ("SHIELD", "shift_alt"): "RELEASE SHIELD",
    ("SHIELD", "ctrl_shift_alt"): "CONTAIN - GATED",
    ("SANDBOX", "shift"): "REBUILD VENV",
    ("SANDBOX", "alt"): "FULL SANDBOX",
    ("SANDBOX", "shift_alt"): "REBUILD FULL",
    ("SANDBOX", "ctrl_shift_alt"): "QUARANTINE",
}

TOP_CENTERS = tuple((50.7 + 61.2 * column, row_y) for row_y in (617.0, 505.2) for column in range(9))
FULL_CENTERS = tuple((66.2 + 115.8 * column, row_y) for row_y in (325.4, 207.5, 90.0) for column in range(5))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Regenerate in a temporary directory and compare committed outputs.")
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    return parser.parse_args()


def load_manifest() -> dict:
    data = json.loads(CONTROL_MAP.read_text(encoding="utf-8"))
    controls = data.get("controls")
    assignments = data.get("assignments")
    if not isinstance(controls, list) or len(controls) != 22 or len(set(controls)) != 22:
        raise ValueError("The canonical control map must contain exactly 22 unique controls.")
    if set(controls) != set(DISPLAY_NAMES):
        raise ValueError("Display-name coverage does not exactly match the canonical controls.")
    if not isinstance(assignments, list) or len(assignments) != 65:
        raise ValueError("The canonical control map must contain exactly 65 settled assignments.")
    assigned = {(entry["control"], entry["modifier"]) for entry in assignments}
    if len(assigned) != 65:
        raise ValueError("Canonical assignments must be unique by control and modifier.")
    if not set(SHORT_ACTIONS).issubset(assigned):
        raise ValueError("A short physical legend refers to an unassigned canonical chord.")
    secondary_assigned = {(control, modifier) for control, modifier in assigned if modifier in SECONDARY_MODIFIERS}
    if set(SHORT_ACTIONS) != secondary_assigned:
        missing = sorted(secondary_assigned - set(SHORT_ACTIONS))
        extra = sorted(set(SHORT_ACTIONS) - secondary_assigned)
        raise ValueError(f"Secondary legend coverage drifted; missing={missing}, extra={extra}")
    return data


def records(data: Mapping) -> list[dict]:
    assignments = data["assignments"]
    by_chord = {(entry["control"], entry["modifier"]): entry for entry in assignments}
    output = []
    for index, control in enumerate(data["controls"]):
        bank = "agent-control-plane" if index < 10 else "workspace-command-bar"
        bank_index = index + 1 if index < 10 else index - 9
        logical_id = f"A{bank_index:02d}" if index < 10 else f"W{bank_index:02d}"
        output.append({
            "logicalId": logical_id,
            "physicalPositionStatus": "unassigned",
            "bank": bank,
            "control": control,
            "displayName": DISPLAY_NAMES[control],
            "assignments": [by_chord[(control, modifier)] for modifier in MODIFIERS if (control, modifier) in by_chord],
        })
    return output


def make_output_paths(root: Path) -> tuple[Path, Path]:
    legends = root / "legends/printable"
    pdfs = root / "output/pdf"
    (legends / "individual").mkdir(parents=True, exist_ok=True)
    pdfs.mkdir(parents=True, exist_ok=True)
    return legends, pdfs


def build_all(root: Path, template: Path) -> list[Path]:
    data = load_manifest()
    items = records(data)
    legends, pdfs = make_output_paths(root)
    manifest_path = legends / "legend-manifest.json"
    manifest_path.write_text(json.dumps({
        "schema": "sxsy-b122-legend-manifest/v1",
        "sourceSchema": data["schema"],
        "sourceProtocolVersion": data["protocolVersion"],
        "sourceManifestSha256": hashlib.sha256(CONTROL_MAP.read_bytes()).hexdigest(),
        "physicalPositionStatus": "unassigned-within-bank",
        "controls": items,
    }, indent=2) + "\n", encoding="utf-8")
    outputs = [manifest_path]
    for item in items:
        destination = legends / "individual" / f"{item['logicalId']}-{item['control'].lower().replace('_', '-')}.svg"
        destination.write_text(individual_svg(item, PALETTES["ibm-blue"]), encoding="utf-8")
        outputs.append(destination)
    for palette_name, palette in PALETTES.items():
        destination = pdfs / f"SXSY-B122-legends-{palette_name}.pdf"
        make_legend_pdf(template, destination, items, palette)
        outputs.append(destination)
    calibration = pdfs / "SXSY-B122-legends-calibration.pdf"
    make_calibration_pdf(calibration)
    outputs.append(calibration)
    quick_guide = pdfs / "SXSY-B122-operator-quick-guide.pdf"
    make_quick_guide(quick_guide, data, items)
    outputs.append(quick_guide)
    return outputs


def make_legend_pdf(template: Path, destination: Path, items: Sequence[Mapping], palette: Palette) -> None:
    if not template.is_file():
        raise FileNotFoundError(f"Template not found: {template}")
    source = PdfReader(str(template))
    media_box = source.pages[0].mediabox if len(source.pages) == 1 else None
    page_size = None if media_box is None else (round(float(media_box.width), 2), round(float(media_box.height), 2))
    if len(source.pages) != 1 or page_size != (595.28, 841.89):
        raise ValueError("The cyber_engineer source template must be a one-page A4 PDF.")
    writer = PdfWriter()
    for bank_name, bank_items in (("AGENT CONTROL PLANE", items[:10]), ("WORKSPACE COMMAND BAR", items[10:])):
        overlay_bytes = io.BytesIO()
        c = canvas.Canvas(overlay_bytes, pagesize=A4, invariant=1)
        c.setTitle(f"SXSY-B122 {bank_name} legends - {palette.name}")
        c.setAuthor("STRATHEX SWITCHYARD; template geometry by cyber_engineer")
        for item, center in zip(bank_items, TOP_CENTERS[: len(bank_items)], strict=True):
            draw_compact(c, center, item, palette)
        for item, center in zip(bank_items, FULL_CENTERS[: len(bank_items)], strict=True):
            draw_full(c, center, item, palette)
        c.setFillColor(palette.dark)
        c.setFont("Helvetica-Bold", 6.5)
        c.drawString(18, 24, f"SXSY-B122 / {bank_name} / {palette.name}")
        c.setFont("Helvetica", 6.2)
        c.drawRightString(577, 24, "LOGICAL ORDER ONLY - NOT MATRIX POSITION")
        c.save()
        overlay_bytes.seek(0)
        # merge_page mutates the page object, so use a fresh source page for
        # each bank rather than carrying the prior bank's overlay forward.
        page = PdfReader(str(template)).pages[0]
        page.merge_page(PdfReader(overlay_bytes).pages[0])
        writer.add_page(page)
        writer.pages[-1].compress_content_streams(level=9)
    writer.add_metadata({
        "/Title": f"SXSY-B122 canonical legends - {palette.name}",
        "/Author": "STRATHEX SWITCHYARD; template geometry by cyber_engineer",
        "/Subject": "Pre-hardware legend production; physical positions unassigned within each bank",
        "/Creator": "scripts/generate_b122_legends.py",
        "/Producer": "pypdf",
    })
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    with destination.open("wb") as stream:
        writer.write(stream)


def draw_compact(c: canvas.Canvas, center: tuple[float, float], item: Mapping, palette: Palette) -> None:
    x, y = center
    c.setFillColor(palette.dark)
    c.rect(x - 15.0, y - 18.2, 30.0, 36.4, fill=1, stroke=0)
    c.setFillColor(palette.accent)
    c.rect(x - 15.0, y + 12.6, 30.0, 5.6, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 5.0)
    c.drawCentredString(x, y + 14.0, item["logicalId"])
    draw_wrapped(c, item["displayName"], x, y - 2.0, 26.5, 17.5, "Helvetica-Bold", 6.5, white)


def draw_full(c: canvas.Canvas, center: tuple[float, float], item: Mapping, palette: Palette) -> None:
    x, y = center
    c.setFillColor(palette.dark)
    c.rect(x - 18.2, y - 18.2, 36.4, 36.4, fill=1, stroke=0)
    c.setFillColor(palette.accent)
    c.rect(x - 18.2, y + 12.7, 36.4, 5.5, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 4.7)
    c.drawCentredString(x, y + 14.0, item["logicalId"])
    draw_wrapped(c, item["displayName"], x, y - 2.5, 32.0, 18.5, "Helvetica-Bold", 6.3, white)
    panels = (
        ("shift", "S", x, y + 39.0, 49.0, 15.0, 0),
        ("alt", "A", x - 41.5, y, 44.0, 14.0, 90),
        ("shift_alt", "S+A", x + 41.5, y, 44.0, 14.0, -90),
        ("ctrl_shift_alt", "C+S+A", x, y - 39.0, 49.0, 15.0, 0),
    )
    for modifier, prefix, px, py, width, height, rotation in panels:
        action = SHORT_ACTIONS.get((item["control"], modifier), "RESERVED")
        c.saveState()
        c.translate(px, py)
        c.rotate(rotation)
        c.setFillColor(palette.light if action != "RESERVED" else HexColor("#EEEEEE"))
        c.roundRect(-width / 2, -height / 2, width, height, 2, fill=1, stroke=0)
        c.setFillColor(palette.dark if action != "RESERVED" else HexColor("#777777"))
        c.setFont("Helvetica-Bold", 4.2)
        c.drawCentredString(0, 2.1, prefix)
        draw_wrapped(c, action, 0, -3.0, width - 3.0, 6.5, "Helvetica-Bold", 3.8, palette.dark if action != "RESERVED" else HexColor("#777777"))
        c.restoreState()


def draw_wrapped(c: canvas.Canvas, text: str, x: float, y: float, width: float, height: float, font: str, max_size: float, color: Color) -> None:
    words = text.split()
    candidates: list[list[str]] = [[text]]
    if len(words) > 1:
        for split in range(1, len(words)):
            candidates.append([" ".join(words[:split]), " ".join(words[split:])])
    best: tuple[float, list[str]] | None = None
    for lines in candidates:
        size = max_size
        while size >= 3.0:
            line_height = size * 1.05
            if len(lines) * line_height <= height and max(stringWidth(line, font, size) for line in lines) <= width:
                if best is None or size > best[0]:
                    best = (size, lines)
                break
            size -= 0.2
    if best is None:
        raise ValueError(f"Legend cannot fit safely: {text}")
    size, lines = best
    c.setFillColor(color)
    c.setFont(font, size)
    line_height = size * 1.05
    start = y + (len(lines) - 1) * line_height / 2
    for index, line in enumerate(lines):
        c.drawCentredString(x, start - index * line_height, line)


def individual_svg(item: Mapping, palette: Palette) -> str:
    panels = []
    panel_specs = (("shift", "S", 60, 7, 80, 26), ("alt", "A", 4, 50, 50, 36), ("shift_alt", "S+A", 146, 50, 50, 36), ("ctrl_shift_alt", "C+S+A", 60, 107, 80, 26))
    for modifier, prefix, x, y, width, height in panel_specs:
        action = SHORT_ACTIONS.get((item["control"], modifier), "RESERVED")
        panels.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="4" fill="{hex_color(palette.light if action != "RESERVED" else HexColor("#EEEEEE"))}"/><text x="{x + width/2}" y="{y + 10}" class="mod">{prefix}</text><text x="{x + width/2}" y="{y + 20}" class="action">{escape_xml(action)}</text>')
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140" viewBox="0 0 200 140" role="img" aria-labelledby="title desc">
  <title id="title">{escape_xml(item['displayName'])} relegendable insert</title>
  <desc id="desc">Logical ID {item['logicalId']}; physical position remains unassigned within the {item['bank']}.</desc>
  <style>.id{{font:700 8px sans-serif;fill:#fff}}.name{{font:700 12px sans-serif;fill:#fff}}.mod{{font:700 7px sans-serif;fill:{hex_color(palette.dark)};text-anchor:middle}}.action{{font:700 5px sans-serif;fill:{hex_color(palette.dark)};text-anchor:middle}}</style>
  <rect x="60" y="40" width="80" height="60" rx="4" fill="{hex_color(palette.dark)}"/>
  <rect x="60" y="40" width="80" height="13" rx="4" fill="{hex_color(palette.accent)}"/>
  <text x="100" y="49" class="id" text-anchor="middle">{item['logicalId']}</text>
  <text x="100" y="74" class="name" text-anchor="middle">{escape_xml(item['displayName'])}</text>
  {''.join(panels)}
</svg>
'''


def make_calibration_pdf(destination: Path) -> None:
    c = canvas.Canvas(str(destination), pagesize=A4, invariant=1)
    width, height = A4
    c.setTitle("SXSY-B122 legend calibration sheet")
    c.setAuthor("STRATHEX SWITCHYARD; template method by cyber_engineer")
    c.setFillColor(HexColor("#0B2E4F"))
    c.rect(0, height - 72, width, 72, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 19)
    c.drawString(36, height - 40, "SXSY-B122 PRINT CALIBRATION")
    c.setFont("Helvetica", 8.5)
    c.drawString(36, height - 57, "Print A4 at actual size / 100%. Disable fit, shrink, and borderless scaling.")
    c.setFillColor(black)
    c.setFont("Helvetica", 10)
    c.drawString(36, height - 108, "Measure every box before cutting production legends. Each edge must match exactly.")
    sizes = (15, 30, 50, 100)
    y = height - 180
    for millimetres in sizes:
        points = millimetres * 72 / 25.4
        c.setLineWidth(0.8)
        c.rect(44, y - points, points, points, fill=0, stroke=1)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(54 + points, y - points / 2, f"{millimetres} mm x {millimetres} mm")
        y -= points + 42
    c.setFont("Helvetica-Bold", 10)
    c.drawString(330, height - 160, "PASS")
    c.setFont("Helvetica", 8)
    for index, line in enumerate((
        "A4 selected",
        "Actual size / 100%",
        "15 mm box measures 15 mm",
        "No clipped outer cut lines",
        "Printer output is sharp and dry",
    )):
        c.rect(330, height - 187 - index * 28, 11, 11, fill=0, stroke=1)
        c.drawString(350, height - 185 - index * 28, line)
    c.setFont("Helvetica", 7)
    c.drawString(36, 28, "Calibration method and 15 mm reference derived from the cyber_engineer relegendable-keycap template instructions.")
    c.save()


def make_quick_guide(destination: Path, data: Mapping, items: Sequence[Mapping]) -> None:
    c = canvas.Canvas(str(destination), pagesize=A4, invariant=1)
    width, height = A4
    c.setTitle("SXSY-B122 operator quick guide")
    c.setAuthor("STRATHEX SWITCHYARD")
    draw_guide_cover(c, width, height)
    c.showPage()
    draw_bank_guide(c, width, height, "AGENT CONTROL PLANE I", items[:5], data, 2)
    c.showPage()
    draw_bank_guide(c, width, height, "AGENT CONTROL PLANE II", items[5:10], data, 3)
    c.showPage()
    draw_bank_guide(c, width, height, "WORKSPACE COMMAND BAR I", items[10:16], data, 4)
    c.showPage()
    draw_bank_guide(c, width, height, "WORKSPACE COMMAND BAR II", items[16:], data, 5)
    c.showPage()
    draw_safety_guide(c, width, height)
    c.save()


def draw_guide_cover(c: canvas.Canvas, width: float, height: float) -> None:
    c.setFillColor(HexColor("#071A2A"))
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColor(HexColor("#F05A28"))
    c.rect(0, height - 20, width, 20, fill=1, stroke=0)
    c.rect(42, 142, 9, 470, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 29)
    c.drawString(75, height - 150, "STRATHEX SWITCHYARD")
    c.setFont("Helvetica-Bold", 51)
    c.drawString(75, height - 222, "SXSY-B122")
    c.setFillColor(HexColor("#68C4E8"))
    c.setFont("Helvetica-Bold", 17)
    c.drawString(77, height - 258, "OPERATOR QUICK GUIDE")
    c.setFillColor(white)
    c.setFont("Helvetica", 11)
    for index, line in enumerate((
        "22 controls. 65 settled chord behaviors.",
        "111 intentionally unassigned combinations.",
        "The keyboard signals intent. The host grants or refuses authority.",
    )):
        c.drawString(77, height - 315 - index * 24, line)
    c.setStrokeColor(HexColor("#68C4E8"))
    c.setLineWidth(1)
    c.line(77, 195, 510, 195)
    c.setFillColor(HexColor("#D6EAF2"))
    c.setFont("Helvetica", 8.5)
    c.drawString(77, 174, "PRE-HARDWARE EDITION - PHYSICAL POSITIONS AND DEVICE IDENTITY REMAIN UNCOMMISSIONED")
    footer(c, 1)


def draw_bank_guide(c: canvas.Canvas, width: float, height: float, title: str, items: Sequence[Mapping], data: Mapping, page: int) -> None:
    header(c, title)
    by_chord = {(entry["control"], entry["modifier"]): entry for entry in data["assignments"]}
    y = height - 92
    for item in items:
        normal = by_chord[(item["control"], "normal")]["summary"]
        secondary = []
        for modifier in SECONDARY_MODIFIERS:
            entry = by_chord.get((item["control"], modifier))
            if entry:
                label = {"shift": "S", "alt": "A", "shift_alt": "S+A", "ctrl_shift_alt": "C+S+A"}[modifier]
                gated = " [GATED]" if entry["capability"] == "disabled_pending_gates" else ""
                secondary.append(f"{label}: {entry['summary']}{gated}")
        block_height = 78 if secondary else 56
        c.setFillColor(HexColor("#F3F7F9"))
        c.roundRect(36, y - block_height + 8, width - 72, block_height, 6, fill=1, stroke=0)
        c.setFillColor(HexColor("#0B2E4F"))
        c.setFont("Helvetica-Bold", 10)
        c.drawString(47, y - 8, f"{item['logicalId']}  {item['displayName']}")
        draw_paragraph(c, f"N: {normal}", 47, y - 23, width - 94, 8.0, HexColor("#1A1A1A"))
        sy = y - 40
        for line in secondary:
            draw_paragraph(c, line, 47, sy, width - 94, 7.1, HexColor("#555555"))
            sy -= 12
        y -= block_height + 8
    footer(c, page)


def draw_safety_guide(c: canvas.Canvas, width: float, height: float) -> None:
    header(c, "OPERATING BOUNDARY")
    sections = (
        ("MODIFIERS", "N = normal. S = Shift. A = Alt. S+A = Shift+Alt. C+S+A = Ctrl+Shift+Alt. Ctrl, Ctrl+Shift, and Ctrl+Alt are intentionally unassigned on every control."),
        ("NO AMBIENT AUTHORITY", "A chord never authorizes a repository mutation, credential use, prompt submission, merge, push, force action, containment release, or agent approval. The mediated host must still resolve the exact target, authority, confirmation, and current evidence."),
        ("GATED CONTROLS", "Council automatic mode, PR merge, Direct Main, full lfg, Repair Mission, emergency containment, Full Sandbox, rebuild Full Sandbox, and Quarantine remain blocked until their acceptance evidence is current."),
        ("STOP MEANS STOP ONLY WHAT SXSY OWNS", "Managed Stop may target only a process registered and launched through SXSY. It must not infer a PID from a window title or terminate an unrelated terminal."),
        ("PHYSICAL COMMISSIONING", "Do not install a udev identity, flash firmware, or mark a hardware gate accepted until the actual B122 has been identified, its factory Vial configuration preserved, and all 176 chord slots plus transport lifecycle cases have been observed."),
        ("PRINTING", "Print A4 at actual size / 100%. Measure the 15 mm reference box. The A01/W01 identifiers are logical documentation order, not matrix coordinates or final within-bank positions."),
    )
    y = height - 105
    for heading, body in sections:
        c.setFillColor(HexColor("#F05A28"))
        c.setFont("Helvetica-Bold", 10)
        c.drawString(42, y, heading)
        y -= 16
        used = draw_paragraph(c, body, 42, y, width - 84, 8.3, HexColor("#222222"), leading=11)
        y -= used + 21
    footer(c, 6)


def header(c: canvas.Canvas, title: str) -> None:
    width, height = A4
    c.setFillColor(HexColor("#0B2E4F"))
    c.rect(0, height - 58, width, 58, fill=1, stroke=0)
    c.setFillColor(HexColor("#F05A28"))
    c.rect(0, height - 8, width, 8, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(36, height - 38, f"SXSY-B122 / {title}")


def footer(c: canvas.Canvas, page: int) -> None:
    width, _ = A4
    c.setFillColor(HexColor("#53636D"))
    c.setFont("Helvetica", 7)
    c.drawString(36, 22, "STRATHEX SWITCHYARD - PRE-HARDWARE OPERATOR QUICK GUIDE")
    c.drawRightString(width - 36, 22, str(page))


def draw_paragraph(c: canvas.Canvas, text: str, x: float, y: float, width: float, size: float, color: Color, leading: float | None = None) -> float:
    leading = leading or size * 1.25
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if line and stringWidth(candidate, "Helvetica", size) > width:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    c.setFillColor(color)
    c.setFont("Helvetica", size)
    for index, rendered in enumerate(lines):
        c.drawString(x, y - index * leading, rendered)
    return max(leading, len(lines) * leading)


def hex_color(color: Color) -> str:
    return "#%02X%02X%02X" % tuple(round(channel * 255) for channel in (color.red, color.green, color.blue))


def escape_xml(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def compare_tree(expected_root: Path, actual_root: Path, generated: Iterable[Path]) -> None:
    mismatches = []
    for expected in generated:
        relative = expected.relative_to(expected_root)
        actual = actual_root / relative
        if not actual.is_file() or expected.read_bytes() != actual.read_bytes():
            mismatches.append(str(relative))
    if mismatches:
        raise SystemExit("Generated legend outputs are stale or missing:\n" + "\n".join(mismatches))


def main() -> None:
    args = parse_args()
    if args.check:
        with tempfile.TemporaryDirectory(prefix="sxsy-b122-legends-") as directory:
            temporary_root = Path(directory)
            generated = build_all(temporary_root, args.template)
            compare_tree(temporary_root, ROOT, generated)
    else:
        build_all(ROOT, args.template)


if __name__ == "__main__":
    main()
