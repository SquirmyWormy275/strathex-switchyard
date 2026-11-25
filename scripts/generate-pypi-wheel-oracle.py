"""Create fixed synthetic ZIP/metadata facts with existing Python/PyPA tools.

No package download, installation, extraction or execution. Only the fixture
JSON is written; every archive is built and independently read in memory.
"""
import base64
import csv
import email.parser
import hashlib
import io
import json
import platform
from pathlib import Path
import zipfile
import pip._vendor.packaging.utils as utils
import pip._vendor.packaging.version as versions

cases = []
for case, name, version, compression, metadata_version, directories, wheel_version in [
    ("stored", "mixed-name", "1.2.0", zipfile.ZIP_STORED, "2.4", False, "1.0"),
    ("deflated", "mixed-name", "1.2.0", zipfile.ZIP_DEFLATED, "2.6", False, "1.0"),
    ("equivalent", "MiXeD_Name", "01!02.0RC01.post02.dev03+LOCAL-001", zipfile.ZIP_DEFLATED, "2.3", False, "1.0"),
    ("wrong-name", "different-package", "1.2.0", zipfile.ZIP_DEFLATED, "2.4", False, "1.0"),
    ("wrong-version", "mixed-name", "9.0.0", zipfile.ZIP_STORED, "2.4", False, "1.0"),
    ("older-metadata", "mixed-name", "1.2.0", zipfile.ZIP_STORED, "1.1", False, "1.0"),
    ("directories", "mixed-name", "1.2.0", zipfile.ZIP_DEFLATED, "2.5", True, "1.0"),
    ("future-wheel", "mixed-name", "1.2.0", zipfile.ZIP_STORED, "2.4", False, "2.0"),
] + [(case, "mixed-name", "1.2.0", zipfile.ZIP_DEFLATED, "2.4", False, "1.0")
     for case in ["duplicate-name", "folded-version", "two-info", "missing-record", "symlink", "case-collision", "expansion-over-bound"]]:
    prefix = utils.canonicalize_name(name).replace("-", "_") + "-" + str(versions.Version(version)) + ".dist-info/"
    metadata = f"Metadata-Version: {metadata_version}\r\nName: {name}\r\nVersion: {version}\r\nSummary: NEVER_COPY_PRIVATE_WHEEL_SUMMARY\r\n\r\nNEVER_COPY_PRIVATE_WHEEL_DESCRIPTION\n".encode()
    if case == "duplicate-name":
        metadata = metadata.replace(b"Name:", b"Name: concealed\r\nName:", 1)
    if case == "folded-version":
        metadata = metadata.replace(b"Version: 1.2.0", b"Version: 1.2.\r\n 0")
    files = {"synthetic/__init__.py": b'raise RuntimeError("NEVER_EXECUTE_WHEEL")\n',
             "synthetic/empty.py": b"", prefix + "METADATA": metadata,
             prefix + "WHEEL": f"Wheel-Version: {wheel_version}\nRoot-Is-Purelib: true\nTag: py3-none-any\n".encode()}
    if case == "two-info":
        files["other-1.2.0.dist-info/METADATA"] = metadata
    if case == "case-collision":
        files["SYNTHETIC/__INIT__.PY"] = b"NEVER_EXECUTE_ALIAS"
    if case == "expansion-over-bound":
        files["synthetic/data.bin"] = b"x" * (4 * 1024 * 1024 + 1)
    record = io.StringIO(newline="")
    writer = csv.writer(record, lineterminator="\n")
    for path, data in files.items():
        writer.writerow([path, "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("="), len(data)])
    writer.writerow([prefix + "RECORD", "", ""])
    files[prefix + "RECORD"] = record.getvalue().encode()
    if case == "missing-record":
        del files[prefix + "RECORD"]
    if directories:
        files = {"synthetic/": b"", prefix: b"", **files}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for path, data in files.items():
            info = zipfile.ZipInfo(path, date_time=(2000, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = ((0o40755 << 16) | 0x10) if path.endswith("/") else (0o100644 << 16)
            if case == "symlink" and path == "synthetic/__init__.py":
                info.external_attr = 0o120777 << 16
            info.compress_type = zipfile.ZIP_STORED if path.endswith("/") else compression
            archive.writestr(info, data)
    raw = output.getvalue()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        assert {row.filename: archive.read(row) for row in archive.infolist()} == files
        entries = [{"path": row.filename, "headerOffset": row.header_offset, "crc32": row.CRC,
                    "compressedBytes": row.compress_size, "expandedBytes": row.file_size, "method": row.compress_type}
                   for row in archive.infolist()]
        central_offset = archive.start_dir
        parsed = email.parser.BytesParser().parsebytes(archive.read(prefix + "METADATA"))
    identity = {"name": utils.canonicalize_name(parsed["Name"]), "version": parsed["Version"],
                "metadataVersion": parsed["Metadata-Version"], "wheelVersion": wheel_version,
                "manifestSha256": hashlib.sha256(metadata).hexdigest(), "entries": len(entries),
                "expandedBytes": sum(row["expandedBytes"] for row in entries)}
    cases.append({"id": case, "bytesBase64": base64.b64encode(raw).decode(),
                  "sha256": hashlib.sha256(raw).hexdigest(), "centralOffset": central_offset,
                  "entries": entries, "identity": identity})
fixture = {"schema": "switchyard-pypi-wheel-oracle/v1", "pythonVersion": platform.python_version(),
           "sources": [{"module": m.__name__, "sha256": hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()}
                       for m in [zipfile, email.parser, utils, versions]],
           "references": ["https://packaging.python.org/en/latest/specifications/binary-distribution-format/",
                          "https://packaging.python.org/en/latest/specifications/core-metadata/",
                          "https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT"], "cases": cases}
target = Path(__file__).resolve().parent / "fixtures/pypi-wheel-oracle.json"
target.write_text(json.dumps(fixture, indent=2) + "\n")
print(json.dumps({"cases": len(cases), "pythonVersion": fixture["pythonVersion"], "bytes": target.stat().st_size}))
