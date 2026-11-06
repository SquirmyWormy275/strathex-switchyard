# Windows backend scheduling and incomplete runs

The preliminary backend still runs four independent jobs, each with its original
twenty-minute bound. Every required file and exact scenario is assigned once.
The original child objects, execution limits, skip counts and acceptance rules
remain unchanged.

Array-index round robin shifted long cases between batches whenever a file was
added. The current inventory gave one batch about 1,117 seconds of historical
estimated work before checkout, Python and native-helper setup. The scheduler
now places the longest estimated groups first into the least-loaded batch, then
executes each batch in the original manifest order. A deterministic tie break
makes the assignments reproducible.

The committed cost profile comes from all 198 groups in the four accepted native
`9f35961` receipts, whose digests match the published evidence. Two newer groups
use a sixty-second scheduling estimate. That value is not an execution deadline.
The 200 current groups estimate about 894 seconds per batch. These observations
guide placement; they do not guarantee future performance or accept a later
source revision. No test is omitted, retried automatically or granted extra time.

The Windows wrapper also reports each exact group before start and after exit.
Progress contains the fixed group identity, phase, ordinal, duration and acceptance
flag, without child output or native diagnostics. Every progress record explicitly
has `verificationComplete: false`. Only the final receipt establishes the run's
result. A reporter failure still allows owned children and cleanup to finish,
retains the final receipt and makes overall verification unsuccessful.

The motivating `cadbccd` shard ended after twenty minutes three seconds, with
no final receipt and an empty artifact upload. Its log only says the operation
was cancelled; the precise active child and cause remain unestablished. Progress
will make a later interruption diagnosable. That original run remains unaccepted.
[Cancellation evidence](evidence/windows-cad-cancelled-backend-summary.json).

The historical workload regression fails under round robin and passes after
balancing. Four source groups pass 40 checks, including exact inventory coverage,
unchanged job bounds, progress privacy, reporter faults, preflight refusal and
the full package budget. Typecheck and exact owned cleanup pass. Corrected native
Windows scheduling acceptance remains pending.
[Source evidence](evidence/windows-measured-scheduling-source-summary.json).
