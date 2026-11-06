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
