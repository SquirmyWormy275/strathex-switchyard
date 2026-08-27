from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

import pdfplumber
import pypdfium2 as pdfium
from pypdf import PdfReader
from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    Image,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

rl_config.invariant = 1

TITLE = "SXSY-B122 Operator, Technical, and Troubleshooting Manual"
PAGE_WIDTH, PAGE_HEIGHT = letter
MARGIN = inch
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs: Any) -> None:
        super().__init__(filename, **kwargs)
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="manual-frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(
            [PageTemplate(id="manual", frames=[frame], onPage=draw_page_chrome)]
        )
        self._heading_sequence = 0

    def beforeDocument(self) -> None:
        self._heading_sequence = 0

    def afterFlowable(self, flowable: Any) -> None:
        if not isinstance(flowable, Paragraph):
            return
        level = getattr(flowable, "_b122_heading_level", None)
        if level is None:
            return
        self._heading_sequence += 1
        key = f"heading-{self._heading_sequence}"
        text = flowable.getPlainText()
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level - 1, closed=False)
        self.notify("TOCEntry", (level, text, self.page, key))


def draw_page_chrome(canvas: Any, document: BaseDocTemplate) -> None:
    canvas.saveState()
    canvas.setTitle(TITLE)
    canvas.setAuthor("STRATHEX SWITCHYARD")
    canvas.setSubject(
        "Software-only B122 operation, installation, recovery, and printable reference"
    )
    if document.page == 1:
        canvas.restoreState()
        return
    canvas.setStrokeColor(colors.HexColor("#cbd5e1"))
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, PAGE_HEIGHT - 52, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 52)
    canvas.line(MARGIN, 50, PAGE_WIDTH - MARGIN, 50)
    canvas.setFillColor(colors.HexColor("#475569"))
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(MARGIN, PAGE_HEIGHT - 43, "STRATHEX SWITCHYARD / SXSY-B122")
    canvas.drawRightString(
        PAGE_WIDTH - MARGIN,
        PAGE_HEIGHT - 43,
        "SOFTWARE-ONLY / ALL 27 GATES NOT ACCEPTED",
    )
    canvas.drawString(MARGIN, 37, "Document version 1.0.0")
    canvas.drawRightString(PAGE_WIDTH - MARGIN, 37, f"Page {document.page}")
    canvas.restoreState()


