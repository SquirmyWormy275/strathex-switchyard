"""Independent in-memory ZIP/CSV/hash facts. Never imports or extracts a package."""
import base64
import csv
import hashlib
import io
import json
import platform
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent
original = json.loads((root / "fixtures/pypi-wheel-oracle.json").read_text())
base = base64.b64decode(next(r for r in original["cases"] if r["id"] == "stored")["bytesBase64"])
prefix = "mixed_name-1.2.0.dist-info/"
record_path = prefix + "RECORD"
cases = []
for name in ["sha256", "sha384", "sha512", "quoted-crlf", "signatures", "changed-content", "wrong-size",
             "missing-member", "extra-member", "duplicate-member", "self-hash", "self-size", "missing-self",
             "listed-signature", "directory-row", "weak-hash", "unknown-hash", "padded-hash", "bad-base64",
             "missing-hash", "missing-size", "leading-zero-size", "wrong-fields", "bad-quotes", "blank-line",
             "bare-cr", "non-ascii", "row-bound", "byte-bound", "empty-record"]:
    with zipfile.ZipFile(io.BytesIO(base)) as archive:
        files = {p: archive.read(p) for p in archive.namelist() if p != record_path}
    if name == "quoted-crlf":
        files["synthetic/comma,name.txt"] = b"NEVER_COPY_PRIVATE_WHEEL_CONTENT"
    algorithm = name if name in ["sha384", "sha512"] else "sha256"
    rows = [[p, algorithm + "=" + base64.urlsafe_b64encode(hashlib.new(algorithm, b).digest()).decode().rstrip("="), str(len(b))]
            for p, b in files.items()]
    rows.append([record_path, "", ""])
    if name == "changed-content": files[rows[0][0]] += b"# changed without updating RECORD\n"
    if name == "wrong-size": rows[0][2] = str(int(rows[0][2]) + 1)
    if name == "missing-member": rows.pop(0)
    if name == "extra-member": rows.insert(0, ["synthetic/absent.py", rows[0][1], rows[0][2]])
    if name == "duplicate-member": rows.append(rows[0][:])
    if name == "self-hash": rows[-1][1] = rows[0][1]
    if name == "self-size": rows[-1][2] = "0"
    if name == "missing-self": rows.pop()
    if name in ["signatures", "listed-signature"]:
        files[prefix + "RECORD.jws"] = b"NEVER_TRUST_SIGNATURE"
        files[prefix + "RECORD.p7s"] = b"NEVER_TRUST_OTHER_SIGNATURE"
        if name == "listed-signature": rows.append([prefix + "RECORD.jws", rows[0][1], "0"])
    if name == "directory-row": rows.append(["synthetic/", "", ""])
    if name == "weak-hash": rows[0][1] = "sha1=" + base64.urlsafe_b64encode(hashlib.sha1(files[rows[0][0]]).digest()).decode().rstrip("=")
    if name == "unknown-hash": rows[0][1] = "unreviewed=" + rows[0][1].split("=", 1)[1]
    if name == "padded-hash": rows[0][1] += "="
    if name == "bad-base64": rows[0][1] = "sha256=" + "_" * 43
    if name == "missing-hash": rows[0][1] = ""
    if name == "missing-size": rows[0][2] = ""
    if name == "leading-zero-size": rows[0][2] = "0" + rows[0][2]
    if name == "wrong-fields": rows[0].append("hidden")
    if name == "row-bound": rows += [rows[0][:]] * 1024
    output = io.StringIO(newline="")
    csv.writer(output, lineterminator="\r\n" if name == "quoted-crlf" else "\n", quoting=csv.QUOTE_ALL if name == "quoted-crlf" else csv.QUOTE_MINIMAL).writerows(rows)
    record = output.getvalue().encode()
    if name == "bad-quotes": record = b'"unclosed,sha256=abc,1\n'
    if name == "blank-line": record += b"\n"
    if name == "bare-cr": record = record.replace(b"\n", b"\r")
    if name == "non-ascii": record += b"\xc3\xa9,,\n"
    if name == "byte-bound": record += b"x" * (256 * 1024)
    if name == "empty-record": record = b""
    files[record_path] = record
    if name == "directory-row": files["synthetic/"] = b""
    packed = io.BytesIO()
    with zipfile.ZipFile(packed, "w") as archive:
        for p, b in files.items():
            info = zipfile.ZipInfo(p, date_time=(2000, 1, 1, 0, 0, 0)); info.create_system = 3
            info.external_attr = (0o40755 << 16) | 0x10 if p.endswith("/") else 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED if p.endswith("/") else zipfile.ZIP_DEFLATED
            archive.writestr(info, b)
    raw = packed.getvalue()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        actual = {p: archive.read(p) for p in archive.namelist()}
        assert actual == files
        facts = []
        if name not in ["bad-quotes", "bare-cr", "non-ascii", "byte-bound", "empty-record"]:
            for row in csv.reader(io.StringIO(record.decode(), newline=""), strict=True):
                fact = {"fields": len(row)}
                if len(row) == 3:
                    p, declaration, size = row; fact.update(path=p, present=p in actual, size=size)
                    if p in actual and declaration:
                        alg, digest = declaration.split("=", 1)
                        if alg in hashlib.algorithms_guaranteed:
                            fact["digestMatches"] = base64.urlsafe_b64encode(hashlib.new(alg, actual[p]).digest()).decode().rstrip("=") == digest
                facts.append(fact)
    cases.append({"id": "record-" + name, "bytesBase64": base64.b64encode(raw).decode(), "sha256": hashlib.sha256(raw).hexdigest(),
                  "recordSha256": hashlib.sha256(record).hexdigest(), "regularFiles": sum(not p.endswith("/") for p in files), "csvRowCount": len(facts), "csvFacts": facts[:8]})
fixture = {"schema": "switchyard-pypi-wheel-record-oracle/v1", "pythonVersion": platform.python_version(),
           "baseOracleSha256": hashlib.sha256((root / "fixtures/pypi-wheel-oracle.json").read_bytes()).hexdigest(),
           "sources": [{"module": m.__name__, "sha256": hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()} for m in [zipfile, csv, hashlib]],
           "references": ["https://packaging.python.org/en/latest/specifications/binary-distribution-format/", "https://packaging.python.org/en/latest/specifications/recording-installed-packages/"], "cases": cases}
target = root / "fixtures/pypi-wheel-record-oracle.json"
target.write_text(json.dumps(fixture, indent=2) + "\n")
print(json.dumps({"cases": len(cases), "bytes": target.stat().st_size, "pythonVersion": fixture["pythonVersion"]}))
