# Check the files listed inside a selected Python wheel

Supply Chain and Release Shield compare a selected wheel's `RECORD` entries with
the bytes of its ZIP members. A matching outer artifact hash and package identity
cannot hide a stale internal file hash: a supported mismatch produces a failed
`artifact.record-mismatch` finding. The scanner reads bounded memory buffers;
it never extracts, imports, installs or executes a package.

This extends [wheel identity](python-wheel-identity.md). The outer declared hash,
embedded name/version and internal RECORD result remain separate observations.
Each comparison is against a declaration supplied with the artifact. None proves
who published it, whether its code is safe or whether it works on this machine.

## Supported declarations

The existing ZIP reader first verifies structure, paths, lengths, compression and
CRC values. The RECORD reader then accepts three-field CSV with LF or CRLF lines,
unquoted or fully quoted fields, and exact case-sensitive member paths. A quoted
path may contain a comma. Existing portable ASCII archive-path restrictions remain;
multiline fields and quote-bearing member paths are unsupported.

Every regular member except RECORD and its two legacy signature companions must
appear exactly once with a SHA-256, SHA-384 or SHA-512 digest and a canonical
decimal size. The digest is canonical URL-safe base64 without padding. RECORD
must list itself with empty hash and size. Directory rows, unknown/missing members,
duplicate paths, hashes/sizes on the self-entry, listed signature companions and
supported digest/size mismatches fail the comparison. A missing required file hash
also fails. The rules follow the
[wheel RECORD contract](https://packaging.python.org/en/latest/specifications/binary-distribution-format/)
and [CSV encoding](https://packaging.python.org/en/latest/specifications/recording-installed-packages/).

Unsupported algorithms, malformed CSV/encoding, noncanonical digests or sizes,
empty sizes and exceeded parser bounds retain incomplete coverage. The scanner
does not infer a hash match from ZIP CRC values. An observed member mismatch takes
precedence over an unsupported hash declaration elsewhere in an otherwise parsed
record. Missing/empty RECORD still prevents the earlier wheel identity inspection.

RECORD is limited to 256 KiB, 1,024 rows and 1,024 ASCII characters per row.
The original archive, input and shared expansion limits remain unchanged. Member
buffers remain in memory only, bounded by the existing four-MiB archive limit.
`RECORD.jws` and `RECORD.p7s` may be absent from the list; their signatures are
**not verified**, and publisher-provenance gaps remain mandatory.

## Reports and limits

`artifact.archive.record` contains a status, RECORD SHA-256 and either the number
of regular members requiring hashes or a fixed unsupported reason. It never
contains member paths, CSV rows, source code or metadata descriptions. CycloneDX
binds the same fields. Unsupported/mismatched results require
`python_wheel_record_not_verified`; mismatches bind their failed finding to the
requirements file, pin, selected artifact and RECORD digest. The original finding
ceiling and protected incomplete receipts remain in force.

All results remain incomplete. Internal hash consistency does not verify publisher
identity, signatures, compatibility tags, resolved dependencies, license contents
or executable behavior. Those remain separate implementation requirements.

## Reproduce the reference facts

```sh
python3 -I -B scripts/generate-pypi-wheel-record-oracle.py
```

The existing Python standard library creates and rereads thirty synthetic wheels
in memory using `zipfile`, `csv` and `hashlib`. Only the JSON fixture is written;
no package or runtime is downloaded. It records the source hashes, outer and RECORD
digests, CSV facts, supported hashes, quoted paths, excluded signatures, deliberate
member inconsistencies and parser-limit cases. The original fifteen wheel-identity
fixtures remain unchanged. Portable checks consume these committed facts without
requiring Python.

Installed 7dbb0b8 passes twelve Python metadata/in-memory checks inside its
46-check update. All fourteen module hashes, 54 workspace snapshots and frozen
frontend verify. Its prepared bundle is removed; only current plus one rollback
remain. [Installed evidence](evidence/installed-python-records-summary.json).
Native Windows RECORD acceptance remains pending. Actual source scanner journeys and Windows guest doubles have
separate results; a double does not establish native guest execution.

Thirty focused groups pass 147 distinct checks, including six actual Linux scans,
six Windows guest doubles, all sixteen installation/recovery cases and exact
packaged frozen-asset HTTP readback. Typecheck and owned scratch cleanup pass.
The initial two missing-check regressions and subsequent package-size failure
remain recorded. The corrected synthetic package is 5,234,726 bytes, below the
unchanged 5 MiB limit. [Source evidence](evidence/pypi-wheel-record-source-summary.json).