def build_styles() -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle(
            "B122CoverTitle",
            parent=sample["Title"],
            fontName="Helvetica-Bold",
            fontSize=30,
            leading=35,
            textColor=colors.HexColor("#0f172a"),
            alignment=TA_LEFT,
            spaceAfter=22,
        ),
        "cover_kicker": ParagraphStyle(
            "B122CoverKicker",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#2563eb"),
            spaceAfter=12,
        ),
        "cover_status": ParagraphStyle(
            "B122CoverStatus",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=16,
            textColor=colors.HexColor("#b91c1c"),
            spaceBefore=18,
            spaceAfter=10,
        ),
        "body": ParagraphStyle(
            "B122Body",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=9.2,
            leading=13.2,
            textColor=colors.HexColor("#111827"),
            alignment=TA_LEFT,
            spaceAfter=6,
            allowWidows=0,
            allowOrphans=0,
        ),
        "quote": ParagraphStyle(
            "B122Quote",
            parent=sample["BodyText"],
            fontName="Helvetica-Oblique",
            fontSize=8.8,
            leading=12.5,
            textColor=colors.HexColor("#334155"),
            leftIndent=12,
            rightIndent=12,
            borderColor=colors.HexColor("#94a3b8"),
            borderWidth=0.75,
            borderPadding=8,
            backColor=colors.HexColor("#f8fafc"),
            spaceAfter=8,
        ),
        "h1": ParagraphStyle(
            "B122Heading1",
            parent=sample["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=19,
            leading=23,
            textColor=colors.HexColor("#0f172a"),
            spaceBefore=0,
            spaceAfter=12,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "B122Heading2",
            parent=sample["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13.5,
            leading=17,
            textColor=colors.HexColor("#1e3a5f"),
            spaceBefore=12,
            spaceAfter=7,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "B122Heading3",
            parent=sample["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#334155"),
            spaceBefore=9,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "list": ParagraphStyle(
            "B122List",
            parent=sample["BodyText"],
            fontName="Helvetica",
            fontSize=9.1,
            leading=13,
            textColor=colors.HexColor("#111827"),
            leftIndent=16,
            bulletIndent=2,
            spaceAfter=2,
        ),
        "code": ParagraphStyle(
            "B122Code",
            parent=sample["Code"],
            fontName="Courier",
            fontSize=7.4,
            leading=10.2,
            textColor=colors.HexColor("#0f172a"),
            leftIndent=8,
            rightIndent=8,
            borderColor=colors.HexColor("#cbd5e1"),
            borderWidth=0.5,
            borderPadding=8,
            backColor=colors.HexColor("#f8fafc"),
            spaceBefore=3,
            spaceAfter=8,
        ),
        "table_header": ParagraphStyle(
            "B122TableHeader",
            parent=sample["Normal"],
            fontName="Helvetica-Bold",
            fontSize=7,
            leading=9,
            textColor=colors.white,
            wordWrap="CJK",
        ),
        "table_cell": ParagraphStyle(
            "B122TableCell",
            parent=sample["Normal"],
            fontName="Helvetica",
            fontSize=6.5,
            leading=8.5,
            textColor=colors.HexColor("#111827"),
            wordWrap="CJK",
        ),
        "toc_title": ParagraphStyle(
            "B122TocTitle",
            parent=sample["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=24,
            textColor=colors.HexColor("#0f172a"),
            spaceAfter=18,
        ),
    }


def format_inline(value: str) -> str:
    value = value.strip()
    value = re.sub(r"<!--.*?-->", "", value)
    value = value.replace("<br>", "\u0000BR\u0000").replace("<br/>", "\u0000BR\u0000")
    escaped = html.escape(value, quote=True).replace("\u0000BR\u0000", "<br/>")
    escaped = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda match: f'<font color="#1d4ed8"><u>{match.group(1)}</u></font>',
        escaped,
    )
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", escaped)
    escaped = re.sub(
        r"`([^`]+)`",
        r'<font name="Courier" color="#0f172a">\1</font>',
        escaped,
    )
    return escaped


def heading(text: str, level: int, styles: dict[str, ParagraphStyle]) -> Paragraph:
    paragraph = Paragraph(format_inline(text), styles[f"h{min(level, 3)}"])
    paragraph._b122_heading_level = min(level, 3)
    return paragraph


def table_widths(column_count: int, header: list[str]) -> list[float]:
    joined = " ".join(header).lower()
    if column_count == 4 and "bank / key / chord" in joined:
        return [22, 94, 176, 176]
    if column_count == 4:
        return [40, 112, 154, 162]
    if column_count == 3:
        return [112, 160, 196]
    if column_count == 2:
        return [132, 336]
    return [CONTENT_WIDTH / column_count for _ in range(column_count)]


def render_table(rows: list[list[str]], styles: dict[str, ParagraphStyle]) -> LongTable:
    column_count = max(len(row) for row in rows)
    normalized = [row + [""] * (column_count - len(row)) for row in rows]
    data: list[list[Paragraph]] = []
    for row_index, row in enumerate(normalized):
        style = styles["table_header"] if row_index == 0 else styles["table_cell"]
        data.append([Paragraph(format_inline(cell), style) for cell in row])
    table = LongTable(
        data,
        colWidths=table_widths(column_count, normalized[0]),
        repeatRows=1,
        splitByRow=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#94a3b8")),
                (
                    "ROWBACKGROUNDS",
                    (0, 1),
                    (-1, -1),
                    [colors.white, colors.HexColor("#f8fafc")],
                ),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    table.spaceBefore = 4
    table.spaceAfter = 10
    return table


def parse_markdown(markdown_path: Path, styles: dict[str, ParagraphStyle]) -> list[Any]:
    lines = markdown_path.read_text(encoding="utf-8").splitlines()
    first_chapter = next(
        index
        for index, line in enumerate(lines)
        if line.startswith("# 1. Read This First")
    )
    lines = lines[first_chapter:]
    story: list[Any] = []
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        if paragraph_lines:
            story.append(
                Paragraph(format_inline(" ".join(paragraph_lines)), styles["body"])
            )
            paragraph_lines.clear()

    index = 0
    first_h1 = True
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            index += 1
            continue
        if stripped.startswith("<!--"):
            flush_paragraph()
            index += 1
            continue
        heading_match = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading_match:
            flush_paragraph()
            level = len(heading_match.group(1))
            if level == 1:
                if not first_h1:
                    story.append(CondPageBreak(2.2 * inch))
                first_h1 = False
            story.append(heading(heading_match.group(2), level, styles))
            index += 1
            continue
        if stripped.startswith("```"):
            flush_paragraph()
            code_lines: list[str] = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index].rstrip())
                index += 1
            if index >= len(lines):
                raise ValueError("The manual contains an unterminated code fence.")
            story.append(
                Preformatted("\n".join(code_lines), styles["code"], maxLineLength=95)
            )
            index += 1
            continue
        image_match = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]+\})?$", stripped)
        if image_match:
            flush_paragraph()
            image_path = (markdown_path.parent / image_match.group(2)).resolve()
            if image_path.suffix.lower() == ".svg":
                image_path = image_path.with_suffix(".png")
            if not image_path.is_file():
                raise FileNotFoundError(f"Manual image is missing: {image_path}")
            raster = Image(str(image_path))
            raster.drawWidth = CONTENT_WIDTH
            raster.drawHeight = CONTENT_WIDTH * 9 / 16
            raster.hAlign = "CENTER"
            story.extend([raster, Spacer(1, 8)])
            index += 1
            continue
        if stripped.startswith("|"):
            flush_paragraph()
            table_lines: list[str] = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index].strip())
                index += 1
            parsed = [
                [cell.strip() for cell in row.strip("|").split("|")]
                for row in table_lines
            ]
            parsed = [
                row
                for row_index, row in enumerate(parsed)
                if row_index != 1
                or not all(re.fullmatch(r":?-{3,}:?", cell) for cell in row)
            ]
            if len(parsed) < 2:
                raise ValueError("A Markdown table has no data rows.")
            story.append(render_table(parsed, styles))
            continue
        if stripped.startswith(">"):
            flush_paragraph()
            quote_lines: list[str] = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_lines.append(lines[index].strip()[1:].strip())
                index += 1
            story.append(
                Paragraph(format_inline(" ".join(quote_lines)), styles["quote"])
            )
            continue
        list_match = re.match(r"^([-*]|\d+\.)\s+(.+)$", stripped)
        if list_match:
            flush_paragraph()
            ordered = list_match.group(1)[0].isdigit()
            while index < len(lines):
                candidate = re.match(r"^([-*]|\d+\.)\s+(.+)$", lines[index].strip())
                if not candidate or candidate.group(1)[0].isdigit() != ordered:
                    break
                marker = candidate.group(1) if ordered else "-"
                item_lines = [candidate.group(2)]
                index += 1
                while index < len(lines):
                    continuation = lines[index].strip()
                    if not continuation or re.match(
                        r"^([-*]|\d+\.)\s+(.+)$", continuation
                    ):
                        break
                    if continuation.startswith(
                        ("#", "|", ">", "```", "<!--")
                    ) or re.match(r"^!\[[^\]]*\]\([^)]+\)", continuation):
                        break
                    item_lines.append(continuation)
                    index += 1
                story.append(
                    Paragraph(
                        format_inline(" ".join(item_lines)),
                        styles["list"],
                        bulletText=marker,
                    )
                )
            story.append(Spacer(1, 5))
            continue
        paragraph_lines.append(stripped)
        index += 1
    flush_paragraph()
    return story


