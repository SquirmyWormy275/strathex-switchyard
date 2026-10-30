# Optional local runtime

Keyboard planning and host shortcuts do not need Python or a transcription
account. Local voice, configuration HID and the Python LangChain example use one
shared optional environment, avoiding separate copies for each feature.

After [installing the normal application](suite-installation.md), with
[uv installed](https://docs.astral.sh/uv/getting-started/installation/):

```sh
switchyard runtime install
switchyard runtime check
```

Setup downloads Python 3.12.14 when uv does not already have it, installs only
binary wheels from the checked-in hash lock, and downloads the four model files
from an immutable Systran faster-whisper revision. It verifies file sizes and
SHA-256 before promotion. Installation needs internet access for software/model
downloads; transcription runs locally without a provider API key. Installation
does not open a keyboard, record audio or enroll a provider account.

The historic root `~/.local/share/strathex-switchyard/voice` is retained to reuse
the pilot installation. Existing matching `venv` and `base.en` components are
adopted in place. New components use immutable `versions/<uuid>` directories;
Windows uses `Scripts/python.exe` inside its selected environment. Unchanged
components are shared across records. Existing mismatched legacy content is
preserved. Selection, inventories and maintenance journals live under
`.maintenance`, separately from all protected workspace data.

`update` verifies/reuses matching components and installs only missing changed
ones. The current and one previous release are retained. `rollback` selects the
retained release matching the installed application; roll back the application
first when requirements changed. `recover` resolves interrupted transactions and
retries a saved application restart. `uninstall` removes recorded generated
runtime software after inventory verification, preserving protected data and
unrelated or edited files. It does not remove a shared uv installation or its
managed Python. [Lifecycle and process-boundary details](runtime-lifecycle.md).

Maintenance verifies/stops the exact installed app and restores its previous
running state. Other registered instances block changes. No arbitrary command or
download URL is accepted by this CLI. Source `npm run runtime:install/check`
entries use the same lifecycle; they expect the normal app installation.

The root requirements are faster-whisper 1.2.1, PyAV 16.1.0, hidapi 0.15.0 and
langchain-core 1.7.3. Their transitive versions and artifact hashes are pinned in
[runtime.requirements.lock](../tools/layout-studio/runtime.requirements.lock).
The Python probe verifies active platform markers, every installed version,
native imports, a local LangChain Runnable and offline CPU model loading. Python
helpers run in isolated, no-bytecode mode with an explicit environment that omits provider
credentials, custom package indexes and Python injection. External tracing is
disabled. No wheel cache is retained by setup.

The model manifest pins
[`Systran/faster-whisper-base.en`](https://huggingface.co/Systran/faster-whisper-base.en/tree/3d3d5dee26484f91867d81cb899cfcf72b96be6c)
revision `3d3d5dee26484f91867d81cb899cfcf72b96be6c`. Its four files total
147,769,510 bytes. The upstream model's MIT license and attribution apply;
weights and generated audio stay outside Git.

For developer acceptance, `npm run runtime:verify-fresh` builds a disposable
interpreter from the lock, reusing a copy-on-write copy of the already verified
model when supported. It removes the disposable runtime and records the result
under `~/.local/state/strathex-switchyard/runtime-verification/`. Run this when
dependency or installer changes warrant it, not during normal startup.

## Evidence and remaining work

The pilot Linux environment passed all 48 version checks, with no extra packages.
A fresh Linux installation from the hash lock passed native imports and offline
model loading on October 30, 2026; its temporary environment was removed. Windows
x64/Python 3.12.14 wheel resolution also passed a hash-required, binary-only dry
run. That is dependency-resolution evidence, not Windows runtime acceptance.

Local CPU transcription of synthetic speech works, but misheard “review” as
“remove.” Correcting and reviewing transcripts remains essential. A real
microphone/browser session is still an open acceptance check.
The [voice recovery demonstration](voice-recovery.md) also passed through the
real CPU/HTTP path: concurrent duplicate handling, correction continuity,
audio erasure after saving text and Python exit after abrupt owner loss.

Suite packaging and normal application install/update/rollback are implemented
and host-tested; see [application installation](suite-installation.md).
Versioned optional-runtime maintenance, acknowledged worker supervision and
normal CLI integration are implemented with software/fault coverage. The current
pilot adoption and native Windows checks are recorded in the
[evidence ledger](switchyard-status.md); Windows dependency-resolution evidence
does not establish native imports or interactive acceptance. A matching working
runtime is verified/reused rather than rebuilt.

The locking/install strategy follows [uv's hash-lock and environment documentation](https://docs.astral.sh/uv/pip/compile/).
