"""Fixed license-header facts from Python email/ZIP readers, entirely in memory."""
import base64
import csv
import email.parser
import hashlib
import io
import json
import platform
from pathlib import Path
import zipfile

cases = []
rows = [
    ("license-missing", "2.4", "", {"status": "missing"}),
    ("license-mit", "2.4", "License-Expression: MIT\n", {"status": "declared", "expression": "MIT"}),
    ("license-and", "2.4", "License-Expression: MIT AND GPL-3.0-only\n", {"status": "declared", "expression": "MIT AND GPL-3.0-only"}),
    ("license-or", "2.6", "License-Expression: MIT OR Apache-2.0\n", {"status": "declared", "expression": "MIT OR Apache-2.0"}),
    ("license-folded", "2.5", "License-Expression: MIT OR\n Apache-2.0\n", {"status": "declared", "expression": "MIT OR Apache-2.0"}),
    ("license-file", "2.4", "License-File: NEVER_COPY_PRIVATE_LICENSE\nLicense-File: another\n", {"status": "file-only"}),
    ("license-old-version", "2.3", "License-Expression: MIT\n", {"status": "unsupported"}),
    ("license-legacy", "2.4", "License: NEVER_COPY_PRIVATE_LICENSE\n", {"status": "unsupported"}),
    ("license-conflict", "2.4", "License: GPL-3.0-only\nLicense-Expression: MIT\n", {"status": "unsupported"}),
    ("license-private", "2.4", "License-Expression: LicenseRef-NEVER_COPY_PRIVATE_LICENSE\n", {"status": "unsupported"}),
    ("license-empty", "2.4", "License-Expression: \n", {"status": "unsupported"}),
    ("license-empty-file", "2.4", "License-File: \n", {"status": "unsupported"}),
    ("license-unlisted", "2.4", "License-Expression: Unknown-Synthetic-License\n", {"status": "declared", "expression": "Unknown-Synthetic-License"}),
    ("license-duplicate", "2.4", "License-Expression: MIT\nlicense-expression: GPL-3.0-only\n", None),
    ("license-body", "2.4", "\nLicense-Expression: GPL-3.0-only\n", {"status": "missing"}),
    ("license-record-mismatch", "2.4", "License-Expression: GPL-3.0-only\n", {"status": "declared", "expression": "GPL-3.0-only"}),
    ("license-wrong-name", "2.4", "License-Expression: GPL-3.0-only\n", {"status": "declared", "expression": "GPL-3.0-only"}),
]
for case, version, headers, expected in rows:
    name = "different-package" if case == "license-wrong-name" else "mixed-name"
    prefix = name.replace("-", "_") + "-1.2.0.dist-info/"
    metadata = f"Metadata-Version: {version}\nName: {name}\nVersion: 1.2.0\n{headers}\nNEVER_COPY_PRIVATE_WHEEL_BODY\n".encode()
    files = {"synthetic/__init__.py": b'raise RuntimeError("NEVER_EXECUTE_WHEEL")\n', prefix + "METADATA": metadata,
             prefix + "WHEEL": b"Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n"}
    record = io.StringIO(newline=""); writer = csv.writer(record, lineterminator="\n")
    for path, data in files.items():
        writer.writerow([path, "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("="), len(data)])
    writer.writerow([prefix + "RECORD", "", ""]); files[prefix + "RECORD"] = record.getvalue().encode()
    if case == "license-record-mismatch": files["synthetic/__init__.py"] += b"# altered after RECORD\n"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path, data in files.items():
            info = zipfile.ZipInfo(path, date_time=(2000, 1, 1, 0, 0, 0)); info.create_system = 3
            info.external_attr = 0o100644 << 16; info.compress_type = zipfile.ZIP_DEFLATED; archive.writestr(info, data)
    raw = buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        assert {r.filename: archive.read(r) for r in archive.infolist()} == files
        parsed = email.parser.BytesParser().parsebytes(archive.read(prefix + "METADATA"))
    cases.append({"id": case, "bytesBase64": base64.b64encode(raw).decode(), "sha256": hashlib.sha256(raw).hexdigest(),
                  "metadataVersion": parsed["Metadata-Version"], "expressionHeaders": parsed.get_all("License-Expression", []),
                  "licenseFileHeaders": parsed.get_all("License-File", []), "expected": expected})
out = {"schema": "switchyard-pypi-wheel-license-oracle/v1", "pythonVersion": platform.python_version(),
       "sources": [{"module": m.__name__, "sha256": hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()} for m in [zipfile, email.parser]],
       "reference": "https://packaging.python.org/en/latest/specifications/core-metadata/#license-expression",
       "meaning": "Email/ZIP facts are independent reference observations; expected license statuses are the reviewed Switchyard subset contract.", "cases": cases}
target = Path(__file__).resolve().parent / "fixtures/pypi-wheel-license-oracle.json"
target.write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps({"cases": len(cases), "bytes": target.stat().st_size, "extractions": 0, "packageExecutions": 0}))
