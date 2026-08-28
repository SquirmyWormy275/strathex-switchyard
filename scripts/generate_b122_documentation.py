from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

CONTROL_LABELS = {
    "REANCHOR": "Re-anchor",
    "PROOF": "Proof",
    "OPTION_PROVIDER": "Option Provider",
    "PLAN_EXPANDER": "Plan Expander",
    "PLAN_APPROVAL": "Plan Approval",
    "HANDOFF": "Handoff",
    "FIND_BLOCKED_AGENT": "Find Blocked Agent",
    "FIND_FINISHED_AGENT": "Find Finished Agent",
    "AUTHORITY_REFRESH": "Authority Refresh",
    "COUNCIL": "Council",
    "CLAUDE": "Claude",
    "CHATGPT": "ChatGPT",
    "VSCODE": "VS Code",
    "TERMINAL": "Terminal",
    "COMMIT": "Commit",
    "GITHUB": "GitHub",
    "COMPOUND": "Compound",
    "RUN": "Run",
    "VOICE": "Voice",
    "PIPELINE": "Pipeline",
    "SHIELD": "Shield",
    "SANDBOX": "Sandbox",
}

MODIFIER_LABELS = {
    "normal": "Normal",
    "shift": "Shift",
    "alt": "Alt",
    "shift_alt": "Shift+Alt",
    "ctrl": "Ctrl",
    "ctrl_shift": "Ctrl+Shift",
    "ctrl_alt": "Ctrl+Alt",
    "ctrl_shift_alt": "Ctrl+Shift+Alt",
}

ACTION_OPERATOR_OUTCOMES = {
    "reanchor": (
        "Exact generated provider apply/observe routes preserve cooperative "
        "stop, discrepancy reporting, no resume, and no-replay recovery."
    ),
    "plan_approval": (
        "The reviewed expected TargetSnapshot transition and durable provider "
        "child effects are observed; contradiction or target churn reconciles."
    ),
    "handoff_immediate": "Provider workflow: deliver/focus the exact reviewed packet.",
    "handoff_routing_default": "Reviewed durable routing-default change.",
    "blocker_queue": (
        "The picker exposes only verified-blocked sessions for the exact "
        "authorized repository; no exact match stops."
    ),
    "done_queue": (
        "The picker exposes only verified-finished sessions for the exact "
        "authorized repository; no exact match stops."
    ),
    "authority_broadcast": (
        "Two-phase exact-recipient broadcast; cancellation, refusal, churn, "
        "and host failure settle once through the canonical receipt path."
    ),
    "focus_vscode": (
        "Focus or cycle only registered VS Code windows matching the exact "
        "repository; ambiguity never chooses another workspace."
    ),
    "focus_terminal": (
        "One companion-owned fixed terminal focus route settles through the "
        "canonical durable host-action path."
    ),
    "focus_vscode_terminal": (
        "Create or reuse only a terminal rooted at the exact authorized "
        "repository; never select an arbitrary active terminal."
    ),
    "compound_capture": (
        "Review one proposal-derived inert manifest, then apply only its exact "
        "host-local bytes and verify the host-observed target transition."
    ),
    "compound_refresh": (
        "Apply reviewed host-local file effects, then create the exact "
        "private-index local commit and verify the resulting transition."
    ),
    "lfg": (
        "Exact typed child planning is implemented, but dispatch remains "
        "blocked without current activation, gate evidence, and configured artifacts."
    ),
    "stop_managed_run": (
        "Stop only the selected exact durable debug or managed Run effect; an "
        "ambiguous result remains reconciliation-visible instead of replaying."
    ),
    "open_voice": (
        "One canonical durable host-action lifecycle owns and settles the "
        "Voice Center effect."
    ),
    "bind_voice_session": (
        "Bind through the canonical durable authority, confirmation, exact "
        "managed-session, effect, and receipt lifecycle."
    ),
    "voice_session_picker": (
        "Open the exact-repository picker; selection performs the reviewed "
        "durable single-session binding."
    ),
    "pipeline_failure_trace": (
        "Normal and Alt share one protected failure cursor over bounded local "
        "and hosted evidence; absent routes remain unavailable."
    ),
    "repair_mission": (
        "Exact deny-egress sandbox and typed child planning are implemented, "
        "but dispatch remains blocked without current activation and gate evidence."
    ),
    "venv": (
        "Complete the repo-local environment transition, then re-attest exact "
        "interpreter path, digest, and file identity before host selection."
    ),
    "rebuild_venv": (
        "Atomically rebuild the repo-local environment, then re-attest exact "
        "interpreter path, digest, and file identity before host selection."
    ),
}

