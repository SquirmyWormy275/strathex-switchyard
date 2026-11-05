# Native Windows historical byte transport

The historical transport is implemented and software-tested. It connects a
separate private `historyInputs` packet to the native reviewed input stager and
verifies returned packet/witness hashes. The normal reviewed Windows scanner
orchestrator connection now passes software contracts; native NTFS, guest and
installed acceptance are separate checks. [Linux historical scanning](historical-shield-inputs.md)
has installed acceptance.

Only Codebase Audit and Release Shield accept this packet. It binds the exact
bounded first-parent witness, selected paths/depth, HEAD, stopping/shallow metadata
and historical commit/path/blob/mode/size/hash rows. The host independently derives
Git objects; the native parser independently verifies portable paths, closed
metadata, alias ownership, canonical base64, raw Git blob identity and SHA-256.
The native parser does not attest ancestry, freshness, task authority or a scan.

Each commit version uses its own `.switchyard-history/COMMIT/PATH` disposable
alias. Original current files remain physical descriptor-bound inputs. Historical
aliases cannot fall back to a physical source file; combined index/history packets
refuse. Packet buffers are zeroed on success/disposal and failure. Protected state
retains only metadata/digests and ownership; no source or encoded packet is saved.
The existing private NTFS ACL, pinned directory handles, root identities, copy
checks and deadlines remain. Raw historical content is limited to a 320 KiB
transport subset, 256 KiB per version, within the unchanged complete 512 KiB stdin
bound. Repeated versions count toward that transport bound.

The helper and portable proof both compile with zero warnings/errors using the
existing offline .NET 8.0.424 SDK. Sixty-two new portable parser/hash/boundary
checks and all 161 earlier checks pass, including a literal Node JSON/Unicode
path and emoji/NUL payload that must preserve exact original hashes. Receipt
`windows-history-native-build-1793874765049.json` binds the working native
source hashes; owned source/build/cache scratch removed. The earlier 58-check
build is also retained in `windows-history-native-build-1793874618381.json`.
No extra SDK/runtime, service, volume, guest, provider account or keyboard opened.

Four JS packet/CLI-guard cases and seven staging contract checks pass. Five
isolated history/index/native-input/runner groups pass all 40 tests with every
child cleanup verified (`isolated-test-dd6967ce-bdb3-4233-aebc-28e685dfcdbc.json`).
Staging tests explicitly double native NTFS/ACL behavior; they verify exact native
proof hashes, changed/missing-digest refusal, byte/alias bounds, pre-start rejection,
source privacy, original current bytes and independently stopped copy cleanup.
Three surrounding runner/package/deadline-inventory groups pass 42 checks with child cleanup
(`isolated-test-8e1c436d-d5a2-4616-8aea-c699e0ed78e8.json`); type checking passes.
The CI workflow selects both new groups and requires all 62 portable native checks.

A separate disposable Windows CI verifier now exercises actual NTFS staging and
native guardians with one positive packet and two faults injected after JavaScript
validation. It retains only its small JSON receipt and runs before service
lifecycle checks. It opens no guest/service/volume/account/device and makes no Git
freshness claim (`sourceGitObserved:false`). Actual execution is pending; portable
or doubled tests do not substitute for that native result.

The normal host now binds this witness into review, approval and the protected
execution plan, then repeats the task-bound private history read before tools,
image, volume or guest preparation. It verifies post-consumption traversal before
any subsequent stage. Source descriptors and `gitHistoryInputs` are authenticated
in incomplete receipts. General actions, missing consumers and mixed witnesses
refuse before orchestration. Catalog/engine/request/feed files cannot use reserved
Git aliases; ordinary Run/pipeline inputs retain their original physical witnesses.

Six isolated packet/staging/authority/scanner/runner groups pass all 57 tests
(`isolated-test-5a5fd866-14dc-4ffd-8b7e-c207e8b8de52.json`), every child cleanup
verified. The reviewed Codebase Audit and Release journeys consume actual Git
history, ignore deliberately corrupted static alias fixture buffers, find a secret
removed from the current file, authenticate original provenance and preserve
index/worktree/HEAD. The guest is doubled. An actual orchestrator contract checks
that fresh history consumption finishes before tools/storage/guest and that a late
validation refusal removes copies without starting subsequent stages. These are
software contracts, not native NTFS or guest acceptance.

The separate ordinary compatibility run passes seven groups/19 checks but retains
its failed package-size assertion. The [package/recovery correction](suite-release-recovery.md)
passes 38 isolated checks without raising the size budget; the original failed
receipt remains failed. Native Windows/guest acceptance is not inferred.
