"""Synthetic USTAR/gzip and TOML reference facts; no Cargo, build or network."""
import base64
import gzip
import hashlib
import io
import json
import pathlib
import platform
import tarfile
import tomllib

base = '[package]\nname = "example"\nversion = "1.2.3-rc.1+build.7"\n'
cases = [
    ("minimal", base, True),
    ("comments", '# heading\n' + base.replace('[package]', '[package] # table').replace('name =', 'name\t=') + '# end\n', True),
    ("crlf", base.replace('\n', '\r\n'), True),
    ("array", base + 'authors = [\n"Synthetic One", # comma\n"Synthetic Two",\n]\n', True),
    ("scalars", base + 'autobins = false\n[lib]\nname = "example"\n[profile.release]\nopt-level = 3\n', True),
    ("nested", base + '[package.metadata.tool]\ncount = -9223372036854775808\n[package.metadata]\nlabel = "declared"\n', True),
    ("unicode", base + 'description = "Synthetic café"\n', True),
    ("escaped", base + 'description = "A \\"quoted\\" # literal"\n', True),
    ("signed-zero", base + 'number = +0\n', True),
    ("uppercase", base.replace('example', 'Example'), True),
    ("other-build", base.replace('build.7', 'build.8'), True),
    ("literal-string", base + "description = 'literal'\n", True),
    ("empty-string", base + 'description = ""\n', True),
    ("inline-table", base + '[dependencies]\nthing = { version = "1" }\n', True),
    ("array-table", base + '[[bin]]\nname = "example"\n', True),
    ("quoted-table", base + '[target."cfg(unix)".dependencies]\n', True),
    ("duplicate-array", base + 'authors = ["One", "One"]\n', True),
    ("multiline-string", base + 'description = """hello\nworld"""\n', False),
    ("dotted-field", base + 'metadata.tool = "value"\n', False),
    ("duplicate-key", base + 'name = "shadow"\n', False),
    ("duplicate-table", base + '[package]\n', False),
    ("scalar-table-conflict", base + '[package.version]\nvalue = "shadow"\n', False),
    ("unterminated", base + 'description = "unfinished\n', False),
    ("invalid-boolean", base + 'autobins = maybe\n', False),
    ("oversize-integer", base + 'number = 9223372036854775808\n', False),
    ("missing-version", base.replace('version = "1.2.3-rc.1+build.7"\n', ''), False),
    ("quoted-package", base.replace('[package]', '["package"]'), True),
    ("literal-package", base.replace('[package]', "['package']"), True),
    ("quoted-name", base.replace('name =', '"name" ='), True),
    ("literal-version", base.replace('version =', "'version' ="), True),
    ("escaped-name", base.replace('name =', '"\\u006eame" ='), True),
    ("empty-literal", base + "description = ''\n", True),
    ("literal-backslash", base + "description = 'back\\slash # unescaped'\n", True),
    ("literal-unicode", base + "description = 'café'\n", True),
    ("mixed-string-array", base + "authors = ['One', \"Two\", '', 'One']\n", True),
    ("literal-platform", base + "[target.'cfg(target_arch = \"wasm32\")'.dependencies.thing]\nversion = '1'\n", True),
    ("table-whitespace", base + "[ target . 'cfg(unix)' . dependencies ]\nthing = '1'\n", True),
    ("key-with-markers", base + "'key.#=[]' = 'value # end' # comment\n", True),
    ("empty-table-key", base + "['']\n'' = ''\n", True),
    ("literal-dot-distinct", base + '["package.metadata"]\nvalue = "one"\n[package.metadata]\nvalue = "two"\n', True),
    ("nested-parent-implicit", base + "[package.'metadata'.tool]\nvalue = 'one'\n[package.metadata]\nvalue = 'two'\n", True),
    ("map-key-names", base + "[package.metadata.__proto__]\nconstructor = 'inert'\n", True),
    ("identity-alias-duplicate", base + '"name" = "shadow"\n', False),
    ("escaped-identity-duplicate", base + '"\\u006eame" = "shadow"\n', False),
    ("table-alias-duplicate", base + "['package']\n", False),
    ("scalar-quoted-table", base + '[package."version"]\nvalue = "bad"\n', False),
    ("quoted-scalar-table", base + '"metadata" = "scalar"\n[package.metadata]\n', False),
    ("table-quoted-scalar", base + '[package.metadata.tool]\nvalue = "one"\n[package.metadata]\n"tool" = "scalar"\n', False),
    ("quoted-dot-not-package", base.replace('[package]', '["package.name"]'), False),
    ("unterminated-literal", base + "description = 'unfinished\n", False),
    ("unterminated-quoted-key", base + "['unfinished]\nx = 'value'\n", False),
    ("trailing-dot-table", base + '[package.metadata.]\n', False),
    ("adjacent-quoted-keys", base + '[package."metadata""tool"]\n', False),
    ("multiline-literal", base + "description = '''hello\nworld'''\n", False),
    ("dotted-field-still-unsupported", base + "metadata.'tool' = 'value'\n", False),
    ("quoted-array-table", base + "[['bin']]\nname = 'example'\n", True),
    ("inline-table-literal", base + "[dependencies]\nthing = { version = '1' }\n", True),
    ("unicode-eight-digit-still-unsupported", base + 'description = "\\U0001F600"\n', False),
    ("multiple-binaries", base + '[[bin]]\nname = "one"\npath = "src/one.rs"\n[[bin]]\nname = "two"\npath = "src/two.rs"\n', True),
    ("mixed-targets", base + '[[bin]]\nname = "cli"\n[[example]]\nname = "demo"\n[[test]]\nname = "integration"\n[[bench]]\nname = "speed"\nharness = false\n', True),
    ("empty-array-element", base + '[[bin]]\n[[bin]]\nname = "last"\n', True),
    ("array-key-aliases", base + '[[bin]]\nname = "one"\n[["bin"]]\nname = "two"\n', True),
    ("nested-array-tables", base + '[[package.metadata.rows]]\nname = "one"\n[[package.metadata.rows.parts]]\nname = "first"\n[[package.metadata.rows.parts]]\nname = "second"\n[[package.metadata.rows]]\nname = "two"\n[[package.metadata.rows.parts]]\nname = "third"\n', True),
    ("array-child-scopes", base + '[[bin]]\n[bin.metadata]\nlabel = "one"\n[[bin]]\n[bin.metadata]\nlabel = "two"\n', True),
    ("array-latest-scalar-scope", base + '[[bin]]\nmetadata = "one"\n[[bin]]\n[bin.metadata]\nlabel = "two"\n', True),
    ("array-implicit-parent", base + '[[package.metadata.rows]]\nname = "one"\n[package.metadata]\nlabel = "parent"\n', True),
    ("literal-dot-array-distinct", base + '[["bin.metadata"]]\nname = "one"\n[[bin.metadata]]\nname = "two"\n', True),
    ("array-prototype-names", base + '[[package.metadata.__proto__]]\nconstructor = "inert"\n[[package.metadata.__proto__]]\nconstructor = "still inert"\n', True),
    ("root-array-before-package", '[[bin]]\nname = "cli"\n' + base, True),
    ("array-header-comments", base + "[[ 'bin' ]] # target\nname = 'one'\n[[bin]]\nname = 'two'\n", True),
    ("array-package-not-identity", base.replace('[package]', '[[package]]'), False),
    ("array-package-then-table", base.replace('[package]', '[[package]]') + '[package]\n', False),
    ("ordinary-table-then-array", base + '[bin]\nname = "one"\n[[bin]]\n', False),
    ("implicit-table-then-array", base + '[bin.metadata]\nlabel = "one"\n[[bin]]\n', False),
    ("array-then-ordinary-table", base + '[[bin]]\nname = "one"\n[bin]\n', False),
    ("scalar-then-array", 'bin = "scalar"\n' + base + '[[bin]]\n', False),
    ("static-array-then-array", 'bin = []\n' + base + '[[bin]]\n', False),
    ("array-duplicate-field-alias", base + '[[bin]]\nname = "one"\n"name" = "two"\n', False),
    ("array-duplicate-child", base + '[[bin]]\n[bin.metadata]\nlabel = "one"\n[bin.metadata]\n', False),
    ("array-latest-scalar-conflict", base + '[[bin]]\n[bin.metadata]\nlabel = "one"\n[[bin]]\nmetadata = "two"\n[bin.metadata]\n', False),
    ("nested-array-table-conflict", base + '[[bin]]\n[[bin.metadata]]\nlabel = "one"\n[bin.metadata]\n', False),
    ("array-missing-close", base + '[[bin]\nname = "one"\n', False),
    ("array-extra-close", base + '[[bin]]]\nname = "one"\n', False),
    ("array-empty-header", base + '[[]]\n', False),
    ("inline-empty", base + 'metadata = {}\n', True),
    ("inline-mixed", base + '[dependencies]\nthing = { version = "1", features = ["a", "b",], optional = true, priority = -2 }\n', True),
    ("inline-nested", base + 'metadata = { tool = { name = "nested", enabled = false }, count = 3 }\n', True),
    ("inline-quoted-keys", base + 'metadata = { "name" = "one", \'dotted.key\' = "literal", "" = \'empty\' }\n', True),
    ("inline-markers", base + 'metadata = { a = "{},[]#=", b = \'# {} , [] =\' } # outside\n', True),
    ("inline-prototype-keys", base + 'metadata = { __proto__ = { constructor = "inert" }, toString = "data" }\n', True),
    ("inline-integer-bounds", base + 'metadata = { low = -9223372036854775808, high = 9223372036854775807, zero = +0 }\n', True),
    ("inline-empty-arrays", base + 'metadata = { values = [ ], repeated = ["a", "a"] }\n', True),
    ("inline-array-table-element", base + '[[bin]]\nmetadata = { name = "first" }\n[[bin]]\nmetadata = { name = "second" }\n', True),
    ("inline-depth-16", base + 'metadata = ' + '{ a = ' * 16 + 'true' + ' }' * 16 + '\n', True),
    ("inline-depth-17", base + 'metadata = ' + '{ a = ' * 17 + 'true' + ' }' * 17 + '\n', False),
    ("inline-duplicate-alias", base + 'metadata = { a = "one", "a" = "two" }\n', False),
    ("inline-escaped-alias", base + 'metadata = { a = "one", "\\u0061" = "two" }\n', False),
    ("inline-nested-duplicate", base + 'metadata = { x = { a = "one", a = "two" } }\n', False),
    ("inline-trailing-comma", base + 'metadata = { a = "one", }\n', False),
    ("inline-double-comma", base + 'metadata = { a = "one",, b = "two" }\n', False),
    ("inline-missing-comma", base + 'metadata = { a = "one" b = "two" }\n', False),
    ("inline-missing-close", base + 'metadata = { a = "one"\n', False),
    ("inline-extra-close", base + 'metadata = { a = "one" }}\n', False),
    ("inline-missing-equals", base + 'metadata = { a "one" }\n', False),
    ("inline-missing-value", base + 'metadata = { a = }\n', False),
    ("inline-integer-overflow", base + 'metadata = { a = 9223372036854775808 }\n', False),
    ("inline-dotted-key-unsupported", base + 'metadata = { a.b = "one" }\n', False),
    ("inline-reopen-table", base + 'metadata = { a = "one" }\n[package.metadata]\nb = "two"\n', False),
    ("inline-reopen-array-table", base + 'metadata = { a = "one" }\n[[package.metadata]]\nb = "two"\n', False),
    ("inline-root-package-not-identity", 'package = { name = "example", version = "1.2.3-rc.1+build.7" }\n', False),
    ("inline-name-not-identity", base.replace('name = "example"', 'name = { value = "example" }'), False),
    ("inline-multiline-unsupported", base + 'metadata = {\na = "one"\n}\n', False),
]
rows = []
for label, text, supported in cases:
    raw = text.encode()
    try:
        parsed = tomllib.loads(text)
        package = parsed.get('package', {})
        facts = {'parsed': True, 'name': package.get('name') if isinstance(package, dict) else None, 'version': package.get('version') if isinstance(package, dict) else None}
    except tomllib.TOMLDecodeError:
        facts = {'parsed': False}
    directory = (facts['name'] if isinstance(facts.get('name'), str) else 'example') + '-' + (facts['version'] if isinstance(facts.get('version'), str) else '1.2.3-rc.1+build.7')
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for path, data in [(directory + '/Cargo.toml', raw), (directory + '/src/lib.rs', b'// NEVER_EXECUTE_REFERENCE_SOURCE\n')]:
            member = tarfile.TarInfo(path)
            member.mode = 0o644
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    tar = stream.getvalue()
    encoded = gzip.compress(tar, mtime=0)
    rows.append({'id': label, 'supported': supported, 'toml': facts, 'manifestSha256': hashlib.sha256(raw).hexdigest(), 'expandedBytes': len(tar), 'sha256': hashlib.sha256(encoded).hexdigest(), 'bytesBase64': base64.b64encode(encoded).decode()})
result = {'schema': 'switchyard-cargo-archive-oracle/v1', 'python': platform.python_version(), 'libraries': ['tomllib', 'tarfile.USTAR_FORMAT', 'gzip'], 'cases': rows}
target = pathlib.Path(__file__).parent / 'fixtures/cargo-archive-oracle.json'
target.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'cases': len(rows), 'bytes': target.stat().st_size}))
