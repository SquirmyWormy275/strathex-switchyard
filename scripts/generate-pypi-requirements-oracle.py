"""Record pure parsing facts from an already installed pip; no installs or I/O requests.

Run with an existing Python that supplies pip: python3 -I -B this-file.py.
Only the named repository fixture is written. Portable tests consume its facts.
"""
import json
from hashlib import sha256
from itertools import product
from pathlib import Path
import pip
import pip._internal.req.req_file as req_file
import pip._vendor.packaging as packaging
import pip._vendor.packaging.requirements as requirements
import pip._vendor.packaging.utils as utils

cases = [name + extras + "==" + version for name, extras, version in product(
    ["Example", "mixed_Name", "a.b--c"],
    ["", "[]", "[TLS,secure_Mode]", "[foo.bar,foo__bar,Z]", " [a-b_c.d] "],
    ["1.2.3", "01!02.0RC01.post02.dev03+LOCAL-001"],
)]
cases += [
    "one==1.0 # comment \\\ntwo==2.0\nthree==3.0",
    "one==1.\\\n0",
    "on\\\ne[tls,\\\n socks]==1.0",
    "one==1.0 \\\n# comment\\\ntwo==2.0",
    "# comment\\\none==1.0",
    "one==1.0 # comment\nsecond==2.0",
    "\n#justtext\n",
    "one==1.0 \\\n\nsecond==2.0",
    "\tFoo [ TLS ] == 01!02.0RC01 # metadata\r\n",
]
facts = []
for text in cases:
    rows = req_file.ignore_comments(req_file.join_lines(enumerate(text.splitlines(), 1)))
    components = []
    for _, line in rows:
        requirement = requirements.Requirement(line)
        specs = list(requirement.specifier)
        assert len(specs) == 1 and specs[0].operator == "==" and not requirement.url and requirement.marker is None
        extra = sorted({utils.canonicalize_name(value) for value in requirement.extras})
        components.append({"ecosystem": "PyPI", "name": utils.canonicalize_name(requirement.name),
                           "version": specs[0].version, "declaredSha256": [], **({"extras": extra} if extra else {})})
    facts.append({"input": text, "components": components})
fixture = {
    "schema": "switchyard-pypi-requirements-oracle/v1", "pipVersion": pip.__version__,
    "packagingVersion": packaging.__version__,
    "sources": [{"module": module.__name__, "sha256": sha256(Path(module.__file__).read_bytes()).hexdigest()}
                for module in [req_file, requirements, utils]],
    "references": ["https://pip.pypa.io/en/stable/reference/requirements-file-format/",
                   "https://packaging.python.org/en/latest/specifications/dependency-specifiers/",
                   "https://packaging.python.org/en/latest/specifications/name-normalization/"],
    "cases": facts,
}
target = Path(__file__).resolve().parent / "fixtures/pypi-requirements-oracle.json"
target.write_text(json.dumps(fixture, indent=2) + "\n")
print(json.dumps({"cases": len(facts), "pipVersion": pip.__version__, "packagingVersion": packaging.__version__, "bytes": target.stat().st_size}))
