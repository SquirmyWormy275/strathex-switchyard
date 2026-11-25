# Local voice notes and recovery

Voice notes use the optional local CPU runtime. Recording requires an explicit
start in a permitted companion workspace. Keyboard-only and Copilot-only Work
policies reject this provider. Text editing remains usable without voice.

Each bounded audio segment is saved encrypted before transcription. Its chunk
identity is bound to a SHA-256 of the audio bytes: repeating the same request
returns the existing result, while different audio cannot replace that identity.
One bounded queue and a cross-process CPU lease prevent overlapping workers.
Queue overflow preserves the encrypted source for deliberate retry.

A successful transcription saves its text and removes its audio atomically.
Failure, timeout, application restart or disabling companion mode preserves
pending audio. Re-enabling companion mode does not silently restart old requests.
Use **Retry** deliberately. A stopped/deleted session cannot be revived by a
late worker result. The Python worker also exits when its owning application
loses its private stdin pipe, including abrupt parent termination.

Corrections form a review checkpoint. Later raw segments append after that
corrected text and mark the transcript as needing review again. An intentionally
empty correction stays empty. If an earlier chunk is still pending, later text
waits for that gap before entering the ordered transcript.

## Repeatable development demonstration

Start the local suite, then run:

```sh
mise exec node@24.14.0 -- node scripts/verify-voice-host.mjs --synthetic
```

This Linux check generates a small WAV with `espeak-ng`, transcribes it through
the actual authenticated HTTP API twice concurrently, checks duplicate handling,
adds a correction and another segment, and verifies Python exit after abrupt
owner loss. It uses only the dedicated `host-validation` workspace, removes its
temporary audio/voice session and returns that workspace to keyboard-only mode.
A small private receipt is retained outside Git. No microphone, speaker or
external transcription service is opened.

The actual Linux demonstration passed on 2026-10-30, including inherited-pipe
closure 17 ms after parent exit. This establishes local backend behavior. It
does not establish microphone capture, recognition accuracy, frontend acceptance
or native Windows worker behavior. The morning frontend build remains frozen;
those acceptance checks and clearer pending/review states remain open.
