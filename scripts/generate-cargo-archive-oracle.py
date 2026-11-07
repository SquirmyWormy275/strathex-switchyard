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
    ("literal-string", base + "description = 'literal'\n", False),
    ("empty-string", base + 'description = ""\n', False),
    ("inline-table", base + '[dependencies]\nthing = { version = "1" }\n', False),
    ("array-table", base + '[[bin]]\nname = "example"\n', False),
    ("quoted-table", base + '[target."cfg(unix)".dependencies]\n', False),
    ("duplicate-array", base + 'authors = ["One", "One"]\n', False),
    ("multiline-string", base + 'description = """hello\nworld"""\n', False),
    ("dotted-field", base + 'metadata.tool = "value"\n', False),
    ("duplicate-key", base + 'name = "shadow"\n', False),
    ("duplicate-table", base + '[package]\n', False),
    ("scalar-table-conflict", base + '[package.version]\nvalue = "shadow"\n', False),
    ("unterminated", base + 'description = "unfinished\n', False),
    ("invalid-boolean", base + 'autobins = maybe\n', False),
    ("oversize-integer", base + 'number = 9223372036854775808\n', False),
    ("missing-version", base.replace('version = "1.2.3-rc.1+build.7"\n', ''), False),
]
rows = []
for label, text, supported in cases:
    raw = text.encode()
    try:
        parsed = tomllib.loads(text)
        package = parsed.get('package', {})
        facts = {'parsed': True, 'name': package.get('name'), 'version': package.get('version')}
    except tomllib.TOMLDecodeError:
        facts = {'parsed': False}
    directory = (facts.get('name') or 'example') + '-' + (facts.get('version') or '1.2.3-rc.1+build.7')
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
