# Turn a voice note into a design draft

Open **Activity → Voice notes for design**. Choose a saved note by its time and
transcript preview, or select **Start voice** to request microphone permission.
Recording requires a Personal workspace in companion mode and an available local
transcription runtime. Browsing existing notes opens no microphone and starts no
recognizer.

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
