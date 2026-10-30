"""Shared PDF/SVG insert layout on the verified source's actual point geometry."""
from itertools import combinations
import re

from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase.pdfmetrics import stringWidth, getAscentDescent
from b122_legend_geometry import geometry, inset, SVG_SHA256, PAGE_HEIGHT

MIN_LEGEND_FONT = 4.75


def fit_lines(text, width, height, font, max_size):
    words = re.sub(r"(?<=\w)-(?=\w)", "- ", text).split()
    candidates = [[text]]
    for count in range(1, min(3, len(words))+1):
        for cuts in combinations(range(1, len(words)), count-1):
            indexes = (0,)+cuts+(len(words),)
            candidates.append([" ".join(words[a:b]) for a, b in zip(indexes, indexes[1:])])
    for step in range(round((max_size-MIN_LEGEND_FONT)*20)+1):
        size = round(max_size-step*.05, 2)
        for lines in candidates:
            if len(lines)*size*1.1 <= height and max(stringWidth(line, font, size) for line in lines) <= width:
                return size, lines
    raise ValueError(f"Legend cannot fit at the readable minimum: {text}")


def draw_wrapped(c, text, x, y, width, height, font, max_size, color):
    size, lines = fit_lines(text, width, height, font, max_size)
    ascent, descent = getAscentDescent(font, size)
    leading = size*1.1
    total_height = ascent-descent+(len(lines)-1)*leading
    start = y+total_height/2-ascent
    c.setFillColor(color)
    c.setFont(font, size)
    for index, line in enumerate(lines):
        c.drawCentredString(x, start-index*leading, line)


def draw_compact(c, face, item, palette):
    x, y, w, h = face["x"], PAGE_HEIGHT-face["y"]-face["h"], face["w"], face["h"]
    c.setFillColor(palette.dark)
    c.rect(x+.5, y+.5, w-1, h-1, fill=1, stroke=0)
    c.setFillColor(palette.accent)
    c.rect(x+.5, y+h-7, w-1, 6.5, fill=1, stroke=0)
    draw_wrapped(c, item["logicalId"], x+w/2, y+h-3.75, w-2, 6, "Helvetica-Bold", 5.1, white if palette.name == "MONOCHROME" else palette.dark)
    draw_wrapped(c, item["displayName"], x+w/2, y+h/2-3, w-2, h-10, "Helvetica-Bold", 6.5, white)


def draw_polygon(c, polygon, color):
    path = c.beginPath()
    for i, (x, y) in enumerate(polygon):
        (path.moveTo if i == 0 else path.lineTo)(x, PAGE_HEIGHT-y)
    path.close()
    c.setFillColor(color)
    c.drawPath(path, fill=1, stroke=0)


def draw_full(c, shape, item, palette, short_actions):
    draw_compact(c, shape["face"], item, palette)
    for modifier, panel in shape["panels"].items():
        action = short_actions.get((item["control"], modifier), "RESERVED")
        background = palette.light if action != "RESERVED" else HexColor("#EEEEEE")
        foreground = palette.dark if action != "RESERVED" else HexColor("#666666")
        if panel["rotation"] == 0:
            draw_polygon(c, inset(panel["polygon"]), background)
            px, py = panel["prefixPoint"]
            draw_wrapped(c, panel["prefix"], px, PAGE_HEIGHT-py, 25, 6, "Helvetica-Bold", 5.0, foreground)
            x, y, w, h = panel["actionBox"]
            draw_wrapped(c, action, x+w/2, PAGE_HEIGHT-y-h/2, w, h, "Helvetica-Bold", 5.3, foreground)
        else:
            x, y, w, h = panel["inkBox"]
            c.setFillColor(background)
            c.rect(x, PAGE_HEIGHT-y-h, w, h, fill=1, stroke=0)
            c.saveState()
            c.translate(x+w/2, PAGE_HEIGHT-y-h/2)
            c.rotate(panel["rotation"])
            draw_wrapped(c, panel["prefix"], 0, w/2-3.5, h-2, 6, "Helvetica-Bold", 5.0, foreground)
            draw_wrapped(c, action, 0, -3, h-2, w-8, "Helvetica-Bold", 5.3, foreground)
            c.restoreState()


def hex_color(color):
    return "#%02X%02X%02X" % tuple(round(channel*255) for channel in (color.red, color.green, color.blue))


def escape_xml(value):
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


class SvgCanvas:
    """Use the PDF's checked positions and text layout without stretching glyphs."""
    def __init__(self):
        self.parts, self.stack, self.depth = [], [], 0
        self.fill, self.font, self.size = "#000000", "Helvetica-Bold", 5

    def setFillColor(self, color):
        self.fill = hex_color(color)

    def setFont(self, font, size):
        self.font, self.size = font, size

    def rect(self, x, y, w, h, **_):
        self.parts.append(f'<rect x="{x:.6f}" y="{y:.6f}" width="{w:.6f}" height="{h:.6f}" fill="{self.fill}"/>')

    def drawCentredString(self, x, y, text):
        self.parts.append(f'<text transform="translate({x:.6f} {y:.6f}) scale(1 -1)" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="{self.size:.2f}" fill="{self.fill}">{escape_xml(text)}</text>')

    def saveState(self):
        self.stack.append((self.depth, self.fill, self.font, self.size))

    def restoreState(self):
        depth, self.fill, self.font, self.size = self.stack.pop()
        while self.depth > depth:
            self.parts.append('</g>')
            self.depth -= 1

    def translate(self, x, y):
        self.parts.append(f'<g transform="translate({x:.6f} {y:.6f})">')
        self.depth += 1

    def rotate(self, angle):
        self.parts.append(f'<g transform="rotate({angle})">')
        self.depth += 1

    def beginPath(self):
        return SvgPath()

    def drawPath(self, path, **_):
        self.parts.append(f'<path d="{" ".join(path.parts)}" fill="{self.fill}"/>')


class SvgPath:
    def __init__(self):
        self.parts = []

    def moveTo(self, x, y):
        self.parts.append(f'M {x:.6f} {y:.6f}')

    def lineTo(self, x, y):
        self.parts.append(f'L {x:.6f} {y:.6f}')

    def close(self):
        self.parts.append('Z')


def individual_svg(item, palette, short_actions):
    shapes = geometry()
    x, y, w, h = shapes["crop"]
    original = ''.join('<path '+' '.join(f'{k}="{escape_xml(v)}"' for k, v in e.attrib.items())+'/>' for e in shapes["sourcePaths"])
    output = SvgCanvas()
    draw_full(output, shapes["full"][0], item, palette, short_actions)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w:.6f}pt" height="{h:.6f}pt" viewBox="{x:.6f} {y:.6f} {w:.6f} {h:.6f}" role="img" aria-labelledby="title desc">
<title id="title">{escape_xml(item['displayName'])} relegendable insert</title>
<desc id="desc">Logical ID {item['logicalId']}; position unassigned within {item['bank']}. Literal source geometry by cyber_engineer (GeekHack), @Mates_ENGINEER. Print at actual size; verify calibration and cap fit separately.</desc>
<metadata>Source SVG SHA-256 {SVG_SHA256}; units points; minimum legend font {MIN_LEGEND_FONT} pt.</metadata>
{original}
<g transform="translate(0 {PAGE_HEIGHT}) scale(1 -1)">{''.join(output.parts)}</g>
</svg>
'''
