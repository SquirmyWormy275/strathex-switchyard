# SXSY-B122 operator quick guide

This is the text companion to `output/pdf/SXSY-B122-operator-quick-guide.pdf`. The canonical source remains `packages/protocol/generated/b122-control-map.json`: 22 controls, 65 settled chord behaviors, and 111 intentionally unassigned combinations.

## Banks

| Logical order | Agent control plane | Logical order | Workspace command bar |
|---|---|---|---|
| A01 | RE-ANCHOR | W01 | CLAUDE |
| A02 | PROOF | W02 | CHATGPT |
| A03 | OPTION PROVIDER | W03 | VS CODE |
| A04 | PLAN EXPANDER | W04 | TERMINAL |
| A05 | PLAN APPROVAL | W05 | COMMIT |
| A06 | HANDOFF | W06 | GITHUB |
| A07 | FIND BLOCKED | W07 | COMPOUND |
| A08 | FIND FINISHED | W08 | RUN |
| A09 | AUTHORITY REFRESH | W09 | VOICE |
| A10 | COUNCIL | W10 | PIPELINE |
|  |  | W11 | SHIELD |
|  |  | W12 | SANDBOX |

`A01` through `A10` and `W01` through `W12` are documentation order only. They are not matrix coordinates and do not settle the final position of a control within its bank.

## Modifier vocabulary

- N: normal
- S: Shift
- A: Alt
- S+A: Shift+Alt
- C+S+A: Ctrl+Shift+Alt

Ctrl, Ctrl+Shift, and Ctrl+Alt are intentionally unassigned for every control. The PDF gives the canonical summary for every assigned chord; generated physical inserts show the four available secondary chord labels and mark the rest `RESERVED`.

## Authority boundary

A chord is a request, not ambient authority. It never by itself authorizes a repository mutation, credential use, prompt submission, merge, push, force action, containment release, or agent approval. The mediated host must still resolve the exact target, scope, evidence, confirmation, and current policy.

Managed Stop may terminate only a process SXSY registered and launched. It must not infer ownership from a window title or terminate an unrelated terminal.

## Print and commissioning

Print A4 at actual size / 100%; disable fit and shrink. Measure the 15 mm reference box before cutting. Do not install a udev identity, flash firmware, or mark any hardware gate accepted until the actual B122 is identified, its factory Vial configuration is preserved, and the 176 chord slots and lifecycle cases are observed.
