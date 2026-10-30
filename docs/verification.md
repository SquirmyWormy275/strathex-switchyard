# What has actually been verified

Switchyard is an integrated development suite. The F77 is its pilot device;
passing software checks does not establish physical or enterprise acceptance.
Use this page for the current evidence, the [requirement ledger](switchyard-requirements.md)
for coverage, and the [continuation record](switchyard-status.md) for details.

| Path | Accepted evidence | Practical limit |
| --- | --- | --- |
| Integrated Linux source | 118/118 groups; 845 tests, 836 passed and nine platform skips at `3a01549`. Receipt `54a0a8ef-d251-4c32-9735-e8f8e2cb2131`. | Synthetic boundary checks plus native Linux subprocesses; Windows cases are separate. |
| Installed host lock indicators | Four checks: authenticated route, independent Linux kernel readback, rejection without credentials and preserved workspace state. | No physical keyboard association or LED change; Windows reports only its calling-thread toggle snapshot. |
| Normal installed Codex task | Seven checks rerun after the shared recovery changes: one reviewed native reply, exact turn acknowledgement, durable duplicates, replay rejection and keyboard-only cleanup. | Read-only/restricted text task; provider completion is not verified coding-task completion. |
| Normal installed Claude task | Thirteen checks: exact creation/continuation, three separately reviewed prompts, distinct recorded/stopped guardians and explicit resume-only recovery after a synthetic lost-acceptance fault. | Original account and UUID retained; no tools or invented native turn IDs. This fault injection is not a claimed physical crash. |
| Native Windows release tests | [225 complete test/build groups at `7aeb1e6`](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41086724429), including real native observer and guardian/owner-loss checks. Receipt `a3672c96-9eca-49bd-a92b-e973ea7d8e94`. | Applies to that checkpoint. New private-pipe/recovery changes await a corrected complete run. |
| Fresh native Windows optional runtime | [Acceptance at `222dfca`](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41097396455): Python 3.12.14, 49 exact distributions, no extras, offline CPU model load, independent same-release recheck and disposable-runtime removal. Bounded artifact `12998575101` was downloaded and its digest verified. | No Windows microphone, configuration HID or signed-in native agent was exercised by this job. |
| Canonical B122 print kit | All six PDF pages and 22 actual-scale SVG inserts rendered and inspected; 26 documentation tests pass. Literal source faces/flaps and clip cuts, reproducible output, 4.75 pt minimum text. | Printer calibration, cap fit, final branded artwork and physical commissioning remain open. |
| Other installed pilot paths | Actual local CPU speech, authenticated Node/Python SDK exchanges, scoped Omarchy callback/restoration, profile migration and managed application/runtime lifecycle checks. | Each path has its own scope in the ledger; an SDK acknowledgement is self-reported. |

The later Windows receipt `60da4861-4e5e-4cf1-a148-5c0a8dc60ac0` is **not an
accepted release**: 226/227 groups passed, but the runner rejected nine skipped
helper tests against an obsolete allowance of eight. Every test body passed.
The skip inventory is corrected, Linux now exercises its platform environment
boundary, and each Windows documentation generator must propagate its own exit
code. [The corrected run](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41102281542)
must finish before newer complete Windows acceptance is claimed. At `3a01549`,
the native backend tests passed but documentation verification exposed Windows
checkout line-ending conversion. Text checkouts now explicitly use LF; retained
vendor source bytes remain exempt. A corrected full run is still required. Earlier
step-level success does not retroactively validate a masked generator failure.

## Follow a result into the code

1. Start the [keyboard/workflow experience](../README.md#try-the-starting-experience).
   A reference preset is useful offline; actual readout establishes typing evidence.
2. Follow the [native task journey](native-coding-tasks.md) to see how account,
   directory, exact native identity, approval and duplicate prevention work together.
3. Inspect the [device transaction contract](device-configuration-contract.md)
   and [runtime lifecycle](runtime-lifecycle.md) for partial failures and recovery.
4. Read the [custom-agent contract and examples](../integrations/README.md) before
   adding another integration. Discovery, observation, focus and execution are
   different capabilities.

The standard source checks use the pinned runtime:

```sh
mise exec node@24.14.0 -- npm test
mise exec node@24.14.0 -- npm run typecheck
```

Documentation verification uses the pinned
[Python dependencies](../scripts/b122-docs-requirements.txt), with Node 24 also on
the process path. Native account journeys are explicit synthetic checks: the
Codex script sends one tiny prompt; the Claude script sends three and injects a
fault only into its own validation task. Read their usage headers before running
them. Private pilot receipts retain the detailed local evidence; access links,
account details, session IDs and recovery snapshots stay outside Git.

## Work still required

Unfinished implementation includes the accumulated frontend controls, broader
terminal/client attachment and provider lifecycle containment, execution-authority
integration and remaining controller controls. The frontend is frozen for review;
its served hash has been verified, but current browser visual acceptance is open.

Device discovery last returned zero configuration interfaces. F77/B122 typing,
unlock, hot-plug and hardware transaction acceptance need their actual devices.
Approved Microsoft tenant tests, interactive Windows account/window tests,
microphone capture and physical print fit also remain separate. No flash/reset,
bootloader operation, solenoid change, public release or employer approval is
established by these results.
