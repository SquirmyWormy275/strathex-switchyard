# Review and save a scanner setup

The backend saves the exact generated scanner setup after a separate, one-use
review. Saving does not grant task authority or execute the scanner. Linux has
actual save-and-scan evidence. The Windows implementation is connected and
software-tested; actual NTFS acceptance is pending. Frontend controls remain frozen.

Start with the task and installed feed selection described in
[scanner drafts](scanner-recipe-drafts.md). Send that selection to authenticated
`POST /api/suite/coding/scanner-save/review`. The response includes the complete
generated control files, their hashes, a server-generated draft ID and a five-minute
confirmation. No repository file is written during review. The encrypted journal
retains metadata and the selection, not source text or copies of the engine/feeds.

After reviewing those files, submit only the returned ID and token:

```json
{
  "id": "the-returned-draft-uuid",
  "token": "the-returned-confirmation-token"
}
```

Send this to `POST /api/suite/coding/scanner-save/apply`. The backend rebuilds the
same draft identity from freshly verified sources and feeds. Its exact scope must
still match the task, account, workspace, repository snapshot, generated file
hashes and directory identity. Caller-supplied content, commands, paths and
approval overrides are refused.

The save creates one new `switchyard-scan-<uuid>` directory and four or five
control files. Existing directories are never adopted, even when empty. Existing
files are never overwritten. Linux directory descriptors anchor child operations;
exclusive creation, owner/link checks, file synchronization, content readback and
name/descriptor identity checks detect observed replacement. These checks do not
isolate a compromised process using the same operating-system identity.

On Windows, the fixed native helper pins NTFS ancestors and verifies the original
root, directory and file identities. Each operation uses closed request/result
schemas. New files use exclusive creation, flush and exact hash readback; verified
files stay open against replacement during that operation. The helper permits
only generated control names and refuses junctions, hard links, foreign contents
and existing destinations. Each control file is limited to 320 KiB within the
existing 512 KiB private-pipe request limit. Larger drafts refuse before approval.
No privileges, token access or ACLs are changed.

Every Windows helper has durable ownership recorded before readiness. A replacement
cannot start until the original guardian proves retirement. Uncertain exit or
missing file acknowledgement preserves output and ownership for inspection.

Task/account/workspace and installed feed trust, revocation and freshness are
checked between writes. A mode change or stopped operation fences subsequent
writes. The result records only saving: use its `authorityProposal` for a **fresh**
ordinary authority review, then request a separate execution review with the
returned manifest path/hash. The scanner rechecks its inputs and feed trust.

`POST /api/suite/coding/scanner-save/list` returns the current workspace's metadata
history. The history holds at most 32 reviews; it never silently evicts uncertain
ownership records. Confirmations expire after five minutes. Repeating an apply
returns the retained outcome and never repeats filesystem effects.

## Interrupted saves

Intent and ownership progress are durable before each later effect. Startup,
workspace suspension and authenticated `POST /api/suite/coding/scanner-save/recover`
can inspect a prior attempt only after obtaining its original kernel lease. An
active owner cannot be overtaken.

Recovery performs no repository writes or deletions and starts no native task.
If every file had verified ownership recorded, all current names, identities,
hashes and directory contents must still agree before a lost acknowledgement can
be reported as saved. Partial, missing, linked, changed or unfamiliar output is
preserved as `outcome-unconfirmed`. Recovery never resumes an interrupted save.
Its file verification does not refresh authority or establish current feed trust.
Review uncertain output separately; automatic cleanup is not implemented.

## Evidence and limits

The Linux save checkpoint passes **221 tests across 35 groups**, including 23 save
cases, authenticated routes, changed-source/account/feed refusals, interrupted
creation/write/acknowledgement, active-owner exclusion and a real Linux scan after
backend saving and separate authority/execution reviews. Original index/HEAD and
source files are preserved. Typecheck, original test bounds, process retirement,
package/update/rollback/recovery checks and owned test-root cleanup verify.
[Source evidence](evidence/scanner-recipe-save-source-summary.json).

The Windows addition passes **275 tests across 41 groups**, with ten declared
platform skips, plus typecheck and offline compilation of 34 native sources with
zero warnings/errors. The focused run includes Linux saving regressions, Windows
composition/proof-substitution doubles and uncertain native-owner recovery. Four
real NTFS cases are wired into the complete Windows inventory and the independent
`scanner-save` CI lane under the original bounds. They remain unaccepted until a
Windows receipt verifies. The exact 34-file, 1,479,448-byte compiler output and
empty test parent were removed. [Windows source evidence](evidence/windows-scanner-recipe-save-source-summary.json).

The full Linux package stays below its existing 5 MiB test limit by storing the
retained upstream print template losslessly compressed. Bounded decoding verifies
the original SHA-256. Source artwork, frozen frontend and all three exported
formats remain byte-for-byte equivalent; exported-package rebuilding also retains
the template through the full 640-file recovery drill. Earlier failed assertions,
package size and exported-package regression receipts remain recorded.

This does not establish a completed frontend setup journey, native Windows acceptance,
live provider/account commissioning, hardware acceptance or complete security
coverage. Earlier complete-suite receipts remain tied to their original revisions.

Installed Linux `5ec16fe` verifies reviewed-save source within **76 metadata/in-memory
checks and 35 exact module hashes**. All 54 semantic workspaces, selection, pending
keyboard-only conversation and frozen frontend are preserved; 53 sealed files
are byte-identical and one changes only audit metadata. All four profiles and
57 workflows remain compatible. The retained template decodes to its original
hash. Dated backup and launcher readback verify; current plus one rollback remain.
The exact 537-file, 4,692,422-byte prepared bundle is removed. No installed save,
scanner, provider task, account/model request or hardware operation was invoked.
[Installed evidence](evidence/installed-windows-scanner-recipe-save-summary.json).
