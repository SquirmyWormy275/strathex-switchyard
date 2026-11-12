# Turn a voice note into a design draft

Open **Activity → Voice notes for design**. Choose a saved note by its time and
transcript preview, or select **Start voice** to request microphone permission.
Recording requires a Personal workspace in companion mode and an available local
transcription runtime. Browsing existing notes opens no microphone and starts no
recognizer.

If you already have a transcript, expand **Add an existing transcript**, paste its
text and choose **Save imported transcript**. This works in a Personal keyboard-only
workspace without a microphone, recognition runtime or assistant account. Work's
recording policy refuses imports. The note identifies its source as user-provided
text; it does not certify the original recording or recognition. Review and save
its words separately before placing them in a design draft.

A lost import reply retains the pasted text and its request identity. Inspect the
saved notes first; deliberately retrying unchanged text returns the original note
without overwriting later corrections. Changed text cannot reuse that identity.
Import refuses when 100 notes are retained, preserving their pending audio. The
existing workspace retention period and explicit deletion still apply.

**Pause voice** releases the microphone and finishes delivery of its current
segment. **Resume voice** requests microphone access for that same note. **Stop**
ends capture for that note; saved pending audio can still be retried deliberately.
Changing workspace or operating mode releases capture and finishes its original
note first. A permission prompt that resolves after that change cannot start a
recording in the new workspace.

Correct the transcript, then select **Save corrected transcript**. **Use in design
draft** is a separate local action; it requires the saved correction and preserves
an existing unsent draft. Review the destination and send from Design together
when ready. Saving or copying a note never sends a model request.

**Retry saved audio** processes only the selected note's pending segments. A lost
reply does not replay audio automatically. Switchyard reads back saved state and
reports uncertain delivery; audio that never reached local storage cannot be
recovered from that store. Capture pauses at three queued segments so a slow CPU
does not cause an unbounded browser queue. Successful transcription removes the
saved audio while retaining its transcript and corrected continuity.

**Delete session** first names the selected note and its contents. Confirmation
removes that note's encrypted audio and transcript. Text already copied into a
design draft or sent elsewhere is separate and remains. Changing the note or
workspace discards the deletion review. Personal text is cleared from the voice
panel when switching to Work.

Fourteen interaction cases use actual authenticated HTTP, encrypted storage and
the durable audio queue with explicit microphone, recorder and recognizer test
doubles. The complete-page case verifies microphone release before the mode
request and clearing on Work selection. Denied permission, late permission/start
replies, lost delivery/deletion replies, bounded capture and oversized audio are
covered. The original fixture-retirement failure is retained.

Nine original groups pass 114 checks; the final voice-only run preserves all
fourteen cases after improving note labels. The running preview also checks saved
synthetic notes without opening a microphone or executing a transcription runtime.
Browser rendering, recognition quality and live microphone/device acceptance
remain separate. [Exact source evidence](evidence/voice-ui-source-summary.json).

Normal installed `9057de5` passes all 36 served-asset hashes and nineteen API/
inventory checks, plus 100 checks from eight installed verifiers. All 54 semantic
workspaces, modes, conversations and selection are preserved. Dated launcher
backups and one rollback verify; the exact prepared package is removed. No live
microphone or recognizer was opened.
[Installed evidence](evidence/installed-transcript-import-controls-summary.json).

The subsequent transcript-import source adds six interaction cases, bringing the
voice file to twenty. Nine original groups pass 120 checks with no skips and exact
cleanup. These checks use synthetic pasted text and real encrypted HTTP storage;
none starts a provider, microphone or recognizer.
[Import source evidence](evidence/transcript-import-source-summary.json).
