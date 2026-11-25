"""Regenerate static comparison facts with an already installed PyPA packaging.

Run explicitly with /usr/bin/python3 -I -B. This script installs nothing, uses no
network, and writes only the named repository fixture. Tests consume those facts
without importing Python or third-party code.
"""
from hashlib import sha256
from itertools import product
from pathlib import Path
import json
import packaging
import packaging.version
from packaging.version import InvalidVersion, Version

versions = [
    "1.dev0", "1.0.dev456", "1.0a1", "1.0a2.dev456", "1.0a12.dev456",
    "1.0a12", "1.0b1.dev456", "1.0b2", "1.0b2.post345.dev456",
    "1.0b2.post345", "1.0rc1.dev456", "1.0rc1", "1.0", "1.0+abc.5",
    "1.0+abc.7", "1.0+5", "1.0.post456.dev34", "1.0.post456",
    "1.0.15", "1.1.dev1", "1", "1.0.0", "00!01.00.0", "v1.0", "V1.0",
    "1.0ALPHA", "1.0-a.0", "1.0beta2", "1.0-preview.1", "1.0pre1",
    "1.0c1", "1.0rc1", "1.0POST", "1.0-r0", "1.0rev0", "1.0-0",
    "1.0DEV", "1.0_dev_0", "1.0+LOCAL.0001", "1.0+local-1",
    "1.0+local_1", "1.0+dev", "1.0+0001", "1.0+1", "1.0+ab12",
]
for epoch, release, suffix, local in product(
    ["", "1!", "0002!"], ["0", "1.0", "2.0.0.1", "999999999999999999999999.0"],
    ["", ".dev0", "a0", "b2.dev1", "rc1.post1.dev0", ".post3", ".post3.dev2"],
    ["", "+local.0001", "+5.Dev"],
):
    versions.append(epoch + release + suffix + local)
versions = list(dict.fromkeys(versions))
parsed = [Version(value) for value in versions]
ranks = {value: rank for rank, value in enumerate(sorted(set(parsed)))}
invalid = ["", "1..0", "1.0rcx", "1!", "1.0-", "v", "1.0+", "1.0++a", "1.0+ab..c", "1.0a1b1", "1.0.post1.post2", "1.0.dev1.post2", "1/2", "<1", "1.*"]
for value in invalid:
    try:
        Version(value)
    except InvalidVersion:
        continue
    raise AssertionError("Oracle unexpectedly accepted invalid fixture: " + value)
source = Path(packaging.version.__file__)
fixture = {
    "schema": "switchyard-pep440-oracle/v1", "oracle": "PyPA packaging.version.Version",
    "oracleVersion": packaging.__version__, "oracleSourceSha256": sha256(source.read_bytes()).hexdigest(),
    "reference": "https://packaging.python.org/en/latest/specifications/version-specifiers/",
    "cases": [[value, ranks[version]] for value, version in zip(versions, parsed)], "invalid": invalid,
}
output = Path(__file__).resolve().parent / "fixtures" / "pep440-oracle.json"
output.write_text(json.dumps(fixture, indent=2) + "\n")
print(json.dumps({"fixture": str(output.relative_to(output.parents[2])), "cases": len(versions), "orderedComparisons": len(versions) ** 2, "oracleVersion": packaging.__version__, "oracleSourceSha256": fixture["oracleSourceSha256"]}))
