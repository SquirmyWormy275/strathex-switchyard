# SXSY-B122 native voice helper

This Windows-only, self-contained helper is the fixed native boundary used by
`WindowsVoiceAudioPort` and `WindowsVoiceProviderPort`. It accepts exactly one
bounded JSON request on standard input for `--stdio-v1`; secrets are never read
from argv or inherited environment variables.

The local audio path uses WinMM PCM capture and current-user SAPI speech. State
and provider-route records are atomically persisted as DPAPI CurrentUser
ciphertext under `%LOCALAPPDATA%\STRATHEX\switchyard\voice-helper`. Claude and
ChatGPT never fall back to one another: a provider route must be explicitly
provisioned for the exact provider, route ID, authorization reference, HTTPS
endpoint, and model. Missing routes, credentials, devices, or OS permissions
return `unavailable`.

Route provisioning reads one bounded JSON object from standard input:

```text
sxsy-b122-voice-helper.exe --provision-route-v1
```

The object contains `provider`, `routeId`, `authorizationReference`,
`endpoint`, `model`, and `secret`. The caller must obtain explicit current-user
presence before invoking this mode. The secret exists only in process memory
and the DPAPI ciphertext. `--remove-route-v1` deletes the exact sealed route.

`--self-test` is hardware- and network-independent. It validates protocol
constants, redaction, state identity, atomic DPAPI round-trip, and route
selection. It does not claim microphone availability, provider credentials,
provider parity, or B122 acceptance gates.

Build for the release bundle with:

```powershell
dotnet publish .\Sxsy.B122.VoiceHelper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```
