# Observe one Claude Code session

Switchyard can retain a small status history from a Claude Code session you select.
It does not read that session's transcript, send prompts, approve tools, attach a
terminal or prove that work finished. These local hook reports have their own
**unverified** provenance, distinct from Switchyard's native task observations.

1. In a Personal workspace, enable companion mode. Open **Activity**, select
   **Selected Claude Code hooks**, and start the selected sources. Existing agent
   recording consent does not enable this source.
2. Expand **Connect one Claude Code session**. Enter the exact native session ID
   you intend to observe, then choose **Preview hook settings**. A terminal title,
   project name or a different saved task is not a session ID.
3. Review the generated entries and merge them with the hooks you already use in
   Claude Code. The preview does not install or overwrite settings. Keep other
   hooks intact. Use the same user and local Switchyard state environment as the
   running application. Regenerate the preview after an application update if its
   pinned release path is retired.
4. Keep that workspace selected. Refresh Activity to inspect recorded metadata.
   Pause, resume, stop and delete use the existing observation controls. A deleted
   destination is never recreated by a hook. A new recording needs new settings.

The generated recipe uses a fixed Node executable and separate arguments, with
failure configured to continue the native operation. It observes SessionStart,
UserPromptSubmit, two Notification categories, Stop, StopFailure and SessionEnd.
The meaning and input transport come from the vendor's
[hook reference](https://code.claude.com/docs/en/hooks#hook-input-and-output) and
[command-hook contract](https://code.claude.com/docs/en/hooks#command-hook-fields).
Native invocation on the installed Claude version remains a separate check.

Only fixed event/status names, a workspace-specific identity digest and the hook
process's invocation time enter the existing encrypted observation. Prompt text,
responses, tool inputs, transcript paths, directory paths, notification text and
account hints are discarded. The hook does not open any path in its input. Nested
agent events, other session IDs and unsupported event kinds are ignored. Input is
bounded to 256 KiB; an oversized event is omitted, never partially recorded.

Stop means the provider finished a response. Background work may remain, and an
interrupted turn may emit no Stop event. SessionEnd is a local report, not an
independent process-exit witness. The bridge cannot prove that Claude itself sent
the JSON: another process running as the same user could invoke it. It grants no
native session or task authority.

The original consent generation and invocation time survive storage waits.
Reports waiting across pause/resume, a changed workspace or source consent cannot
enter the replacement interval. Stale, duplicate and out-of-order reports are
omitted. The existing 2,000-event limit pauses capture; the workspace's retention
and deletion rules apply. No automatic retry or history backfill occurs.

For developers, the command entry is [claude-hook.mjs](../integrations/claude-hook.mjs).
It reads one bounded JSON object from stdin, produces no stdout, and returns 1
with a fixed diagnostic if observation fails. It never returns a tool decision or
additional model context. The parser and recorder are in
[claude-hook-observation.mjs](../tools/layout-studio/claude-hook-observation.mjs).
The implementation reuses existing encrypted storage and kernel leases; no
daemon, new runtime, model or dependency is installed.

Software checks exercise separate hook processes, encrypted files, concurrent
writes, deletion, consent races and actual authenticated HTTP settings previews.
Provider events and the OS credential service are explicit test doubles. No live
Claude settings, account, session or prompt has been changed for this work.

Eight original groups pass 111 tests with no skips; fourteen running-preview checks
pass. The original expired synthetic-fixture failure is retained.
[Exact source evidence](evidence/claude-hook-source-summary.json).

Normal installed source `23293d1` passes 58 served-asset/API checks and 103
metadata checks across 60 exact modules. All 54 semantic workspaces and 57
workflow definitions are preserved, with dated launcher backups and one rollback.
The exact prepared package is removed. Three new pure installed checks verify
the hook parser, consent boundary and installed recipe path without invoking
Claude or changing native settings.
[Installed evidence](evidence/installed-claude-hook-controls-summary.json).
