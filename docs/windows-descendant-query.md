# Register the restricted owner's native children

The disposable Windows proof now extends its existing QUERY-only token allowance
to exact native descendants of the original restricted owner. This is a candidate
correction for the helper's observed self-token QUERY denial before named Job
creation. Native Windows `cff471e` verifies the first guardian allowance and
reaches the later self-birth phase, clearing named Job creation/configuration.
The original owner remains zero of eight accepted checks; worker and status
registration were not exercised.
[Native receipt](evidence/windows-descendant-query-native-summary.json).

## Bound the allowance

The owner registers a guardian or status helper before sending its request, and
registers an actual worker through the verified
[suspended-worker acknowledgement](windows-worker-acknowledgement.md). The command
does not execute before that worker's registration completes.

The native coordinator serves at most 68 sequential requests inside the
same ninety-second owner deadline. Requests 65–68 are reserved for status helpers;
no guardian or worker can use them. Each request carries its original context
nonce, sequence, role, PID and executable hash. Suspended workers also carry the
creation time observed through the guardian's retained process handle.

The coordinator checks all of these boundaries before applying the allowance:

- The live process belongs to the original owned Job, and is neither the owner
  nor the coordinator. Its creation time has not been registered before.
- Its actual image path and SHA-256 match the locked helper image, or the locked
  Setup image for a worker. Status and guardian roles can only use the helper.
- Its primary token retains the exact user, medium integrity, four restricting
  SIDs, administrators deny-only group and traverse-only privilege contract.
- Its token DACL has the exact three original entries, optionally followed by the
  same user's QUERY-only entry. Existing entries and owner must survive unchanged.
- The only allowed addition is mask **8**. Exact descriptor readback, token
  restrictions, process liveness and original Job membership verify afterward.

The coordinator uses existing limited-query process access; it changes no process
DACL, token default DACL, privilege, group, source account or runtime route. The
original cold/Node evidence count stays two, and all eight owner assertions stay
required. Descendant observations are separate, ordered and bounded.

## Request and failure behavior

A five-second synchronous callback publishes a complete private request without
overwriting a name. Its staging hard link remains until exact outer-fixture
retirement, avoiding a deletion race with the native reader's sharing lock.
The native reply is atomically published. The client checks exact nonce, sequence,
role, PID, hash, observed birth, verified status and QUERY mask before continuing.
A failure ends registration and preserves uncertainty; it never substitutes a
different process, token or runtime.

Public evidence retains fixed stages, booleans and ACL digests, excluding process
paths, PIDs and account identifiers. Unknown fields, reordered sequences, broader
masks and incomplete identity/readback evidence cannot establish acceptance.

## Verification

Nine focused groups pass 88 tests with four declared Windows-only skips. The
final protocol/report/harness follow-up passes 45 tests. Both managed projects
build without warnings or errors; 2,071 existing portable checks and 30 new closed
request parser checks pass. Typecheck and exact owned cleanup pass.
[Source receipt](evidence/windows-descendant-query-source-summary.json).

These checks do not accept the native allowance or the original owner journey.
The actual Windows CI lane must still execute the complete eight-check proof,
including independently verified process exit and exact fixture retirement.

## Self-birth follow-up

The guardian now reads its own creation time through `GetCurrentProcess` and
`GetProcessTimes`, preserving the UTC tick wire format without reopening its PID
or changing its process DACL. The native proof checks liveness using
`GetExitCodeProcess` before and after the QUERY allowance: Microsoft documents
that a live process has an undefined exit-time field. Limited-query access stays
unchanged. Native `dad5400` now verifies guardian readiness and its start acknowledgement.
The original owner still fails before suspended-worker registration, zero of
eight checks. [Native receipt](evidence/guardian-self-birth-native-summary.json).
[Source receipt](evidence/guardian-self-birth-source-summary.json).

Primary references: [current-process pseudo handle](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess)
and [process creation and exit times](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes).

## Final retirement registration

Native `c9a858a` clears setup startup and completes seven of the eight original
owner checks, including actual create, mount/read/write, consumer exclusion,
detach, retirement and replay refusal. The remaining assertion fails during
independent final guardian status checks after all 64 permitted registrations.
The fixture is preserved; complete owner acceptance is not claimed.
[Native receipt](evidence/setup-gui-native-summary.json).

The existing journey performs 17 commands, each requiring guardian, suspended
worker and initial status registration (51). It independently rechecks all 17
retained guardians at retirement, requiring 68 in total. The correction adds
exactly four status-only slots. Both protocol readers and the public report
validator reject a worker/guardian in these slots and reject registration 69.
The deadline, per-request byte bound, original eight assertions, identity,
restricted token and exact QUERY mask 8 remain unchanged.

Both managed targets compile with zero warnings/errors; 2,114 portable checks
pass, including the original parser cases and 13 final-slot checks. Four isolated
groups pass 50 tests with exact cleanup. Native CI must still verify all eight
original owner checks and final fixture retirement.
[Source evidence](evidence/descendant-retirement-source-summary.json).

## Complete restricted-owner acceptance

Native `6e967a3` passes **all eight original owner checks**. Its 68 verified
registrations comprise 17 guardians, 17 workers and 34 status helpers, with mask
8 throughout and only status helpers in the final four slots. Exact native tree
exit, original restricted-token recheck, creator quota restoration, private desktop
closure and both owned fixture removals pass. The outer proof also verifies
service and captured file removal. The original deadline and assertions remain.

Six actual GUI setup preflight checks pass separately. These results accept
the controlled native CI boundary; they do not accept an ordinary user account,
interactive UAC or a launched Windows guest.
[Owner receipt](evidence/windows-restricted-owner-accepted-summary.json),
[setup receipt](evidence/setup-final-native-summary.json).
