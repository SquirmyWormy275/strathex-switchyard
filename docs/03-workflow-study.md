# Workflow Study Protocol

> **Status:** This is a research and future-revision protocol. It does not
> supersede the accepted current control specification. Use it when proposing a
> material control-map change or collecting physical usability evidence.

## Purpose

Determine which controls deserve permanent physical keys by observing actual development work before and after the SXSY-B122 layout is introduced.

## Phase A - structured workflow interview

Capture an ordinary session as a narrative:

- how work begins and resumes;
- how many Codex, Claude, terminal, editor, and browser sessions are active;
- whether agents live in integrated terminals, separate windows, or both;
- how projects, repositories, branches, and worktrees are selected;
- which actions recur through typing, clicking, window switching, or command history;
- how finished agent work is reviewed;
- how permissions, interruptions, redirections, and failures are handled; and
- which actions feel slow, error-prone, or mentally expensive.

Do not force the account into a predefined command list during the interview.

## Phase B - baseline observation

Observe at least ten representative work sessions before installing the candidate layout. For each event, record:

| Field | Description |
|---|---|
| Timestamp | Local time or elapsed session time |
| Intent | What the operator was trying to accomplish |
| Tool/context | Foreground application and relevant session |
| Current method | Mouse, chord, typed command, palette, or window switch |
| Duration | Time from intent to confirmed result |
| Error | Wrong target, wrong command, retry, or none |
| Friction | Operator-rated 1-5 |
| Candidate control | Proposed durable intent, if any |

Do not record source code, credentials, prompts, customer data, or repository secrets in the observation log.

## Phase C - candidate scoring

Score each candidate from 0-3 on:

- frequency;
- time or motion saved;
- cognitive load reduced;
- cross-application durability;
- urgency;
- error reduction; and
- safety suitability for a physical key.

A high raw frequency does not override poor safety suitability. Destructive actions need guarded interaction or stay off the board.

## Phase D - physical trial

Use the candidate layout for at least two weeks. Record:

- activation count by key;
- mouse trips and awkward chords eliminated;
- wrong-key and wrong-context activations;
- time to reach an agent/project;
- time to interrupt a runaway operation;
- legend recall without a reference sheet;
- actions still performed through old methods; and
- keys unused for five or more representative sessions.

## Exit rule

A key graduates to the stable layout only when it is repeatedly used, semantically understood, safe in its supported contexts, and more valuable than the strongest replacement candidate. Publish removals and failures alongside successes.
