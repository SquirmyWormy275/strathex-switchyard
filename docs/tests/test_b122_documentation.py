from __future__ import annotations

import json
import hashlib
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = REPOSITORY_ROOT / "scripts" / "generate_b122_documentation.py"
PDF_BUILDER = REPOSITORY_ROOT / "scripts" / "build_b122_manual_pdf.py"
CANONICAL_MANIFEST = (
    REPOSITORY_ROOT / "packages" / "protocol" / "generated" / "b122-control-map.json"
)


def run_generator(output_root: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(GENERATOR),
            "--repository-root",
            str(REPOSITORY_ROOT),
            "--output-root",
            str(output_root),
            *extra,
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_canonical_manifest_has_closed_22_control_65_assignment_surface() -> None:
    manifest = json.loads(CANONICAL_MANIFEST.read_text(encoding="utf-8"))
    controls = manifest["controls"]
    assignments = manifest["assignments"]
    chord_ids = [f"{item['control']}:{item['modifier']}" for item in assignments]

    assert len(controls) == 22
    assert len(set(controls)) == 22
    assert len(assignments) == 65
    assert len(set(chord_ids)) == 65
    assert {item["control"] for item in assignments} == set(controls)
    assert 22 * 8 - len(assignments) == 111


def test_generator_builds_exact_reference_manual_and_simulated_demo(
    tmp_path: Path,
) -> None:
    result = run_generator(tmp_path)
    assert result.returncode == 0, result.stderr

    docs_root = tmp_path / "docs"
    receipt = json.loads(
        (docs_root / "generated" / "SXSY-B122-documentation-manifest.json").read_text(
            encoding="utf-8"
        )
    )
    demo = json.loads(
        (docs_root / "demo" / "SXSY-B122-safe-demo.json").read_text(encoding="utf-8")
    )
    reference = (docs_root / "generated" / "SXSY-B122-65-chord-reference.md").read_text(
        encoding="utf-8"
    )
    manual = (docs_root / "SXSY-B122-operator-technical-manual.md").read_text(
        encoding="utf-8"
    )
    demo_html = (docs_root / "demo" / "SXSY-B122-safe-demo.html").read_text(
        encoding="utf-8"
    )
    demo_svg = (docs_root / "demo" / "SXSY-B122-safe-demo.svg").read_text(
        encoding="utf-8"
    )
    demo_png = docs_root / "demo" / "SXSY-B122-safe-demo.png"

    assert receipt["schema"] == "sxsy-b122.documentation-manifest/v1"
    assert receipt["controlCount"] == 22
    assert receipt["assignmentCount"] == 65
    assert receipt["intentionallyUnassignedCount"] == 111
    assert len(receipt["assignmentIds"]) == len(set(receipt["assignmentIds"])) == 65
    assert len(receipt["actionIds"]) == len(set(receipt["actionIds"])) == 65
    assert len(receipt["handlerIds"]) == len(set(receipt["handlerIds"])) == 65
    assert receipt["allAcceptanceGates"] == [
        {"gate": gate, "status": "NOT ACCEPTED"} for gate in range(1, 28)
    ]
    assert set(receipt["sourceDigests"]) == {
        "docs/SXSY-B122-complete-key-specification-and-audit.md",
        "docs/acceptance-gates.md",
        "docs/adversarial-review.md",
        "docs/historical-interview-notes-reconstructed.md",
        "docs/templates/SXSY-B122-operator-technical-manual.template.md",
        "packages/control-plane/src/command-catalog.ts",
        "packages/protocol/generated/b122-control-map.json",
        "scripts/build_b122_manual_pdf.py",
        "scripts/generate_b122_documentation.py",
    }
    assert reference.count("<!-- B122-ASSIGNMENT ") == 65
    assert manual.count("<!-- B122-ASSIGNMENT ") == 65
    for handler in receipt["handlerIds"]:
        assert handler in reference
    assert "Provider workflow: deliver/focus the exact reviewed packet" in reference
    assert "Reviewed durable routing-default change" in reference
    assert "Focus or cycle only registered VS Code windows matching the exact repository" in reference
    for chord_id in ("HANDOFF:alt", "HANDOFF:shift_alt", "VOICE:shift_alt"):
        row = next(
            line
            for line in reference.splitlines()
            if f"<!-- B122-ASSIGNMENT {chord_id} -->" in line
        )
        assert "Read-only route" not in row
    expected_mutating_summaries = {
        "COMMIT:normal": "Create a scoped local commit after exact review.",
        "COMMIT:shift": (
            "Push and create or update the exact pull request after exact review."
        ),
        "SANDBOX:shift": (
            "Atomically rebuild and swap the repository virtual environment after "
            "exact review; preserve recovery state on failure."
        ),
    }
    for chord_id, expected in expected_mutating_summaries.items():
        row = next(
            line
            for line in reference.splitlines()
            if f"<!-- B122-ASSIGNMENT {chord_id} -->" in line
        )
        assert expected in row
        assert "Preview" not in row
    assert "B122-RESIDUAL-" not in reference

    assert demo["schema"] == "sxsy-b122.safe-demo/v1"
    assert demo["simulation"] is True
    assert demo["hardwareObserved"] is False
    assert demo["providerContacted"] is False
    assert demo["externalEffects"] == []
    assert demo["acceptanceEvidence"] == []
    assert all(frame["chord"] in receipt["assignmentIds"] for frame in demo["frames"])
    assert all(frame["action"] in receipt["actionIds"] for frame in demo["frames"])
    assert [frame["result"] for frame in demo["frames"]] == [
        "preview",
        "unavailable",
        "blocked",
        "preserved",
    ]
    assert "SIMULATED - NO HARDWARE OR PROVIDER EVIDENCE" in demo_svg
    from PIL import Image

    with Image.open(demo_png) as image:
        assert image.size == (1600, 900)
        assert image.mode == "RGB"
    assert "default-src 'none'" in demo_html
    assert "https://" not in demo_html
    assert "http://" not in demo_html


def test_generator_check_mode_detects_documentation_drift(tmp_path: Path) -> None:
    generated = run_generator(tmp_path)
    assert generated.returncode == 0, generated.stderr

    clean = run_generator(tmp_path, "--check")
    assert clean.returncode == 0, clean.stderr

    reference = tmp_path / "docs" / "generated" / "SXSY-B122-65-chord-reference.md"
    reference.write_text(
        reference.read_text(encoding="utf-8") + "drift\n", encoding="utf-8"
    )
    stale = run_generator(tmp_path, "--check")
    assert stale.returncode == 1
    assert "SXSY-B122-65-chord-reference.md" in stale.stderr


def test_pdf_builder_produces_readable_letter_pages_and_full_render(
    tmp_path: Path,
) -> None:
    generated = run_generator(tmp_path)
    assert generated.returncode == 0, generated.stderr
    output_pdf = tmp_path / "output" / "SXSY-B122-manual.pdf"
    pdf_work_dir = tmp_path / "pdf-work"
    render_dir = pdf_work_dir / "rendered"
    result = subprocess.run(
        [
            sys.executable,
            str(PDF_BUILDER),
            "--input",
            str(tmp_path / "docs" / "SXSY-B122-operator-technical-manual.md"),
            "--output",
            str(output_pdf),
            "--render-dir",
            str(render_dir),
            "--work-dir",
            str(pdf_work_dir),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    pdf_receipt = json.loads(result.stdout)
    assert re.fullmatch(r"[a-f0-9]{64}", pdf_receipt["sha256"])
    manual_source = tmp_path / "docs" / "SXSY-B122-operator-technical-manual.md"
    assert (
        pdf_receipt["sourceMarkdownSha256"]
        == hashlib.sha256(manual_source.read_bytes()).hexdigest()
    )

    second_pdf = tmp_path / "output" / "SXSY-B122-manual-second.pdf"
    second_result = subprocess.run(
        [
            sys.executable,
            str(PDF_BUILDER),
            "--input",
            str(tmp_path / "docs" / "SXSY-B122-operator-technical-manual.md"),
            "--output",
            str(second_pdf),
            "--render-dir",
            str(tmp_path / "pdf-work-second" / "rendered"),
            "--work-dir",
            str(tmp_path / "pdf-work-second"),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert second_result.returncode == 0, second_result.stderr
    assert second_pdf.read_bytes() == output_pdf.read_bytes()

    from pypdf import PdfReader

    reader = PdfReader(output_pdf)
    assert len(reader.pages) >= 20
    assert (
        reader.metadata.title
        == "SXSY-B122 Operator, Technical, and Troubleshooting Manual"
    )
    assert len(reader.outline) >= 15
    assert sum(len(page.get("/Annots") or []) for page in reader.pages) >= 15
    extracted = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "all 27 gates are not accepted" in extracted.lower()
    assert "b122.SANDBOX:ctrl_shift_alt" in extracted
    assert "SXSY-B122 Printable 22-Control / 65-Chord Reference" in extracted
    assert not any(glyph in extracted for glyph in ("\ufffd", "\u25a0", "\u25a1"))
    assert not re.search(
        r"(?m)^1\s+(?:Re-anchor|Proof|Voice|Pipeline|Shield|Sandbox):",
        extracted,
    )
    assert re.search(r"6\.\s+Cancel the picker or review", extracted)

    rendered = sorted(render_dir.glob("page-*.png"))
    assert len(rendered) == len(reader.pages)
    assert all(path.stat().st_size > 1_000 for path in rendered)

    import pdfplumber

    with pdfplumber.open(output_pdf) as document:
        for page_number, page in enumerate(document.pages, start=1):
            words = page.extract_words()
            assert words
            assert len(words) >= 50, f"page {page_number} is visually sparse"
            assert all(
                0 <= word["x0"] <= word["x1"] <= page.width
                and 0 <= word["top"] <= word["bottom"] <= page.height
                for word in words
            )


def test_pdf_builder_rejects_render_directory_outside_work_root(
    tmp_path: Path,
) -> None:
    generated = run_generator(tmp_path)
    assert generated.returncode == 0, generated.stderr
    protected = tmp_path / "protected-render"
    protected.mkdir()
    marker = protected / "keep.txt"
    marker.write_text("keep", encoding="utf-8")
    result = subprocess.run(
        [
            sys.executable,
            str(PDF_BUILDER),
            "--input",
            str(tmp_path / "docs" / "SXSY-B122-operator-technical-manual.md"),
            "--output",
            str(tmp_path / "manual.pdf"),
            "--work-dir",
            str(tmp_path / "work"),
            "--render-dir",
            str(protected),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode != 0
    assert "render directory must be a child" in result.stderr.lower()
    assert marker.read_text(encoding="utf-8") == "keep"


@pytest.mark.parametrize(
    "relative_path",
    [
        "docs/SXSY-B122-complete-key-specification-and-audit.md",
        "docs/historical-interview-notes-reconstructed.md",
        "docs/adversarial-review.md",
        "docs/acceptance-gates.md",
        "docs/software-only-completion-audit.md",
        "docs/software-residual-ledger.md",
        "docs/operational-safety-model.md",
        "docs/provider-adapter-protocol.md",
        "docs/windows-release-and-installation.md",
        "packages/protocol/src/b122.ts",
        "packages/protocol/generated/b122-control-map.json",
        "packages/control-plane/src/command-catalog.ts",
        "scripts/generate_b122_documentation.py",
    ],
)
def test_manual_traceability_sources_exist(relative_path: str) -> None:
    assert (REPOSITORY_ROOT / relative_path).is_file()


def test_generated_markdown_local_links_resolve(tmp_path: Path) -> None:
    generated = run_generator(tmp_path)
    assert generated.returncode == 0, generated.stderr

    generated_docs = tmp_path / "docs"
    markdown_files = [
        generated_docs / "SXSY-B122-operator-technical-manual.md",
        generated_docs / "generated" / "SXSY-B122-65-chord-reference.md",
        generated_docs / "demo" / "README.md",
    ]
    for markdown_file in markdown_files:
        text = markdown_file.read_text(encoding="utf-8")
        for target in re.findall(r"(?<!!)\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)", text):
            if re.match(r"^[a-z]+:", target, flags=re.IGNORECASE):
                continue
            generated_target = (markdown_file.parent / target).resolve()
            repository_target = (REPOSITORY_ROOT / "docs" / target).resolve()
            assert (
                generated_target.exists() or repository_target.exists()
            ), f"broken local link in {markdown_file.name}: {target}"


def test_all_documentation_local_links_and_images_resolve() -> None:
    broken: list[str] = []
    for markdown_file in sorted((REPOSITORY_ROOT / "docs").rglob("*.md")):
        text = markdown_file.read_text(encoding="utf-8")
        for raw_target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", text):
            target = raw_target.strip().strip("<>")
            if not target or target.startswith("#"):
                continue
            parsed = urlparse(target)
            if parsed.scheme or parsed.netloc:
                continue
            path_text = unquote(parsed.path)
            if not path_text:
                continue
            link_base = (
                REPOSITORY_ROOT / "docs"
                if markdown_file.parent == REPOSITORY_ROOT / "docs" / "templates"
                else markdown_file.parent
            )
            resolved = (
                REPOSITORY_ROOT / path_text.lstrip("/")
                if path_text.startswith("/")
                else link_base / path_text
            ).resolve()
            if not resolved.exists():
                broken.append(
                    f"{markdown_file.relative_to(REPOSITORY_ROOT)} -> {raw_target}"
                )
    assert broken == []


def test_manual_preserves_frozen_mediation_and_split_binding_contracts() -> None:
    template = (
        REPOSITORY_ROOT
        / "docs"
        / "templates"
        / "SXSY-B122-operator-technical-manual.template.md"
    ).read_text(encoding="utf-8")
    provider_protocol = (
        REPOSITORY_ROOT / "docs" / "provider-adapter-protocol.md"
    ).read_text(encoding="utf-8")
    normalized_template = re.sub(r"\s+", " ", template)
    normalized_provider_protocol = re.sub(r"\s+", " ", provider_protocol)

    required_manual_text = [
        "inert immutable operation manifest",
        "Approve only the exact displayed review-scope digest",
        "provider proposal is never authority",
        "The review is tied to the exact action, target snapshot, provider session, scoped authority, manifest, and one-use confirmation; durable operation identity is allocated and bound at dispatch.",
        "Phase 2 echoes only the binding ID, binding digest, review scope, and provider",
        "the companion recovers the effect-session ID from protected state",
        "No arbitrary or unmanaged debugger stop is supported.",
        "does not fall back to raw provider network observation or redispatch merely",
        "all 27 acceptance gates are NOT ACCEPTED",
    ]
    for expected in required_manual_text:
        assert expected in normalized_template

    required_provider_text = [
        "A provider module never receives an OS-opened credential",
        "separately configured, digest-pinned host effect driver",
        "driver receives only its fixed host identity and the companion-issued bounded",
        "both the separately installed effect driver and a companion-authenticated final-current callback",
        "No proprietary driver/module pair or its live acceptance evidence is bundled",
    ]
    for expected in required_provider_text:
        assert expected in normalized_provider_protocol


def test_current_docs_link_historical_audits_and_preserve_license_nonclaim() -> None:
    current_documents = {
        "manual": REPOSITORY_ROOT
        / "docs"
        / "templates"
        / "SXSY-B122-operator-technical-manual.template.md",
        "audit": REPOSITORY_ROOT / "docs" / "software-only-completion-audit.md",
        "residual": REPOSITORY_ROOT / "docs" / "software-residual-ledger.md",
    }
    historical_names = [
        "post-merge-adversarial-audit.md",
        "software-completion-audit.md",
        "implementation-security-review.md",
    ]

    for label, path in current_documents.items():
        text = path.read_text(encoding="utf-8")
        assert "UNLICENSED" in text, f"{label} must preserve the license nonclaim"
        assert "NOT ACCEPTED" in text, f"{label} must preserve gate nonclaims"

    for name in historical_names:
        assert name in current_documents["manual"].read_text(encoding="utf-8")
        assert name in current_documents["audit"].read_text(encoding="utf-8")
        assert (REPOSITORY_ROOT / "docs" / name).is_file()

    audit_text = current_documents["audit"].read_text(encoding="utf-8")
    assert "exercise the host protocol and lifecycle paths" in audit_text
    assert "do not prove every action's provider semantics" in audit_text
    assert "fixture backends prove the host contract" not in audit_text


def test_current_docs_record_ordinary_software_closure() -> None:
    documents = {
        "manual": REPOSITORY_ROOT
        / "docs"
        / "templates"
        / "SXSY-B122-operator-technical-manual.template.md",
        "audit": REPOSITORY_ROOT / "docs" / "software-only-completion-audit.md",
        "residual": REPOSITORY_ROOT / "docs" / "software-residual-ledger.md",
        "provider": REPOSITORY_ROOT / "docs" / "provider-adapter-protocol.md",
    }
    for label in ("manual", "audit", "residual"):
        text = documents[label].read_text(encoding="utf-8")
        assert "ordinary software" in text.lower()
        assert "closed" in text.lower() or "closure" in text.lower()

    provider_text = documents["provider"].read_text(encoding="utf-8")
    assert "all four proposal-only automation routes" in provider_text
    assert "Provider-owned automation effect routes remain deliberately absent" in provider_text

    for relative_path in (
        "docs/README.md",
        "docs/02-system-architecture.md",
        "docs/05-roadmap.md",
        "docs/06-publication-gate.md",
    ):
        text = (REPOSITORY_ROOT / relative_path).read_text(encoding="utf-8")
        assert "hardware-independent" in text.lower()
    roadmap = (REPOSITORY_ROOT / "docs" / "05-roadmap.md").read_text(encoding="utf-8")
    assert "- [x] Close all ordinary software residuals" in roadmap
