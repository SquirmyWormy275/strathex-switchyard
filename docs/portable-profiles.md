# Carry your controls to another computer

A portable profile describes your keyboard and workflow. Each computer supplies
its own authorized app connections. Moving a profile never enrolls an account,
chooses a task session or turns on companion mode.

The existing Studio v1 file remains supported. The backend now provides a v2
package with:

- A stable profile ID and content revision, physical action/key assignments,
  workflow role/step IDs and explicit stable intent meanings.
- Controller, QMK keyboard/layout and matrix constraints; a geometry reference
  covering positions, rotations and shaped keys.
- A recorded base-layer digest and completeness declaration, with US QWERTY
  host-layout assumptions. Portable declarations do not prove live firmware.
- Required capabilities and a preferred operating mode. Both require local
  verification/selection; neither grants permission.
- A normalized portable source digest when migrating a v1 Studio plan/profile.
  The original file remains unchanged. Unknown versions cannot replace saved
  definitions or be converted destructively.

The revision is a SHA-256 change detector, not a signature or trust identity.
Imports independently recompute compatibility and reject modified metadata,
extra local fields, invalid role/action meanings and incorrect revisions.

## Review, then adopt definitions

The authenticated same-origin API has three additive routes. It leaves the
frozen morning frontend and existing v1 export unchanged.

| POST route | JSON body | Result |
| --- | --- | --- |
| `/api/suite/profile/package/export` | `{ "compartment": "personal" }` | Portable `document`, metadata status and explicit exclusion of local connections. |
| `/api/suite/profile/package/review` | `{ "compartment": "personal", "document": <profile> }` | Migration candidate, concrete differences against saved typing/geometry, required capabilities and a `reviewId`. |
| `/api/suite/profile/package/import` | `{ "compartment": "personal", "document": <same profile>, "reviewId": "<review ID>" }` | Adopted definitions and the count of cleared local role connections. |

Use the same private access link and local API authorization as the rest of the
suite. HTTP requests retain the suite's 256 KiB body bound. No general shell,
path or credential import is available.

The review is bound to the candidate revision, current definitions and existing
local role connections. A concurrent edit or changed connection invalidates it.
Adoption clears local role connections, including colliding imported role IDs,
so they cannot inherit an enrolled task. It preserves local accounts, policy,
credentials and an explicitly selected operating mode. A new computer stays in
keyboard-only mode until its owner deliberately selects more.

Explicit export preferences may name a `modePreference` and `intentAssignments`:

```json
{
  "modePreference": "personal-companion",
  "intentAssignments": [
    { "actionId": "return-to-task", "roleId": "coding", "intent": "resume" }
  ]
}
```

These name existing portable action/role IDs. Supported meanings are summon,
resume, review, handoff, status and cancel. They do not contain a provider,
account, executable, directory, session, credential reference or authority grant.
Exported imported metadata round-trips after restart. If later v1 edits change
the definitions, export reports `derived-requires-review` and constructs fresh
conservative metadata instead of silently retaining stale intent assignments.

Seven tests cover geometry/base constraints, tampering, legacy/future versions,
stale reviews, role-ID collisions, restart/export policy and actual authenticated
HTTP import/export. Hardware compatibility and second-machine interactive
acceptance remain open. Frontend controls for the new metadata/review are still
implementation work after the frozen frontend review.

## Installed pilot demonstration

```sh
mise exec node@24.14.0 -- node scripts/verify-profile-host.mjs --synthetic
```

This uses the normal installed application and a dedicated `profile-validation`
keyboard-only workspace with synthetic definitions. It exercises legacy
migration, rejection after a concurrent edit, preferred-mode nonactivation,
stable metadata export, unknown-version preservation and unauthorized rejection.
It then stops/restarts through the normal installed command and reads the same
package back. Personal definitions are checked before/after; the existing review
link is retained. It opens no HID interface, microphone or provider account and
does not claim UI/physical acceptance.

The actual October 30 pilot passed all eight checks on installed source
`fc298e8`, release
`4e39a88c4bef8cd89ef62c1f69e4c62ae3f5a53815d3980e59c28ed2f82d8a1e`.
Private receipt: `runtime-verification/profile-1793359560936.json`.
The disposable build copy was verified and removed after installation; only the
current installed program and one rollback version remain (about 6 MiB).