def cover_story(styles: dict[str, ParagraphStyle]) -> list[Any]:
    status_table = Table(
        [
            ["SOFTWARE SCOPE", "Hardware-independent source and local verification"],
            ["ACCEPTANCE", "All 27 gates are NOT ACCEPTED"],
            ["LICENSING", "Unresolved maintainer/legal decision"],
            ["DOCUMENT", "Version 1.0.0"],
        ],
        colWidths=[112, CONTENT_WIDTH - 112],
    )
    status_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#475569")),
                ("TEXTCOLOR", (1, 1), (1, 1), colors.HexColor("#b91c1c")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return [
        Spacer(1, 0.55 * inch),
        Paragraph("STRATHEX SWITCHYARD / SXSY-B122", styles["cover_kicker"]),
        Paragraph(TITLE, styles["cover_title"]),
        Spacer(1, 0.2 * inch),
        status_table,
        Spacer(1, 0.25 * inch),
        Paragraph(
            "A B122 chord expresses intent. It is not authority, authentication, confirmation, or permission to perform a side effect.",
            styles["cover_status"],
        ),
        Paragraph(
            "This manual includes the mechanically reconciled 22-control / 65-chord reference, first-install and lifecycle procedures, operator review semantics, fail-closed recovery, and troubleshooting. It contains no hardware or provider acceptance claim.",
            styles["body"],
        ),
        Spacer(1, 0.35 * inch),
        Paragraph(
            "Canonical sources: accepted complete specification, command catalog, protocol manifest, adversarial review, and acceptance-gate register.",
            styles["quote"],
        ),
        PageBreak(),
    ]


def toc_story(styles: dict[str, ParagraphStyle]) -> list[Any]:
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            "B122TOC1",
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=14,
            leftIndent=0,
            firstLineIndent=0,
            textColor=colors.HexColor("#0f172a"),
            spaceBefore=3,
        ),
        ParagraphStyle(
            "B122TOC2",
            fontName="Helvetica",
            fontSize=8.5,
            leading=12,
            leftIndent=16,
            firstLineIndent=0,
            textColor=colors.HexColor("#334155"),
        ),
        ParagraphStyle(
            "B122TOC3",
            fontName="Helvetica",
            fontSize=7.8,
            leading=10,
            leftIndent=30,
            firstLineIndent=0,
            textColor=colors.HexColor("#475569"),
        ),
    ]
    return [
        Paragraph("Contents", styles["toc_title"]),
        toc,
        PageBreak(),
    ]


