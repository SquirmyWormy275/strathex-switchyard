# Reviewed Codex versions

The source adapter admits exactly **0.166.0 and 0.167.0**. A different patch,
future version, malformed hello or unexpected client identity is refused before
account or task access. Installed Linux `51a73c7` includes this contract. Its 76 metadata/in-memory
checks and 44 exact module hashes pass while preserving all 54 workspaces.
[Installed evidence](evidence/installed-codex-0167-summary.json).

Both versions receive the same explicit restrictions before initialization:
42 disabled feature flags, no project instructions, user-reviewed approvals,
disabled web search and individually disabled configured MCP servers. Effective
configuration must read back with those restrictions and the original first-party
route. Configurations are checked again at the repository boundary; a valid
startup configuration cannot authorize a different project's enabled tools.

The 0.167 review found seven new flags and one changed default:

| Change | Restricted behavior |
| --- | --- |
| `apps_early_resource_discovery`, `incremental_exec_tools`, `gcp_setup_wizard` | Explicitly disabled before initialization and required false in readback. |
| `code_mode_host_output_truncation`, `interrupt_on_cancel`, `tui_extensions_statusline`, `suppress_model_change_announcements` | Also explicitly disabled; defaults cannot alter this adapter's contract. |
| `deferred_tool_world_state` defaults to enabled | Explicitly disabled for both reviewed versions. |

The 0.166 source preserves additional boolean feature overrides in its
configuration map. The adapter requires their readback rather than assuming that
an ignored or missing field is safe.

Text review now records the version observed on the original connection. Changing
versions between review and submission invalidates the confirmation even when
both versions are admitted. A new review is required; the recorded turn retains
the version that was actually reviewed.

## Evidence and limits

Native Windows source `9c3bccf` passes all 25 client groups, 237 tests and no
skips. The merge tree matches the source tree, and original commands, deadlines
and child cleanup verify. This includes the version contract in the client lane;
it does not establish authenticated native tasks or full Windows suite acceptance.
[Native client receipt](evidence/windows-codex-0167-client-summary.json).

Twelve focused groups pass **152 tests with two platform skips**, including
synthetic 0.167 metadata/task creation, version changes during text review,
missing/enabled feature refusals, account boundaries, editor carriers and package
construction. [Source receipt](evidence/codex-0167-contract-summary.json).

The installed 0.167 binary also passes the production argument builder and
hello/config validators in an empty owned home with network isolation. Only
`initialize`, `initialized` and `config/read` are sent. All original descendants
exit, and all 66 generated files (3,053,593 bytes) are removed.
[Native configuration receipt](evidence/codex-0167-native-config-summary.json).

That proof covers effective configuration, not live account/task/model behavior
or native TUI handoff. Those remain separate acceptance work. Earlier 0.166
native evidence is retained; this change has no new native 0.166 run.

The review uses the [official App Server contract](https://learn.chatgpt.com/docs/app-server),
[0.166 feature parser](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/features/src/lib.rs),
[0.167 features](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/features/src/lib.rs)
and [0.167 configuration schema](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/config.schema.json).