ACTION_SETTLED_SUMMARIES = {
    "local_commit": "Create a scoped local commit after exact review.",
    "pr_upsert": (
        "Push and create or update the exact pull request after exact review."
    ),
    "rebuild_venv": (
        "Atomically rebuild and swap the repository virtual environment after "
        "exact review; preserve recovery state on failure."
    ),
}

CAPABILITY_LABELS = {
    "route_only": "Route-only",
    "requires_mediation": "Mediation required",
    "disabled_pending_gates": "Disabled pending gates",
}

OUTPUT_PATHS = {
    "reference": Path("docs/generated/SXSY-B122-65-chord-reference.md"),
    "manual": Path("docs/SXSY-B122-operator-technical-manual.md"),
    "demo_json": Path("docs/demo/SXSY-B122-safe-demo.json"),
    "demo_svg": Path("docs/demo/SXSY-B122-safe-demo.svg"),
    "demo_png": Path("docs/demo/SXSY-B122-safe-demo.png"),
    "demo_html": Path("docs/demo/SXSY-B122-safe-demo.html"),
    "demo_readme": Path("docs/demo/README.md"),
    "receipt": Path("docs/generated/SXSY-B122-documentation-manifest.json"),
}


def sha256_content(value: str | bytes) -> str:
    return hashlib.sha256(
        value.encode("utf-8") if isinstance(value, str) else value
    ).hexdigest()