def build_pdf(markdown_path: Path, intermediate_pdf: Path) -> None:
    styles = build_styles()
    document = ManualDocTemplate(
        str(intermediate_pdf),
        pagesize=letter,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title=TITLE,
        author="STRATHEX SWITCHYARD",
        subject="Software-only B122 operator, technical, and troubleshooting manual",
    )
    story = (
        cover_story(styles) + toc_story(styles) + parse_markdown(markdown_path, styles)
    )
    document.multiBuild(story)


def validate_and_render(pdf_path: Path, render_dir: Path) -> dict[str, Any]:
    reader = PdfReader(pdf_path)
    if reader.is_encrypted:
        raise ValueError("The manual PDF must not be encrypted.")
    if not reader.pages:
        raise ValueError("The manual PDF has no pages.")
    if reader.metadata.title != TITLE:
        raise ValueError("The manual PDF title metadata is incorrect.")
    extracted = "\n".join(page.extract_text() or "" for page in reader.pages)
    extracted_lower = extracted.lower()
    for required in [
        "all 27 gates are not accepted",
        "sxsy-b122 printable 22-control / 65-chord reference",
        "b122.sandbox:ctrl_shift_alt",
    ]:
        if required not in extracted_lower:
            raise ValueError(
                f"Required manual text is missing after extraction: {required}"
            )

    page_checks: list[dict[str, Any]] = []
    with pdfplumber.open(pdf_path) as document:
        for number, page in enumerate(document.pages, start=1):
            if (
                abs(float(page.width) - PAGE_WIDTH) > 0.1
                or abs(float(page.height) - PAGE_HEIGHT) > 0.1
            ):
                raise ValueError(f"Page {number} is not US Letter.")
            words = page.extract_words()
            if not words:
                raise ValueError(f"Page {number} has no extractable words.")
            for word in words:
                if not (
                    0 <= float(word["x0"]) <= float(word["x1"]) <= float(page.width)
                    and 0
                    <= float(word["top"])
                    <= float(word["bottom"])
                    <= float(page.height)
                ):
                    raise ValueError(
                        f"Page {number} contains clipped text coordinates."
                    )
            page_checks.append({"page": number, "wordCount": len(words)})

    if render_dir.exists():
        shutil.rmtree(render_dir)
    render_dir.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        for page_index in range(len(pdf)):
            page = pdf[page_index]
            bitmap = page.render(scale=1.5)
            image = bitmap.to_pil()
            image.save(render_dir / f"page-{page_index + 1:03d}.png", format="PNG")
            page.close()
    finally:
        pdf.close()
    rendered = sorted(render_dir.glob("page-*.png"))
    if len(rendered) != len(reader.pages):
        raise ValueError(
            "The full-page render count does not match the PDF page count."
        )
    return {
        "schema": "sxsy-b122.manual-pdf-validation/v1",
        "title": TITLE,
        "sha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
        "pageCount": len(reader.pages),
        "letterPages": True,
        "extractableText": True,
        "allPagesRendered": True,
        "pageChecks": page_checks,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build and validate the B122 manual PDF."
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--render-dir", type=Path)
    parser.add_argument("--work-dir", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    markdown_path = args.input.resolve()
    output_pdf = args.output.resolve()
    repository_root = markdown_path.parent.parent
    work_dir = (args.work_dir or repository_root / "tmp" / "pdfs").resolve()
    render_dir = (args.render_dir or work_dir / "SXSY-B122-manual-render").resolve()
    try:
        render_relative = render_dir.relative_to(work_dir)
    except ValueError as error:
        raise ValueError(
            "The render directory must be a child of the PDF work directory."
        ) from error
    if render_relative == Path("."):
        raise ValueError(
            "The render directory must be a child of the PDF work directory."
        )
    work_dir.mkdir(parents=True, exist_ok=True)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    intermediate_pdf = work_dir / "SXSY-B122-operator-technical-manual.build.pdf"
    if intermediate_pdf.exists():
        intermediate_pdf.unlink()
    build_pdf(markdown_path, intermediate_pdf)
    receipt = validate_and_render(intermediate_pdf, render_dir)
    receipt["sourceMarkdownSha256"] = hashlib.sha256(
        markdown_path.read_bytes()
    ).hexdigest()
    validation_path = work_dir / "SXSY-B122-operator-technical-manual.validation.json"
    validation_path.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    os.replace(intermediate_pdf, output_pdf)
    print(json.dumps({**receipt, "output": str(output_pdf)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
