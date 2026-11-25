"""Record pure pip/PyPA marker parsing facts using an existing installation.

No marker evaluation, package installation, network or project input access.
Only the named repository fixture is written; portable tests consume its facts.
"""
import json
from hashlib import sha256
from pathlib import Path
import pip
import pip._internal.req.req_file as req_file
import pip._vendor.packaging as packaging
import pip._vendor.packaging.markers as markers
import pip._vendor.packaging.requirements as requirements
import pip._vendor.packaging.utils as utils

variables = ["python_version", "python_full_version", "os_name", "sys_platform",
             "platform_release", "platform_system", "platform_version", "platform_machine",
             "platform_python_implementation", "implementation_name", "implementation_version"]
expressions = [expression for name in variables for op in ["==", "!=", "in"]
               for expression in [f'{name} {op} "synthetic"', f'"synthetic" {op} {name}']]
expressions += [f'python_version {op} "3.12"' for op in ["<", "<=", ">", ">=", "~=", "===", "not in"]]
expressions += [
    'python_version<"3.12"and(sys_platform=="win32"or os_name=="posix")',
    '(python_version >= "3.9" and python_version < "4") or implementation_name == "pypy"',
    '"a" == "a"', 'python_version < python_full_version',
    'platform_version == "NEVER_COPY_LITERAL;#&${PRIVATE}"',
    "platform_version == 'double\"quote'", 'platform_version == "single\'quote"',
    'platform_system\t not\tin\t""',
    '(' * 16 + 'os_name == "posix"' + ')' * 16,
]
cases = ['Demo[TLS,foo_bar]==1.2.3; ' + expression for expression in expressions]
cases += [
    'one==1; python_version < "4" --hash=sha256:' + 'a' * 64,
    'one==1; python_version < "4" \\\n --hash=sha256:' + 'b' * 64 + ' --hash=sha256:' + 'a' * 64,
    'one==1; (python_version < "4" and \\\n os_name == "posix") # metadata\nsecond==2',
    'one==1; os_name == "posix" # continued comment \\\nconcealed==2\nlast==3',
    'one==1;\tpython_version=="3.12"\t\r\n',
]

def marker_variables(node):
    if isinstance(node, markers.Variable):
        return {node.value}
    if isinstance(node, (tuple, list)):
        return set().union(*(marker_variables(value) for value in node))
    return set()

facts = []
for text in cases:
    components = []
    for _, line in req_file.ignore_comments(req_file.join_lines(enumerate(text.splitlines(), 1))):
        args, options = req_file.get_line_parser(None)(line)
        requirement = requirements.Requirement(args)
        specs = list(requirement.specifier)
        assert len(specs) == 1 and specs[0].operator == "==" and not requirement.url
        extras = sorted({utils.canonicalize_name(value) for value in requirement.extras})
        declared_marker = {}
        if requirement.marker is not None:
            expression = args.split(";", 1)[1].strip()
            declared_marker = {"marker": {"sha256": sha256(expression.encode("ascii")).hexdigest(),
                               "variables": sorted(marker_variables(requirement.marker._markers))}}
        components.append({"ecosystem": "PyPI", "name": utils.canonicalize_name(requirement.name),
                           "version": specs[0].version, "declaredSha256": sorted((options.hashes or {}).get("sha256", [])),
                           **({"extras": extras} if extras else {}), **declared_marker})
    facts.append({"input": text, "components": components})
fixture = {"schema": "switchyard-pypi-marker-oracle/v1", "pipVersion": pip.__version__,
           "packagingVersion": packaging.__version__, "markersEvaluated": False,
           "sources": [{"module": module.__name__, "sha256": sha256(Path(module.__file__).read_bytes()).hexdigest()}
                       for module in [req_file, requirements, markers, utils]],
           "references": ["https://pip.pypa.io/en/stable/reference/requirements-file-format/",
                          "https://packaging.python.org/en/latest/specifications/dependency-specifiers/"],
           "cases": facts}
target = Path(__file__).resolve().parent / "fixtures/pypi-marker-oracle.json"
target.write_text(json.dumps(fixture, indent=2) + "\n")
print(json.dumps({"cases": len(facts), "pipVersion": pip.__version__, "packagingVersion": packaging.__version__, "bytes": target.stat().st_size}))
