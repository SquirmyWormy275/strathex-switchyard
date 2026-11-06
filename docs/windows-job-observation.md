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
now passes for source ad4d5e6: all three new empty-Job cases succeed, as do the
original token/RNG and cleanup checks. The actual guardian still fails Job creation
with error 5; this result does not explain that descendant-context difference.
No local Windows SDK was downloaded.
[Native evidence](evidence/windows-cold-job-native-summary.json).
[Source evidence](evidence/windows-cold-job-source-summary.json),
[confirmed guardian failure](evidence/windows-guardian-job-native-summary.json).

API behavior is defined by Microsoft's
[CreateJobObjectW documentation](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-createjobobjectw)
and [kernel object namespaces](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces).
The observations do not establish whether an object DACL or namespace caused
the existing denial.

## Compare the existing self-query allowance

Native `0a0dd11` confirms the actual failed guardian also receives error 5 from
its own `OpenProcessToken` call with QUERY mask 8. The original restricted owner
remains 0/8. This does not yet identify the exact process/token DACL or prove which
internal access caused Job creation to fail.
[Exact native evidence](evidence/windows-guardian-query-native-summary.json).

The next CI-only comparison runs the same cold image once without its existing
self-query allowance, then preserves the original cold and Node checks unchanged.
It grants no additional rights and cannot satisfy the original self-query/owner
assertions. Six groups / 79 tests, two managed builds / 2,071 portable checks,
typecheck and owned cleanup pass. Paired native execution remains pending.
[Source evidence](evidence/windows-unmodified-cold-source-summary.json).
