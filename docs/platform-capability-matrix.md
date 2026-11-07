# B122 host capability matrix

**Product order:** Omarchy Linux is the primary agent workstation. Windows is a first-class portable keyboard host and an optional agent-control host. The canonical 22 controls and 65 assigned chords in `packages/protocol/src/b122.ts` are unchanged by this matrix.

| Capability | Omarchy Linux | Windows with companion | Windows without companion |
| --- | --- | --- | --- |
| Ordinary typing and standard USB keyboard keys | Required on the commissioned full keymap; physical proof pending | Same physical requirement | Must work without installation, sign-in, service, driver, or per-machine mapping; physical proof pending |
| B122 Raw HID intent and 65 assigned chords | Source transport exists; exact device and host acceptance pending | Source transport and helper exist; exact device and host acceptance pending | No agent effect; unrecognized controls remain inert |
| Session status | Authenticated companion registry and read-only VS Code view; native ChatGPT/Claude adapters pending | Authenticated companion registry and VS Code view; live provider adapters pending | Unavailable; a visible window does not establish agent status |
| Focus and launch | Current Omarchy consumer focuses only commissioned VS Code and external terminal windows | Reviewed installed host actions where configured | Ordinary OS/application shortcuts remain available; no Switchyard action |
| Handoff | Exact task/plan/authority packet when a supported adapter exists; Omarchy clipboard remains the normal quick-copy route | Same packet rules after optional installation | Ordinary copy and paste only |
| Voice | Native ChatGPT voice must remain in its main window on the owner's Linux build; Switchyard binding remains unaccepted | Provider-specific route remains unaccepted | No Switchyard voice behavior |
| Git, CI, scanner, Council, sandbox | Only exact configured and accepted routes; high-consequence gates remain disabled | Same, with Windows-specific isolation | Unavailable |

## Host contract

1. The keyboard's **standard USB HID typing interface** must be independent of the Switchyard companion and Raw HID handshake. No companion or account is needed for ordinary keyboard use on Windows.
2. The firmware integration must retain the manufacturer's complete typing matrix and ordinary keycodes. The current `firmware/qmk/keymaps/b122/keymap.c` is a 22-control **logical overlay**, not a commissioned full B122 typing map. It must not be flashed as a replacement for the base keyboard map.
3. A missing, outdated, or unauthorized companion may make advanced B122 intent controls unavailable; it must never suppress ordinary typing or synthesize a substitute keyboard shortcut.
4. Advanced functions on a work Windows machine require an optional per-user, reviewed installation. Do not copy Linux tokens, personal accounts, provider credentials, or protected state to that machine. The host must show what is unavailable rather than asking for broad ambient permissions.
5. One portable release and one documented per-user installation path should cover the optional Windows features. Repository, provider, and network authorization remain explicit only for the functions that need them.

## Acceptance sequence

The B122 is expected in **January 2027**. These physical checks are scheduled for its arrival; software work can proceed now without assuming the device is available.

- On the actual B122, inventory and back up the factory firmware and full keymap before any flash.
- Prove letters, numbers, modifiers, navigation, rollover, boot/replug, sleep/resume, and BIOS or login-screen typing on an otherwise unconfigured Windows PC, with no Switchyard software running.
- Prove that all 65 assigned chords are inert on that PC while ordinary typing still works.
- Install the optional Windows companion under the current user, then prove the same typing behavior and only the explicitly configured advanced actions.
- Repeat the standard typing and protocol coexistence checks on Omarchy Linux. Record exact device identity and the result in the acceptance-gate ledger.

No source-only simulator, F77 observation, or Windows release bundle closes these physical checks.
