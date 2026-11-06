# Private Windows command pipes

The original restricted owner reaches guardian readiness but fails when
`CreatePipe` opens its stdin pipe: Windows error 5, before worker creation.
[Retained native failure](evidence/worker-start-native-summary.json).

The candidate correction supplies an explicit security descriptor when creating
the guardian's three new anonymous command pipes. The descriptor names the
current primary-token user as owner and contains one protected allow entry for
that user, with mask `0x12019f` (file generic read/write). No existing object's
security is modified. The primary token is opened with QUERY mask **8** only;
its exact default-DACL bytes are compared before and after pipe setup.

Microsoft documents that default anonymous-pipe access rules come from the
creator's token, and that restricted tokens must pass both ordinary and
restricting-SID access checks. This supports the descriptor hypothesis; native
execution must still establish that it resolves this particular failure.
[CreatePipe](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-createpipe),
[restricted tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens).

## Creation and readback

All six returned handles must report the exact user owner, protected DACL and
single read/write entry. Other principals, broader masks, callback entries,
inheritance flags, missing/empty/null DACLs and changed owners refuse. Security
buffers are bounded and cleared. Parent-only handles lose their inheritance flag
before the original explicit child handle list is used.

The same process creation, suspended-worker acknowledgement, Job containment,
ninety-second owner deadline and eight owner assertions remain required. Token,
process and default-DACL permissions, restricting SIDs, privileges, accounts and
runtime routes are unchanged. This descriptor identifies the current user; it
does not establish a separate logon-session or compartment identity.

Failed `CreatePipe` calls never publish their output handles to cleanup: Windows
documents those outputs as indeterminate. Successful handles retain their
existing exact ownership and closure paths.

## Verification boundary

Seven focused groups pass **69 tests / five declared Windows-only skips**.
Both managed projects build with zero warnings/errors; the existing **2,101
portable checks** pass. Typecheck and owned cleanup pass. The first helper build
was rejected for two platform-analysis warnings; explicit Windows guarding fixed
those warnings, and its owned output was removed.
[Source receipt](evidence/private-command-pipes-source-summary.json).

The native proof adds **36 checks**: descriptor refusals, three actual pipe
transfers, six handle descriptor checks, exact default-DACL preservation and
handle closure. Those Windows checks have not run locally. Native acceptance
and the original owner journey remain pending; the owner is still **0/8**.

## Retained candidate failure

Native `25f07e9` passes the PE-image check, then fails ordinary setup preflight
before the new pipe proof or original restricted-owner journey runs. The retained
receipt has the generic worker-start refusal; its exact substage was not retained.
The candidate is **unaccepted**. [Failure receipt](evidence/private-command-pipes-preflight-failed-summary.json).

The follow-up retains the existing closed worker-start phase/code in preflight,
and lets the independent native pipe proof run after a failed preflight while
keeping the job failed. Failed pipe proof JSON is retained before throwing.
Readback observations contain fixed phases, counts, masks, flags and owner-match
booleans; they contain no SID strings, paths or pipe names. All 36 native checks
and the original setup assertions remain required. Three focused groups pass
35 tests with five Windows-only skips; two managed builds, 2,101 portable checks,
typecheck and cleanup pass. Native readback acceptance remains pending.
[Source receipt](evidence/private-pipe-readback-source-summary.json).

Native `f7fda6b` now reports the narrower failure: setup stops at
`pipe-security-verify`; the independent proof completes 15 parser checks and
creates its first pipe, then stops at descriptor readback before any descriptor
fields are observed. The complete 36-check proof remains failed. No restricted
owner journey runs. [Retained observations](evidence/private-pipe-readback-failed-summary.json).
The next bounded observation includes handle-presence booleans and the returned
buffer length before descriptor parsing, while retaining every descriptor guard.
Its two managed builds and 2,101 portable checks pass. No descriptor cause is yet
established. [Source receipt](evidence/pipe-buffer-and-task-source-summary.json).
