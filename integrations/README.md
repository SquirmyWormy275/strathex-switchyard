# Connect an application to Switchyard

An enrolled application can report its own session status and handle six bounded
intents: `summon`, `resume`, `review`, `handoff`, `status` and `cancel`. It implements
only the intents it declares. Switchyard never loads application plugin code or
types into an arbitrary foreground window.

Start with the executable [Node example](../examples/custom-agent/agent.mjs) or
[LangChain Runnable example](../examples/langchain-agent/agent.py). Both are
available from **Agents** in the suite. The Python example needs the verified
[optional local runtime](../docs/optional-runtime.md).

The private enrollment supplies `compartment`, `agentId` and a token. Add this
workspace's exact loopback `baseUrl`, instantiate `switchyardAgent` in Node or
`SwitchyardAgent` in Python, then **await** `publish(sessionId, "ready")`. Use a
fresh session identifier for a new process. Poll for commands, implement each
supported intent in that application's own context, and acknowledge its exact
command ID. An acknowledgement is the adapter's report; it does not independently
prove that a coding task finished or authorize a consequential tool action.

Never commit enrollment credentials. Persist the sequence privately before
sending (the Node SDK exposes `onSequence`) if reusing a credential across process
restarts. The bundled supervisor restores the saved server sequence. Independent
processes must coordinate that one enrollment's sequence, or use distinct enrolled
identities. Do not retry a claimed command after a timeout: inspect its uncertain
outcome. Claims are delivered once and are never automatically replayed.

