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

## Version 2 wire contract

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
