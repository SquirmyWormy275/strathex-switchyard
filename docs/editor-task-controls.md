# Use saved Switchyard tasks in your editor

The extension now contributes three commands to VS Code's Command Palette.
They use the selected Switchyard workspace and the existing signed local clients.
Starting the extension registers commands without opening a client or launching
anything.

1. **Switchyard: Browse Saved Project Tasks** shows saved projects, then their
   eligible task labels. Selecting a row performs no action. An empty inventory
   does not mean the computer has no projects; it means Switchyard has no eligible
   saved owned tasks in the selected workspace.
2. **Switchyard: Connect Saved Task in Terminal** selects the project and exact
   task, checks that the same local project is open in this editor window, and
   presents a separate terminal review. Cancel is the initial choice. Confirming
   uses the existing target/review/issue/consume and connection contracts.
3. **Switchyard: Return to Connected Terminal** focuses an exact terminal already
   owned by this editor connection. It does not create a replacement or type a
   command into an unrelated terminal.

Linux resolves the executable from the authenticated owner's exact PID and
verifies it against the reviewed image digest. Windows asks for the installed
native Codex executable, then uses the existing image/identity checks. A file
selection never grants launch authority. Missing or mismatched evidence refuses;
there is no plain-file endpoint or alternate runtime fallback. Windows process
access remains 0x101000 and token access remains QUERY 8.

Changing project/window context while a review is pending invalidates it.
Deactivation cancels unresolved pickers and joins the existing bounded retirement
operations. A late selection cannot revive an operation. Failure to verify
retirement remains an error with the original records retained.

## What a connected terminal proves

The UI reports exact terminal focus and connection acknowledgement separately.
It explicitly does not claim native task attachment, task completion or a
submitted model prompt. Those require independent native evidence. Claude Code
attachment remains unfinished because its existing command can restart a stopped
session; it is not silently substituted.

## Verification and availability

The pilot's existing extension is now updated from source `99784a7` through the
local VSIX packaging workflow. All 53 payload files and the three command
declarations verify. The original extension and registry have dated, verified
backups; the owned build/package staging is removed. An already-open editor may
need its normal reload before the new commands appear.
[Installed evidence](evidence/installed-editor-commands-summary.json).

Command registration, injected-argument refusal and returning without an owned
terminal also pass against the installed CommonJS module using an explicit editor
surface double. This is not an interactive editor or native attachment claim.

Seven command interaction cases use a VS Code/session fixture: no-I/O startup,
read-only browsing, exact review, cancel at every picker, stale/substituted choice
refusal, owned return, deactivation and uncertain retirement. Ten original groups
pass 107 tests with one declared platform skip. Three final groups pass 36 tests
with overlap, including late executable-picker refusal. Type checking passes.

The final CommonJS build loads with its six runtime modules and registers all three
commands without I/O. Its 51 files/1,110,340 bytes of staging are removed after
verification. Interactive VS Code, live account/task and native Windows activation
remain unaccepted. [Evidence](evidence/editor-commands-source-summary.json).