def canonical_json(value: object) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + "\n"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_acceptance_gate_register(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(
            r"\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|",
            line.strip(),
        )
        if not match or not match.group(1).isdigit():
            continue
        rows.append(
            {
                "gate": int(match.group(1)),
                "name": match.group(2).strip(),
                "status": match.group(3).strip(),
            }
        )
    if [row["gate"] for row in rows] != list(range(1, 28)):
        raise RuntimeError("The acceptance register must contain gates 1 through 27.")
    if any(row["status"] != "NOT ACCEPTED" for row in rows):
        raise RuntimeError(
            "Documentation generation refuses to claim an accepted gate."
        )
    return rows


def load_command_catalog(repository_root: Path, node: str) -> list[dict[str, Any]]:
    script = (
        "import { commandCatalog } from "
        "'./packages/control-plane/src/command-catalog.ts';"
        "process.stdout.write(JSON.stringify(commandCatalog));"
    )
    result = subprocess.run(
        [
            node,
            "--experimental-transform-types",
            "--input-type=module",
            "--eval",
            script,
        ],
        cwd=repository_root,
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Unable to load the canonical command catalog through Node:\n"
            f"{result.stderr.strip()}"
        )
    catalog = json.loads(result.stdout)
    if not isinstance(catalog, list):
        raise RuntimeError("The canonical command catalog did not return a list.")
    return catalog


def validate_sources(
    protocol: dict[str, Any], catalog: list[dict[str, Any]]
) -> tuple[list[str], dict[str, dict[str, Any]]]:
    controls = protocol.get("controls")
    assignments = protocol.get("assignments")
    if (
        not isinstance(controls, list)
        or len(controls) != 22
        or len(set(controls)) != 22
    ):
        raise RuntimeError(
            "The canonical protocol must contain exactly 22 unique controls."
        )
    if set(controls) != set(CONTROL_LABELS):
        raise RuntimeError(
            "The documentation label set does not match the canonical controls."
        )
    if not isinstance(assignments, list) or len(assignments) != 65:
        raise RuntimeError(
            "The canonical protocol must contain exactly 65 assignments."
        )

    assignment_ids = [
        f"{assignment['control']}:{assignment['modifier']}"
        for assignment in assignments
    ]
    if len(set(assignment_ids)) != 65:
        raise RuntimeError("The canonical protocol contains a duplicate assignment.")
    if {assignment["control"] for assignment in assignments} != set(controls):
        raise RuntimeError("At least one canonical control has no settled assignment.")
    protocol_by_assignment = {
        f"{assignment['control']}:{assignment['modifier']}": assignment
        for assignment in assignments
    }

    catalog_by_assignment: dict[str, dict[str, Any]] = {}
    for command in catalog:
        assignment = command.get("assignment")
        if not isinstance(assignment, dict):
            raise RuntimeError(
                "A keyboard command is missing its canonical assignment."
            )
        assignment_id = f"{assignment['control']}:{assignment['modifier']}"
        if assignment_id in catalog_by_assignment:
            raise RuntimeError(f"Duplicate command catalog assignment: {assignment_id}")
        if assignment != protocol_by_assignment.get(assignment_id):
            raise RuntimeError(
                "The generated protocol and source command catalog disagree for "
                f"{assignment_id}."
            )
        catalog_by_assignment[assignment_id] = command
    if set(catalog_by_assignment) != set(assignment_ids):
        raise RuntimeError("The command catalog and protocol assignment sets differ.")
    return assignment_ids, catalog_by_assignment


def bank_for(control: str, controls: list[str]) -> str:
    return (
        "Agent Control Plane"
        if controls.index(control) < 10
        else "Workspace Command Bar"
    )


def command_safeguards(command: dict[str, Any]) -> str:
    parts: list[str] = []
    capabilities = command.get("requiresCapabilities", [])
    if capabilities:
        parts.append("capabilities " + "+".join(capabilities))
    if command.get("requiresCompleteTargetSnapshot"):
        parts.append("complete exact target")
    elif command.get("requiresTarget"):
        parts.append("verified target")
    if command.get("requiresAuthority"):
        parts.append("scoped authority")
    if command.get("requiresConfirmation"):
        parts.append("exact review/confirmation")
    gates = command.get("acceptanceGates", [])
    if gates:
        parts.append("gates " + ", ".join(str(gate) for gate in gates))
    if command.get("outbound"):
        parts.append("outbound containment fence")
    return (
        "; ".join(parts)
        if parts
        else "installed fixed host route; no repository target"
    )


def operator_outcome(assignment: dict[str, Any], command: dict[str, Any]) -> str:
    action_override = ACTION_OPERATOR_OUTCOMES.get(command["action"])
    if action_override is not None:
        return action_override
    capability = assignment["capability"]
    if capability == "disabled_pending_gates":
        return "Blocked unless independently accepted gates and all exact prerequisites are current."
    if capability == "requires_mediation":
        return "Durable typed result; missing mediation or configuration is unavailable/blocked."
    if command.get("requiresTarget"):
        return (
            "Read-only route for one exact target; ambiguity stops or opens a picker."
        )
    return "Fixed local route; a missing approved surface is unavailable."


def render_reference(
    protocol: dict[str, Any], catalog_by_assignment: dict[str, dict[str, Any]]
) -> str:
    controls: list[str] = protocol["controls"]
    assignments: list[dict[str, Any]] = protocol["assignments"]
    grouped = {
        control: [item for item in assignments if item["control"] == control]
        for control in controls
    }
    lines = [
        "# Appendix A. SXSY-B122 Printable 22-Control / 65-Chord Reference",
        "",
        "> Generated from `packages/protocol/generated/b122-control-map.json` and",
        "> `packages/control-plane/src/command-catalog.ts`. Do not edit this file by hand.",
        "> Every acceptance gate is NOT ACCEPTED. A chord is intent, not authority.",
        "",
        "Print the final manual PDF on US Letter at 100% for a documentation",
        "reference. This table is not exact-scale keycap artwork or a physical",
        "placement guide.",
        "",
        "## Legend sheet",
        "",
        "| Bank | Key | Printed short legend | Settled chords |",
        "| --- | ---: | --- | --- |",
    ]
    for index, control in enumerate(controls, start=1):
        chord_list = ", ".join(
            MODIFIER_LABELS[item["modifier"]] for item in grouped[control]
        )
        bank = "Left" if index <= 10 else "Upper"
        lines.append(
            f"| {bank} | {index if index <= 10 else index - 10} | "
            f"{CONTROL_LABELS[control]} | {chord_list} |"
        )

    lines.extend(
        [
            "",
            "## Exact chord reference",
            "",
            "The physical positions and production keycap artwork are not accepted. The",
            "numbering below is documentation order only.",
            "",
            "| # | Bank / key / chord | Action and settled behavior | Capability and safeguards |",
            "| ---: | --- | --- | --- |",
        ]
    )
    for index, assignment in enumerate(assignments, start=1):
        if index in {12, 25, 38, 51, 59, 63}:
            lines.extend(
                [
                    "",
                    "<!-- B122-PDF-PAGE-BREAK -->",
                    "",
                    "| # | Bank / key / chord | Action and settled behavior | Capability and safeguards |",
                    "| ---: | --- | --- | --- |",
                ]
            )
        assignment_id = f"{assignment['control']}:{assignment['modifier']}"
        command = catalog_by_assignment[assignment_id]
        marker = f"<!-- B122-ASSIGNMENT {assignment_id} -->"
        bank = bank_for(assignment["control"], controls)
        key = CONTROL_LABELS[assignment["control"]]
        chord = MODIFIER_LABELS[assignment["modifier"]]
        capability = CAPABILITY_LABELS[assignment["capability"]]
        summary = ACTION_SETTLED_SUMMARIES.get(command["action"], assignment["summary"])
        lines.append(
            f"| {index} | {bank}<br>{key}<br>**{chord}** | "
            f"`{command['action']}`<br>{summary}<br>"
            f"{operator_outcome(assignment, command)} | "
            f"{capability}<br>Executor: `{command['executor']}`<br>"
            f"{command_safeguards(command)}<br>Handler: `{assignment['handler']}` "
            f"{marker} |"
        )

    lines.extend(
        [
            "",
            "## Intentionally unassigned surface",
            "",
            "The eight documented modifier classes produce 176 possible slots. Exactly",
            "65 are settled above; the remaining 111 are intentionally unassigned. In",
            "particular, Ctrl, Ctrl+Shift, and Ctrl+Alt have no settled behaviors. The",
            "dispatcher must reject those combinations rather than inventing a fallback.",
            "",
        ]
    )
    return "\n".join(lines)


def demo_record() -> dict[str, Any]:
    return {
        "schema": "sxsy-b122.safe-demo/v1",
        "version": "1.0.0",
        "title": "SXSY-B122 deterministic fail-closed demonstration",
        "simulation": True,
        "hardwareObserved": False,
        "providerContacted": False,
        "externalEffects": [],
        "acceptanceEvidence": [],
        "fixtureTarget": "C:\\SXSY-B122-SIMULATED\\fixture-repository",
        "frames": [
            {
                "sequence": 1,
                "chord": "PROOF:normal",
                "action": "proof",
                "result": "preview",
                "message": "Read-only proof packet is bound to one simulated exact target.",
            },
            {
                "sequence": 2,
                "chord": "PROOF:normal",
                "action": "proof",
                "result": "unavailable",
                "message": "No attested provider is installed; no provider request is sent.",
            },
            {
                "sequence": 3,
                "chord": "COMMIT:alt",
                "action": "pr_merge",
                "result": "blocked",
                "message": "Exact-head merge is blocked because required gates are NOT ACCEPTED.",
            },
            {
                "sequence": 4,
                "chord": "PIPELINE:normal",
                "action": "pipeline_status",
                "result": "preserved",
                "message": "Typed outcomes remain visible; no external effect or retry occurred.",
            },
        ],
    }


def render_demo_svg(demo: dict[str, Any]) -> str:
    cards = []
    colors = {
        "preview": "#2563eb",
        "unavailable": "#6b7280",
        "blocked": "#b91c1c",
        "preserved": "#166534",
    }
    for index, frame in enumerate(demo["frames"]):
        x = 70 + (index % 2) * 750
        y = 210 + (index // 2) * 300
        color = colors[frame["result"]]
        message = frame["message"].replace("&", "&amp;")
        cards.append(
            f'<rect x="{x}" y="{y}" width="680" height="230" rx="18" fill="#ffffff" stroke="{color}" stroke-width="6"/>'
            f'<text x="{x + 30}" y="{y + 48}" class="step">STEP {frame["sequence"]} - {frame["result"].upper()}</text>'
            f'<text x="{x + 30}" y="{y + 94}" class="chord">{frame["chord"]}</text>'
            f'<text x="{x + 30}" y="{y + 135}" class="action">Action: {frame["action"]}</text>'
            f'<foreignObject x="{x + 30}" y="{y + 152}" width="620" height="64"><div xmlns="http://www.w3.org/1999/xhtml" class="message">{message}</div></foreignObject>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">\n'
        '<rect width="1600" height="900" fill="#f2f4f7"/>\n'
        "<style>.title{font:700 42px Arial,sans-serif;fill:#111827}.warning{font:700 23px Arial,sans-serif;fill:#b91c1c}.step{font:700 20px Arial,sans-serif;fill:#111827}.chord{font:700 30px Consolas,monospace;fill:#111827}.action{font:20px Consolas,monospace;fill:#374151}.message{font:19px Arial,sans-serif;color:#111827;line-height:1.25}</style>\n"
        '<text x="70" y="72" class="title">SXSY-B122 deterministic fail-closed demo</text>\n'
        '<text x="70" y="118" class="warning">SIMULATED - NO HARDWARE OR PROVIDER EVIDENCE</text>\n'
        '<text x="70" y="158" class="action">Fixed fixture target; zero network, credentials, Git mutation, or acceptance evidence.</text>\n'
        + "\n".join(cards)
        + '\n<text x="70" y="855" class="warning">Every acceptance gate remains NOT ACCEPTED.</text>\n</svg>\n'
    )


def render_demo_png(demo: dict[str, Any]) -> bytes:
    image = Image.new("RGB", (1600, 900), "#f2f4f7")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=42)
    warning_font = ImageFont.load_default(size=23)
    step_font = ImageFont.load_default(size=20)
    chord_font = ImageFont.load_default(size=28)
    body_font = ImageFont.load_default(size=18)
    draw.text(
        (70, 44),
        "SXSY-B122 deterministic fail-closed demo",
        fill="#111827",
        font=title_font,
    )
    draw.text(
        (70, 104),
        "SIMULATED - NO HARDWARE OR PROVIDER EVIDENCE",
        fill="#b91c1c",
        font=warning_font,
    )
    draw.text(
        (70, 143),
        "Fixed fixture target; zero network, credentials, Git mutation, or acceptance evidence.",
        fill="#374151",
        font=body_font,
    )
    colors = {
        "preview": "#2563eb",
        "unavailable": "#6b7280",
        "blocked": "#b91c1c",
        "preserved": "#166534",
    }
    for index, frame in enumerate(demo["frames"]):
        x = 70 + (index % 2) * 750
        y = 205 + (index // 2) * 300
        draw.rounded_rectangle(
            (x, y, x + 680, y + 230),
            radius=18,
            fill="#ffffff",
            outline=colors[frame["result"]],
            width=6,
        )
        draw.text(
            (x + 30, y + 24),
            f"STEP {frame['sequence']} - {frame['result'].upper()}",
            fill="#111827",
            font=step_font,
        )
        draw.text((x + 30, y + 67), frame["chord"], fill="#111827", font=chord_font)
        draw.text(
            (x + 30, y + 110),
            f"Action: {frame['action']}",
            fill="#374151",
            font=body_font,
        )
        draw.multiline_text(
            (x + 30, y + 150),
            textwrap.fill(frame["message"], width=62),
            fill="#111827",
            font=body_font,
            spacing=5,
        )
    draw.text(
        (70, 842),
        "Every acceptance gate remains NOT ACCEPTED.",
        fill="#b91c1c",
        font=warning_font,
    )
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=9)
    return buffer.getvalue()


def render_demo_html(demo: dict[str, Any]) -> str:
    frames = json.dumps(demo["frames"], separators=(",", ":"), ensure_ascii=True)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SXSY-B122 simulated safe demo</title>
  <style>
    body {{ margin: 0; background: #f2f4f7; color: #111827; font: 18px Arial, sans-serif; }}
    main {{ max-width: 980px; margin: 48px auto; padding: 32px; }}
    .warning {{ color: #b91c1c; font-weight: 700; letter-spacing: .03em; }}
    .card {{ min-height: 280px; margin-top: 28px; padding: 30px; background: white; border: 6px solid #2563eb; border-radius: 18px; }}
    code {{ font: 700 28px Consolas, monospace; }}
    button {{ padding: 12px 20px; border: 0; border-radius: 8px; background: #111827; color: white; font-weight: 700; }}
  </style>
</head>
<body>
  <main>
    <h1>SXSY-B122 deterministic fail-closed demo</h1>
    <p class="warning">SIMULATED - NO HARDWARE OR PROVIDER EVIDENCE</p>
    <p>This offline page plays four fixed frames. It performs no network, credential, Git, provider, or hardware action.</p>
    <button id="next" type="button">Next simulated frame</button>
    <section id="card" class="card" aria-live="polite"></section>
  </main>
  <script>
    const frames = {frames};
    let index = 0;
    const card = document.getElementById('card');
    function render() {{
      const frame = frames[index];
      card.style.borderColor = frame.result === 'blocked' ? '#b91c1c' : frame.result === 'preserved' ? '#166534' : frame.result === 'unavailable' ? '#6b7280' : '#2563eb';
      card.textContent = '';
      const heading = document.createElement('h2'); heading.textContent = `Step ${{frame.sequence}} - ${{frame.result}}`;
      const chord = document.createElement('code'); chord.textContent = frame.chord;
      const action = document.createElement('p'); action.textContent = `Action: ${{frame.action}}`;
      const message = document.createElement('p'); message.textContent = frame.message;
      card.append(heading, chord, action, message);
    }}
    document.getElementById('next').addEventListener('click', () => {{ index = (index + 1) % frames.length; render(); }});
    render();
  </script>
</body>
</html>
"""


def render_demo_readme() -> str:
    return r"""# SXSY-B122 deterministic safe demo

This directory contains a fixed, offline simulation of fail-closed B122 outcomes.
It is documentation media, not an executable control-plane acceptance test.

- `SXSY-B122-safe-demo.html` is the interactive four-frame playback.
- `SXSY-B122-safe-demo.svg` is the printable storyboard.
- `SXSY-B122-safe-demo.png` is the fixed raster storyboard used by the PDF.
- `SXSY-B122-safe-demo.json` is the canonical deterministic frame record.

Open the HTML file locally in a browser and select **Next simulated frame**. The
page has no external references and a restrictive Content Security Policy. It
does not contact a keyboard, provider, Git remote, credential store, scanner,
or network service. It supplies no acceptance evidence, and every one of the 27
acceptance gates remains NOT ACCEPTED.

Regenerate and verify it from the repository root:

```powershell
python .\scripts\generate_b122_documentation.py
python .\scripts\generate_b122_documentation.py --check
python -m pytest .\docs\tests\test_b122_documentation.py -q
```
"""


def render_manual(template: str, reference: str) -> str:
    marker = "{{GENERATED_REFERENCE}}"
    if template.count(marker) != 1:
        raise RuntimeError(
            "The operator manual template must contain one reference marker."
        )
    return template.replace(marker, reference)


def build_outputs(
    repository_root: Path, node: str
) -> tuple[dict[Path, str | bytes], dict[str, Any]]:
    protocol_path = (
        repository_root
        / "packages"
        / "protocol"
        / "generated"
        / "b122-control-map.json"
    )
    catalog_path = (
        repository_root / "packages" / "control-plane" / "src" / "command-catalog.ts"
    )
    template_path = (
        repository_root
        / "docs"
        / "templates"
        / "SXSY-B122-operator-technical-manual.template.md"
    )
    gate_register_path = repository_root / "docs" / "acceptance-gates.md"
    source_paths = [
        repository_root / "docs" / "SXSY-B122-complete-key-specification-and-audit.md",
        gate_register_path,
        repository_root / "docs" / "adversarial-review.md",
        repository_root / "docs" / "historical-interview-notes-reconstructed.md",
        template_path,
        catalog_path,
        protocol_path,
        repository_root / "scripts" / "build_b122_manual_pdf.py",
        repository_root / "scripts" / "generate_b122_documentation.py",
    ]
    missing_sources = [path for path in source_paths if not path.is_file()]
    if missing_sources:
        raise FileNotFoundError(
            "Documentation traceability source is missing: "
            + ", ".join(str(path) for path in missing_sources)
        )
    protocol = load_json(protocol_path)
    acceptance_gates = load_acceptance_gate_register(gate_register_path)
    catalog = load_command_catalog(repository_root, node)
    assignment_ids, catalog_by_assignment = validate_sources(protocol, catalog)
    reference = render_reference(protocol, catalog_by_assignment)
    demo = demo_record()
    for frame in demo["frames"]:
        command = catalog_by_assignment.get(frame["chord"])
        if command is None or command["action"] != frame["action"]:
            raise RuntimeError(
                "The safe demo contains a stale or mismatched canonical command: "
                f"{frame['chord']} -> {frame['action']}"
            )
    demo_json = canonical_json(demo)
    demo_svg = render_demo_svg(demo)
    demo_png = render_demo_png(demo)
    demo_html = render_demo_html(demo)
    demo_readme = render_demo_readme()
    template = template_path.read_text(encoding="utf-8")
    for gate in acceptance_gates:
        expected_gate_line = f"{gate['gate']}. {gate['name']}."
        if expected_gate_line not in template:
            raise RuntimeError(
                "The operator manual gate register does not match "
                f"docs/acceptance-gates.md: {expected_gate_line}"
            )
    manual = render_manual(template, reference)

    outputs = {
        OUTPUT_PATHS["reference"]: reference,
        OUTPUT_PATHS["manual"]: manual,
        OUTPUT_PATHS["demo_json"]: demo_json,
        OUTPUT_PATHS["demo_svg"]: demo_svg,
        OUTPUT_PATHS["demo_png"]: demo_png,
        OUTPUT_PATHS["demo_html"]: demo_html,
        OUTPUT_PATHS["demo_readme"]: demo_readme,
    }
    receipt = {
        "schema": "sxsy-b122.documentation-manifest/v1",
        "version": "1.0.0",
        "controlCount": 22,
        "assignmentCount": 65,
        "intentionallyUnassignedCount": 111,
        "assignmentIds": assignment_ids,
        "actionIds": [catalog_by_assignment[item]["action"] for item in assignment_ids],
        "handlerIds": [
            catalog_by_assignment[item]["assignment"]["handler"]
            for item in assignment_ids
        ],
        "allAcceptanceGates": [
            {"gate": gate["gate"], "status": gate["status"]}
            for gate in acceptance_gates
        ],
        "sourceDigests": {
            path.relative_to(repository_root)
            .as_posix(): hashlib.sha256(path.read_bytes())
            .hexdigest()
            for path in source_paths
        },
        "outputDigests": {
            path.as_posix(): sha256_content(content)
            for path, content in sorted(
                outputs.items(), key=lambda item: item[0].as_posix()
            )
        },
        "simulationOnly": True,
        "acceptanceClaimed": False,
    }
    outputs[OUTPUT_PATHS["receipt"]] = canonical_json(receipt)
    return outputs, receipt


def apply_outputs(
    output_root: Path, outputs: dict[Path, str | bytes], check: bool
) -> int:
    stale: list[str] = []
    for relative_path, content in outputs.items():
        target = output_root / relative_path
        if check:
            actual = target.read_bytes() if target.is_file() else None
            expected = content.encode("utf-8") if isinstance(content, str) else content
            if actual != expected:
                stale.append(relative_path.as_posix())
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, str):
            target.write_text(content, encoding="utf-8", newline="\n")
        else:
            target.write_bytes(content)
    if stale:
        for path in stale:
            print(f"stale generated documentation: {path}", file=sys.stderr)
        return 1
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the mechanically reconciled B122 manual/reference/demo."
    )
    parser.add_argument(
        "--repository-root", type=Path, default=Path(__file__).resolve().parents[1]
    )
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--node", default="node")
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repository_root = args.repository_root.resolve()
    output_root = (args.output_root or repository_root).resolve()
    outputs, receipt = build_outputs(repository_root, args.node)
    result = apply_outputs(output_root, outputs, args.check)
    if result == 0:
        mode = "verified" if args.check else "generated"
        print(
            f"{mode} {receipt['controlCount']} controls, "
            f"{receipt['assignmentCount']} assignments, "
            f"{receipt['intentionallyUnassignedCount']} unassigned slots"
        )
    return result


if __name__ == "__main__":
    raise SystemExit(main())