Publishing `stopped` retires that session's pending commands in the same protected
transaction: unclaimed commands cancel locally; claimed work remains uncertain.
Readiness cannot resume under that stopped identity. A new process publishes
`ready` with a fresh session ID, and neither old command is delivered again.
The stopped adapter may still acknowledge its exact old claim using its original
credential and a fresh sequence; that acknowledgement does not restore readiness
or prove the external outcome. [Recovery contract](../docs/custom-agent-revocation.md#review-an-uncertain-claim).

With an explicit Personal `agent-events` recording, the bridge also records
bounded command queue/claim/retirement/acknowledgement metadata. Handoff text,
credentials and raw identities stay out of that history. Local claims and agent
self-reports remain distinct, and pausing recording does not cause later backfill.
[Observation contract and evidence](../docs/agent-lifecycle-observation.md#custom-agent-command-history).

## Distinct client recipes

`POST /api/suite/integrations/catalog` with `{ compartment }` reports documented
client surfaces without opening an application, inspecting browser accounts or
claiming a native session. `POST /api/suite/integrations/recipe` accepts only
`{ compartment, id }` and returns the exact versioned declarative recipe. It is
useful in keyboard-only mode; it grants no host action or provider authority.
Work policy permits only the Microsoft 365 Copilot recipe. A recipe cannot carry
an alternate URL, command, account, permission or self-approval.

| Recipe | Supported surface and primary contract |
| --- | --- |
| `github-copilot-web` | [GitHub.com Copilot](https://docs.github.com/en/copilot/how-tos/manage-your-account/get-started-with-a-copilot-plan), separate from Microsoft 365 Copilot. |
| `microsoft-365-copilot-web` | [Microsoft Copilot Chat for an approved work account](https://learn.microsoft.com/en-us/copilot/manage-copilot-chat); the vendor's current primary URL is `copilot.cloud.microsoft`. Browser identity remains unverified. |
| `claude-desktop` | [Native Claude desktop](https://support.claude.com/en/articles/10065433-install-claude-desktop), separate from Claude Code. Linux beta has explicit distribution/feature limits. No web substitute is inferred. |
| `cursor-cloud` | [Cursor Cloud Agents](https://prod.cursor.com/help/getting-started/first-project), separate from native IDE/CLI task control. |
| `figma-web` | [Figma's file browser](https://help.figma.com/hc/en-us/articles/1500005554982-Guide-to-files-and-folders), with no file/team/edit authority selected. |

The [versioned recipe validator](client-recipes.mjs) accepts only the exact
built-in target and boundary. Vendor sources were checked on November 4, 2026;
they establish documented surfaces, not local installation/account acceptance.
Linux fixed HTTPS launch requests connect through the system Python 3 Gio client
and the [OpenURI portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.OpenURI.html).
`POST /api/suite/integrations/launch` accepts only `{ compartment, id, requestId }`
in the selected matching companion mode. It persists exact native ownership
before startup acknowledgement, waits for the portal's Response and independently
verifies helper exit. Duplicate request UUIDs return retained results without
another portal request. `launches` lists sanitized retained evidence. Work policy
permits only the fixed Microsoft work surface; no profile content enters the URI.

Portal acceptance means `launch-requested`; window/account/session state remains
unverified. Keyboard-only/selection changes stop only the owned request helper,
not the user's external browser. Unknown outcomes survive restart without replay;
unverified native owners prevent replacement. The helper requires the desktop's
system `python3` with Gio/GLib and a running OpenURI portal. It adds no runtime or
model copy and changes no desktop settings. A missing dependency fails on use.

Windows fixed HTTPS requests now use the system Windows PowerShell WinRT
projection and [Launcher.LaunchUriAsync](https://learn.microsoft.com/en-us/uwp/api/windows.system.launcher.launchuriasync),
with the same protected request/ownership boundaries. No ExecutionPolicy override,
profile, arbitrary command or fallback runtime is selected. A missing projection
or prohibited script fails without weakening host policy. Both native helpers
independently verify the exact reviewed target URL hash before requesting it.
The short client-platform workflow checks native Windows metadata without
launching a URI; all 41 checks passed at ea96ffe after correcting native UTF-8 startup. Interactive
Windows URI/account/window acceptance remains pending.

Exact native Claude desktop binding and frontend controls remain unfinished
implementation. The catalog reports those missing capabilities. Do
not bind a launch-only recipe to resume, submit, cancel or mediated repository
actions. Native client/tenant/account acceptance remains separate from the
implemented request transport.

## Workflow roles that open client surfaces

Bind an existing workflow role through `POST /api/suite/roles/bind`:

```json
{"compartment":"personal","roleId":"builder","intent":"summon","provider":"github-copilot","targetKind":"client-surface","targetId":"github-copilot-web"}
```

This local connection records a fresh binding identity and the exact recipe
digest. It accepts summon only. No session ID, command, URL, imported approval or
content is accepted. Microsoft work Copilot uses the corresponding work
compartment/provider/recipe; other providers remain prohibited there. Native
Claude desktop still requires an implemented exact application binding.

`roles/dispatch` accepts `{ compartment, roleId, intent, requestId }`, with a fresh
UUID for each deliberate invocation. The physical `switchyard.role/v1` gateway
uses the persisted active compartment and generates that UUID in the Linux CLI
or Windows hotkey sender. Reusing a UUID returns its retained result only for the
same exact binding. Another role, a new binding revision, or the direct launch
API cannot substitute that request. Neither gateway automatically retries.
Binding/role changes are checked again before native acknowledgement and before
accepting a result. An uncertain request is retained, not replayed.

The connection review reports `capability: "launch-only"`. It establishes no
window focus, account, conversation, task resumption, status or mediated authority.
Opening a client leaves the active conversation unchanged. Frontend role controls
remain pending while the current review is frozen. For an explicit installed
Linux proof with one real homepage request and zero prompts, run
`node scripts/verify-client-launch-host.mjs --synthetic --role`; it uses the idle
validation workspace, saves a private definition backup, restores definitions and
selection, and verifies the helper has exited. It does not establish a physical
key event or visual/account acceptance.

## Version 2 wire contract

Custom-agent authorization can now be reviewed and revoked through the protected
Suite API, then replaced by deliberate enrollment with a fresh credential.
Old roles and command claims cannot pass to the replacement, even when an agent
or session ID is reused. The v2 SDK wire format is unchanged. See
[revocation and replacement](../docs/custom-agent-revocation.md) for endpoints,
durable failure handling, owned-process evidence and validation limits.

Only `POST /agent/v2/event`, `/agent/v2/poll` and `/agent/v2/ack` accept this
contract. Version 1 receives HTTP 426; update the SDK and deliberately publish a
new ready session. Enrollment credentials and portable role identities survive
that update. Browser requests cannot use the agent bridge.

Requests contain exactly `schema: "switchyard-agent-message/v2"`, `compartment`,
`agentId`, `sessionId`, a positive safe-integer `sequence`, and Unix milliseconds
`at` (within 30 seconds). Event adds `event: {status}`; acknowledgement adds
`commandId` and `outcome`. Poll adds no fields. Event statuses are `ready`, `busy`,
`waiting`, `idle`, `failed`, `stopped`. Outcomes are `completed`, `failed`,
`cancelled`. A new session must first publish `ready`.

`X-Switchyard-Signature` is lowercase hex HMAC-SHA256 using the UTF-8 token as its
key and these exact bytes as input, with the raw UTF-8 JSON appended:

```text
SWITCHYARD-REQUEST-V2\nPOST\n<exact route>\n<raw JSON>
```

Accepted responses have schema `switchyard-agent-response/v2`, the exact
`requestSequence`, `sessionId` and a `result` object. Poll's result always includes
`command`, either null or `{id, intent, sessionId, content}`. Before returning any
action the SDK verifies `X-Switchyard-Response-Signature` against:

```text
SWITCHYARD-RESPONSE-V2\n200\n<exact route>\n<raw response JSON>
```

The same token signs both directions with distinct prefixes. Requests are capped
at 32 KiB; SDK responses at 128 KiB. Clients use direct loopback HTTP, reject
redirects, and do not route the credential through environment proxies. Sequence
acceptance and the message effect share one locked encrypted-state transaction.
Invalid messages do not advance the durable counter.

Replacing a session cancels its unclaimed queue and marks previously claimed
commands uncertain. An exact late acknowledgement can resolve that old claim
without refreshing the replacement session. It cannot poll the new session's
commands. An unacknowledged claim remains uncertain after a lost response; the
system does not infer success, retry the work, or invent an external cancellation.

## Bundled process ownership

The suite serializes concurrent starts of each bundled example and invalidates a
pending start when its workspace is stopped. Enrollment arrives as a bounded JSON
line on private stdin with `supervised: true`; that pipe stays open for the owner's
lifetime. Both bundled examples exit on EOF, including abrupt parent loss while
an HTTP request is pending. This is a lifecycle protocol for these fixed examples,
not an OS containment claim or a way to kill an arbitrary external agent.
