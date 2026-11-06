# Observe restricted Windows Job creation

The setup-identity guardian fails `CreateJobObjectW` with Win32 error 5 before
readiness. Its original restricted-owner journey remains unaccepted. This
diagnostic separates three naming cases while preserving the production
launcher and its permissions.

The existing CI-only cold process performs every original RNG/provider/token
observation first. It then tries one anonymous, one `Local` and one `Global`
empty Job using the same restricted primary token. It never assigns a process,
sets limits or changes an ACL. A newly created Job is queried for its active
process count. A name collision is recorded and closed without querying or
configuring that existing object. All returned handles are closed.

Version 5 appends 24 fixed words to the original packet: opened, creation error,
created-new, query success/error, active count, close error and verified close
for each case. The packet is exactly 272 bytes. Managed and JavaScript validators
require coherent outcomes, zero active processes when queried, and verified
cleanup. Unperformed queries remain null. A query failure is diagnostic evidence,
not an empty-Job acceptance claim. Object names, PIDs, raw handles and text never
leave the child.

The production guardian still refuses failed startup. The original eight owner
checks, self-token `TOKEN_QUERY` mask 8, inherited pipe ownership and independent
process/Job cleanup remain unchanged. A successful diagnostic Job cannot accept
the owner, substitute a namespace or justify broader rights.

Six isolated groups / 78 tests, two clean managed builds, 2,071 portable checks
(including 145 packet checks), and typecheck pass. Native C++ build/execution
remains pending; no local Windows SDK was downloaded.
[Source evidence](evidence/windows-cold-job-source-summary.json),
[confirmed guardian failure](evidence/windows-guardian-job-native-summary.json).

API behavior is defined by Microsoft's
[CreateJobObjectW documentation](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-createjobobjectw)
and [kernel object namespaces](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces).
The observations do not establish whether an object DACL or namespace caused
the existing denial.
